"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initUpdateEmitter = initUpdateEmitter;
exports.emitTokenPriceUpdate = emitTokenPriceUpdate;
exports.emitTokenBought = emitTokenBought;
exports.emitTokenSold = emitTokenSold;
exports.emitTokenCreated = emitTokenCreated;
exports.emitTokenTraded = emitTokenTraded;
exports.emitDepositDetected = emitDepositDetected;
exports.emitWithdrawDetected = emitWithdrawDetected;
exports.emitBalanceUpdate = emitBalanceUpdate;
let ioInstance = null;
/**
 * Initialize the Socket.IO instance for all token event updates
 */
function initUpdateEmitter(io) {
    ioInstance = io;
}
/**
 * Emit a price update to all connected clients
 * (Consolidated from priceUpdateEmitter)
 */
function emitTokenPriceUpdate(tokenAddress, data) {
    if (!ioInstance) {
        return;
    }
    try {
        const normalizedAddress = tokenAddress.toLowerCase();
        ioInstance.emit('priceUpdate', {
            tokenAddress: normalizedAddress,
            price: data.price,
            priceUSD: data.priceUSD || data.price, // Include priceUSD, fallback to price if not provided
            timestamp: typeof data.timestamp === 'string' ? data.timestamp : data.timestamp.toISOString(),
            chainId: data.chainId,
        });
    }
    catch (error) {
        console.error('❌ Error emitting token price update:', error);
    }
}
/**
 * Emit tokenBought event with transaction, holder, and token data
 */
function emitTokenBought(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const eventPayload = {
            tokenAddress: data.tokenAddress.toLowerCase(),
            buyer: data.buyer.toLowerCase(),
            ethAmount: data.ethAmount,
            tokenAmount: data.tokenAmount,
            txHash: data.txHash.toLowerCase(),
            blockNumber: data.blockNumber,
            blockTimestamp: typeof data.blockTimestamp === 'string'
                ? data.blockTimestamp
                : data.blockTimestamp.toISOString(),
            chainId: data.chainId,
            tokenPrice: data.tokenPrice,
            marketCap: data.marketCap || '0',
            graduationProgress: data.graduationProgress,
            holders: data.holders || [],
        };
        ioInstance.emit('tokenBought', eventPayload);
    }
    catch (error) {
        console.error('❌ Error emitting tokenBought event:', error);
    }
}
/**
 * Emit tokenSold event with transaction, holder, and token data
 */
function emitTokenSold(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const eventPayload = {
            tokenAddress: data.tokenAddress.toLowerCase(),
            seller: data.seller.toLowerCase(),
            ethAmount: data.ethAmount,
            tokenAmount: data.tokenAmount,
            txHash: data.txHash.toLowerCase(),
            blockNumber: data.blockNumber,
            blockTimestamp: typeof data.blockTimestamp === 'string'
                ? data.blockTimestamp
                : data.blockTimestamp.toISOString(),
            chainId: data.chainId,
            tokenPrice: data.tokenPrice,
            marketCap: data.marketCap || '0',
            graduationProgress: data.graduationProgress,
            holders: data.holders || [],
        };
        ioInstance.emit('tokenSold', eventPayload);
    }
    catch (error) {
        console.error('❌ Error emitting tokenSold event:', error);
    }
}
/**
 * Emit tokenCreated event with token and holder data
 */
function emitTokenCreated(data) {
    if (!ioInstance) {
        return;
    }
    try {
        ioInstance.emit('tokenCreated', {
            tokenAddress: data.tokenAddress.toLowerCase(),
            creatorAddress: data.creatorAddress.toLowerCase(),
            name: data.name,
            symbol: data.symbol,
            description: data.description,
            logo: data.logo,
            totalSupply: data.totalSupply,
            chainId: data.chainId,
            tokenPrice: data.tokenPrice,
            marketCap: data.marketCap || '0',
            holders: data.holders || [],
            timestamp: typeof data.timestamp === 'string'
                ? data.timestamp
                : data.timestamp.toISOString(),
        });
    }
    catch (error) {
        console.error('❌ Error emitting tokenCreated event:', error);
    }
}
/**
 * Emit tokenTraded event (direct transfers) with transaction, holder, and token data
 */
