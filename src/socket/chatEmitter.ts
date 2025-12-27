import { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function initChatEmitter(io: Server): void {
  ioInstance = io;
}

export function emitChatMessage(message: {
  id: string;
  user: string;
  token: string;
  message: string;
  reply_to: string | null;
  timestamp: string;
  editedAt?: string | null;
  isDeleted?: boolean;
}): void {
  if (!ioInstance) {
    return;
  }

  try {
    // Emit only to clients in the specific token's chat room
    const room = `tokenChat:${message.token.toLowerCase()}`;
    ioInstance.to(room).emit('chatMessage', message);
  } catch (error) {
    console.error('❌ Error emitting chat message:', error);
  }
}

export function emitChatMessageEdited(message: {
  id: string;
  user: string;
  token: string;
  message: string;
  reply_to: string | null;
  timestamp: string;
  editedAt: string | null;
}): void {
  if (!ioInstance) {
    return;
  }

  try {
    const room = `tokenChat:${message.token.toLowerCase()}`;
    ioInstance.to(room).emit('chatMessageEdited', message);
  } catch (error) {
    console.error('❌ Error emitting chat message edited:', error);
  }
}

export function emitChatMessageDeleted(data: {
  id: string;
  token: string;
}): void {
  if (!ioInstance) {
    return;
  }

  try {
    const room = `tokenChat:${data.token.toLowerCase()}`;
    ioInstance.to(room).emit('chatMessageDeleted', data);
  } catch (error) {
    console.error('❌ Error emitting chat message deleted:', error);
  }
}

