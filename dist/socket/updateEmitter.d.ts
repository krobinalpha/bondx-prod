import { Server } from 'socket.io';
/**
 * Initialize the Socket.IO instance for all token event updates
 */
export declare function initUpdateEmitter(io: Server): void;
/**
 * Emit a price update to all connected clients
 * (Consolidated from priceUpdateEmitter)
 */
export declare function emitTokenPriceUpdate(tokenAddress: string, data: {
    price: string;
    timestamp: Date | string;
    chainId: number;
}): void;
/**
 * Emit tokenBought event with transaction, holder, and token data
 */
export declare function emitTokenBought(data: {
    tokenAddress: string;
    buyer: string;
    ethAmount: string;
    tokenAmount: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date | string;
    chainId: number;
    tokenPrice: string;
    marketCap?: string;
    holders?: Array<{
        owner_address: string;
        balance: string;
        balanceUSD?: string;
        percentage?: number;
    }>;
}): void;
/**
 * Emit tokenSold event with transaction, holder, and token data
 */
export declare function emitTokenSold(data: {
    tokenAddress: string;
    seller: string;
    ethAmount: string;
    tokenAmount: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date | string;
    chainId: number;
    tokenPrice: string;
    marketCap?: string;
    holders?: Array<{
        owner_address: string;
        balance: string;
        balanceUSD?: string;
        percentage?: number;
    }>;
}): void;
/**
 * Emit tokenCreated event with token and holder data
 */
export declare function emitTokenCreated(data: {
    tokenAddress: string;
    creatorAddress: string;
    name: string;
    symbol: string;
    description: string;
    logo: string;
    totalSupply: string;
    chainId: number;
    tokenPrice: string;
    marketCap?: string;
    holders?: Array<{
        owner_address: string;
        balance: string;
        balanceUSD?: string;
        percentage?: number;
    }>;
    timestamp: Date | string;
}): void;
/**
 * Emit tokenTraded event (direct transfers) with transaction, holder, and token data
 */
export declare function emitTokenTraded(data: {
    tokenAddress: string;
    from: string;
    to: string;
    value: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date | string;
    chainId: number;
    tokenPrice: string;
    marketCap?: string;
    holders?: Array<{
        owner_address: string;
        balance: string;
        balanceUSD?: string;
        percentage?: number;
    }>;
}): void;
//# sourceMappingURL=updateEmitter.d.ts.map