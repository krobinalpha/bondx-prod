"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
const updateEmitter_1 = require("./updateEmitter");
const chatEmitter_1 = require("./chatEmitter");
// Store userId -> socketId mapping for tracking (optional, for debugging)
const userSockets = new Map(); // userId -> Set<socketId>
function socketInit(io) {
    // Initialize consolidated update emitter (includes price updates and token events)
    (0, updateEmitter_1.initUpdateEmitter)(io);
    // Initialize chat message emitter
    (0, chatEmitter_1.initChatEmitter)(io);
    // Socket.IO authentication middleware
    io.use(async (socket, next) => {
        try {
            // Try to get token from auth object first, then from headers
            const token = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.split(' ')[1];
            if (token) {
                const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
                try {
                    const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
                    const userId = decoded.userId;
                    if (userId) {
                        const user = await User_1.default.findById(userId);
                        if (user && user.isActive) {
                            // Attach userId to socket for later use
                            socket.userId = userId.toString();
                            return next();
                        }
                    }
                }
                catch (jwtError) {
                    // JWT verification failed - allow connection without auth (for public features)
                    // This allows unauthenticated users to still connect for public events
                }
            }
            // Allow connection without auth (for public features like token price updates)
            next();
        }
        catch (error) {
            // Allow connection even if auth fails (for public features)
            next();
        }
    });
    io.on('connection', (socket) => {
        const userId = socket.userId;
        // Join user-specific room if authenticated
        if (userId) {
            const userRoom = `user:${userId}`;
            socket.join(userRoom);
            // Track socket for this user (for debugging/monitoring)
            if (!userSockets.has(userId)) {
                userSockets.set(userId, new Set());
            }
            userSockets.get(userId).add(socket.id);
            console.log(`✅ User ${userId} connected (socket: ${socket.id})`);
        }
        // Handle joining token chat room
        socket.on('joinTokenChat', (tokenAddress) => {
            if (tokenAddress && typeof tokenAddress === 'string') {
                const room = `tokenChat:${tokenAddress.toLowerCase()}`;
                socket.join(room);
            }
        });
        // Handle leaving token chat room
        socket.on('leaveTokenChat', (tokenAddress) => {
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
exports.default = socketInit;
//# sourceMappingURL=index.js.map