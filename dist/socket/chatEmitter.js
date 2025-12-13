"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChatEmitter = initChatEmitter;
exports.emitChatMessage = emitChatMessage;
let ioInstance = null;
function initChatEmitter(io) {
    ioInstance = io;
    console.log('✅ Chat message emitter initialized');
}
function emitChatMessage(message) {
    if (!ioInstance) {
        console.warn('⚠️ Socket.io instance not initialized. Chat message not emitted.');
        return;
    }
    try {
        // Emit to all clients (they can filter by token on the frontend)
        ioInstance.emit('chatMessage', message);
        console.log(`📨 Chat message emitted for token: ${message.token}`);
    }
    catch (error) {
        console.error('❌ Error emitting chat message:', error);
    }
}
//# sourceMappingURL=chatEmitter.js.map