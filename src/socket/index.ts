import { Server } from 'socket.io';
import { initUpdateEmitter } from './updateEmitter';
import { initChatEmitter } from './chatEmitter';

function socketInit(io: Server): void {
  // Initialize consolidated update emitter (includes price updates and token events)
  initUpdateEmitter(io);
  
  // Initialize chat message emitter
  initChatEmitter(io);

  io.on('connection', (socket) => {
    console.log(`⚡ New connection: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`❌ Disconnected: ${socket.id}`);
    });
  });
}

export default socketInit;

