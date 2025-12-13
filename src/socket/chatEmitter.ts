import { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function initChatEmitter(io: Server): void {
  ioInstance = io;
  console.log('✅ Chat message emitter initialized');
}

export function emitChatMessage(message: {
  id: string;
  user: string;
  token: string;
  message: string;
  reply_to: string | null;
  timestamp: string;
}): void {
  if (!ioInstance) {
    console.warn('⚠️ Socket.io instance not initialized. Chat message not emitted.');
    return;
  }

  try {
    // Emit to all clients (they can filter by token on the frontend)
    ioInstance.emit('chatMessage', message);
    console.log(`📨 Chat message emitted for token: ${message.token}`);
  } catch (error) {
    console.error('❌ Error emitting chat message:', error);
  }
}

