"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initChatEmitter = initChatEmitter;
exports.emitChatMessage = emitChatMessage;
exports.emitChatMessageEdited = emitChatMessageEdited;
exports.emitChatMessageDeleted = emitChatMessageDeleted;
let ioInstance = null;
function initChatEmitter(io) {
    ioInstance = io;
}
function emitChatMessage(message) {
    if (!ioInstance) {
        return;
    }
    try {
        // Emit only to clients in the specific token's chat room
        const room = `tokenChat:${message.token.toLowerCase()}`;
        ioInstance.to(room).emit('chatMessage', message);
    }
    catch (error) {
        console.error('❌ Error emitting chat message:', error);
    }
}
function emitChatMessageEdited(message) {
    if (!ioInstance) {
        return;
    }
    try {
        const room = `tokenChat:${message.token.toLowerCase()}`;
        ioInstance.to(room).emit('chatMessageEdited', message);
    }
    catch (error) {
        console.error('❌ Error emitting chat message edited:', error);
    }
}
function emitChatMessageDeleted(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const room = `tokenChat:${data.token.toLowerCase()}`;
        ioInstance.to(room).emit('chatMessageDeleted', data);
    }
    catch (error) {
        console.error('❌ Error emitting chat message deleted:', error);
    }
}
//# sourceMappingURL=chatEmitter.js.map