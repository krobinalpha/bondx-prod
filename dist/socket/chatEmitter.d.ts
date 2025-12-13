import { Server } from 'socket.io';
export declare function initChatEmitter(io: Server): void;
export declare function emitChatMessage(message: {
    id: string;
    user: string;
    token: string;
    message: string;
    reply_to: string | null;
    timestamp: string;
}): void;
//# sourceMappingURL=chatEmitter.d.ts.map