function emitTokenTraded(data) {
    if (!ioInstance) {
        return;
    }
    try {
        ioInstance.emit('tokenTraded', {
            tokenAddress: data.tokenAddress.toLowerCase(),
            from: data.from.toLowerCase(),
            to: data.to.toLowerCase(),
            value: data.value,
            txHash: data.txHash.toLowerCase(),
            blockNumber: data.blockNumber,
            blockTimestamp: typeof data.blockTimestamp === 'string'
                ? data.blockTimestamp
                : data.blockTimestamp.toISOString(),
            chainId: data.chainId,
            tokenPrice: data.tokenPrice,
            marketCap: data.marketCap || '0',
            holders: data.holders || [],
        });
    }
    catch (error) {
        console.error('❌ Error emitting tokenTraded event:', error);
    }
}
/**
 * Emit depositDetected event when a deposit is detected for an embedded wallet
 * This enables real-time notifications and balance updates in the frontend
 * Emits to user-specific room if userId is provided, otherwise broadcasts
 */
function emitDepositDetected(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const eventPayload = {
            walletAddress: data.walletAddress.toLowerCase(),
            fromAddress: data.fromAddress.toLowerCase(),
            amount: data.amount,
            amountFormatted: data.amountFormatted || data.amount,
            txHash: data.txHash.toLowerCase(),
            blockNumber: data.blockNumber,
            blockTimestamp: typeof data.blockTimestamp === 'string'
                ? data.blockTimestamp
                : data.blockTimestamp.toISOString(),
            chainId: data.chainId,
            userId: data.userId || null,
            type: 'deposit', // Add type for frontend to distinguish
        };
        // Emit to specific user room if userId is provided
        if (data.userId) {
            const userRoom = `user:${data.userId}`;
            ioInstance.to(userRoom).emit('depositDetected', eventPayload);
            console.log(`📨 Deposit notification sent to user ${data.userId} (room: ${userRoom})`);
        }
        else {
            // Fallback: emit to all clients (for backward compatibility or unauthenticated cases)
            ioInstance.emit('depositDetected', eventPayload);
            console.log('📨 Deposit notification broadcasted to all clients (no userId)');
        }
    }
    catch (error) {
        console.error('❌ Error emitting depositDetected event:', error);
    }
}
/**
 * Emit withdrawDetected event when a withdrawal is detected for an embedded wallet
 * This enables real-time notifications and balance updates in the frontend
 * Emits to user-specific room if userId is provided, otherwise broadcasts
 */
function emitWithdrawDetected(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const eventPayload = {
            walletAddress: data.walletAddress.toLowerCase(),
            toAddress: data.toAddress.toLowerCase(),
            amount: data.amount,
            amountFormatted: data.amountFormatted || data.amount,
            txHash: data.txHash.toLowerCase(),
            blockNumber: data.blockNumber,
            blockTimestamp: typeof data.blockTimestamp === 'string'
                ? data.blockTimestamp
                : data.blockTimestamp.toISOString(),
            chainId: data.chainId,
            userId: data.userId || null,
            type: 'withdraw', // Add type for frontend to distinguish
        };
        // Emit to specific user room if userId is provided
        if (data.userId) {
            const userRoom = `user:${data.userId}`;
            ioInstance.to(userRoom).emit('withdrawDetected', eventPayload);
            console.log(`📨 Withdraw notification sent to user ${data.userId} (room: ${userRoom})`);
        }
        else {
            // Fallback: emit to all clients (for backward compatibility or unauthenticated cases)
            ioInstance.emit('withdrawDetected', eventPayload);
            console.log('📨 Withdraw notification broadcasted to all clients (no userId)');
        }
    }
    catch (error) {
        console.error('❌ Error emitting withdrawDetected event:', error);
    }
}
/**
 * Emit balanceUpdate event when balance changes (after deposit/withdraw)
 * This enables real-time balance updates in the frontend (Binance-like approach)
 * Balance is fetched fresh from blockchain after database update
 */
function emitBalanceUpdate(data) {
    if (!ioInstance) {
        return;
    }
    try {
        const eventPayload = {
            walletAddress: data.walletAddress.toLowerCase(),
            balance: data.balance,
            balanceFormatted: data.balanceFormatted,
            chainId: data.chainId,
            timestamp: new Date().toISOString(),
        };
        // Emit to specific user room
        const userRoom = `user:${data.userId}`;
        ioInstance.to(userRoom).emit('balanceUpdate', eventPayload);
        console.log(`💰 Balance update sent to user ${data.userId} (room: ${userRoom})`, {
            walletAddress: data.walletAddress,
            balance: data.balanceFormatted,
            chainId: data.chainId
        });
    }
    catch (error) {
        console.error('❌ Error emitting balanceUpdate event:', error);
    }
}
//# sourceMappingURL=updateEmitter.js.map