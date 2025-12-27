import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { initUpdateEmitter } from './updateEmitter';
import { initChatEmitter } from './chatEmitter';

// Store userId -> socketId mapping for tracking (optional, for debugging)
const userSockets = new Map<string, Set<string>>(); // userId -> Set<socketId>

function socketInit(io: Server): void {
  // Initialize consolidated update emitter (includes price updates and token events)
  initUpdateEmitter(io);
  
  // Initialize chat message emitter
  initChatEmitter(io);

  // Socket.IO authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      // Try to get token from auth object first, then from headers
      const token = socket.handshake.auth?.token || 
                    socket.handshake.headers?.authorization?.split(' ')[1];
      
      if (token) {
        const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        try {
          const decoded = jwt.verify(token, jwtSecret) as any;
          const userId = decoded.userId;
          
          if (userId) {
            const user = await User.findById(userId);
            if (user && user.isActive) {
              // Attach userId to socket for later use
              (socket as any).userId = userId.toString();
              return next();
            }
          }
        } catch (jwtError) {
          // JWT verification failed - allow connection without auth (for public features)
          // This allows unauthenticated users to still connect for public events
        }
      }
      
      // Allow connection without auth (for public features like token price updates)
      next();
    } catch (error) {
      // Allow connection even if auth fails (for public features)
      next();
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    
    // Join user-specific room if authenticated
    if (userId) {
      const userRoom = `user:${userId}`;
      socket.join(userRoom);
      
      // Track socket for this user (for debugging/monitoring)
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId)!.add(socket.id);
      
      console.log(`✅ User ${userId} connected (socket: ${socket.id})`);
    }

    // Handle joining token chat room
    socket.on('joinTokenChat', (tokenAddress: string) => {
      if (tokenAddress && typeof tokenAddress === 'string') {
        const room = `tokenChat:${tokenAddress.toLowerCase()}`;
        socket.join(room);
      }
    });

    // Handle leaving token chat room
    socket.on('leaveTokenChat', (tokenAddress: string) => {
      if (tokenAddress && typeof tokenAddress === 'string') {
        const room = `tokenChat:${tokenAddress.toLowerCase()}`;
        socket.leave(room);
      }
    });

    socket.on('disconnect', () => {
      // Clean up user socket tracking
      if (userId) {
        const sockets = userSockets.get(userId);
        if (sockets) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            userSockets.delete(userId);
          }
        }
        console.log(`👋 User ${userId} disconnected (socket: ${socket.id})`);
      }
      // Socket.IO automatically removes socket from all rooms on disconnect
    });
  });
}

export default socketInit;

