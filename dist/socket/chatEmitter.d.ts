import { Server } from 'socket.io';
export declare function initChatEmitter(io: Server): void;
export declare function emitChatMessage(message: {
    id: string;
    user: string;
    token: string;
    message: string;
    reply_to: string | null;
    timestamp: string;
    editedAt?: string | null;
    isDeleted?: boolean;
}): void;
export declare function emitChatMessageEdited(message: {
    id: string;
    user: string;
    token: string;
    message: string;
    reply_to: string | null;
    timestamp: string;
    editedAt: string | null;
}): void;
export declare function emitChatMessageDeleted(data: {
    id: string;
    token: string;
}): void;
//# sourceMappingURL=chatEmitter.d.ts.map