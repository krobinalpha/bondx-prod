"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const updateEmitter_1 = require("./updateEmitter");
const chatEmitter_1 = require("./chatEmitter");
function socketInit(io) {
    // Initialize consolidated update emitter (includes price updates and token events)
    (0, updateEmitter_1.initUpdateEmitter)(io);
    // Initialize chat message emitter
    (0, chatEmitter_1.initChatEmitter)(io);
    io.on('connection', (socket) => {
        console.log(`⚡ New connection: ${socket.id}`);
        socket.on('disconnect', () => {
            console.log(`❌ Disconnected: ${socket.id}`);
        });
    });
}
exports.default = socketInit;
//# sourceMappingURL=index.js.map