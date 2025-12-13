"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initUpdateEmitter = initUpdateEmitter;
exports.emitTokenPriceUpdate = emitTokenPriceUpdate;
exports.emitTokenBought = emitTokenBought;
exports.emitTokenSold = emitTokenSold;
exports.emitTokenCreated = emitTokenCreated;
exports.emitTokenTraded = emitTokenTraded;
let ioInstance = null;
/**
 * Initialize the Socket.IO instance for all token event updates
 */
function initUpdateEmitter(io) {
    ioInstance = io;
    console.log('✅ Update emitter initialized (includes price updates and token events)');
}
/**
 * Emit a price update to all connected clients
 * (Consolidated from priceUpdateEmitter)
 */
function emitTokenPriceUpdate(tokenAddress, data) {
    if (!ioInstance) {
        console.warn('⚠️ Socket.IO instance not initialized. Price update not emitted.');
        return;
    }
    try {
        const normalizedAddress = tokenAddress.toLowerCase();
        ioInstance.emit('priceUpdate', {
            tokenAddress: normalizedAddress,
            price: data.price,
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
        console.warn('⚠️ Socket.IO instance not initialized. tokenBought event not emitted.');
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
        // Debug logging
        const connectedClients = ioInstance?.sockets?.sockets?.size || 0;
        console.log(`🔍 DEBUG emitTokenBought:`, {
            tokenAddress: data.tokenAddress,
            txHash: data.txHash,
            chainId: data.chainId,
            connectedClients,
            hasHolders: (data.holders || []).length > 0,
            holdersCount: (data.holders || []).length,
        });
        console.log(`✅ tokenBought event emitted for ${data.tokenAddress}`);
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
        console.warn('⚠️ Socket.IO instance not initialized. tokenSold event not emitted.');
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
        // Debug logging
        const connectedClients = ioInstance?.sockets?.sockets?.size || 0;
        console.log(`🔍 DEBUG emitTokenSold:`, {
            tokenAddress: data.tokenAddress,
            txHash: data.txHash,
            chainId: data.chainId,
            connectedClients,
            hasHolders: (data.holders || []).length > 0,
            holdersCount: (data.holders || []).length,
        });
        console.log(`✅ tokenSold event emitted for ${data.tokenAddress}`);
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
        console.warn('⚠️ Socket.IO instance not initialized. tokenCreated event not emitted.');
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
        console.log(`✅ tokenCreated event emitted for ${data.tokenAddress}`);
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
        console.warn('⚠️ Socket.IO instance not initialized. tokenTraded event not emitted.');
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
        console.log(`✅ tokenTraded event emitted for ${data.tokenAddress}`);
    }
    catch (error) {
        console.error('❌ Error emitting tokenTraded event:', error);
    }
}
//# sourceMappingURL=updateEmitter.js.map