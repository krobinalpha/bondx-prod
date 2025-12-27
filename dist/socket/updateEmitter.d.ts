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
    priceUSD?: string;
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
    graduationProgress?: string;
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
    graduationProgress?: string;
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
/**
 * Emit depositDetected event when a deposit is detected for an embedded wallet
 * This enables real-time notifications and balance updates in the frontend
 * Emits to user-specific room if userId is provided, otherwise broadcasts
 */
export declare function emitDepositDetected(data: {
    walletAddress: string;
    fromAddress: string;
    amount: string;
    amountFormatted?: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date | string;
    chainId: number;
    userId?: string;
}): void;
/**
 * Emit withdrawDetected event when a withdrawal is detected for an embedded wallet
 * This enables real-time notifications and balance updates in the frontend
 * Emits to user-specific room if userId is provided, otherwise broadcasts
 */
export declare function emitWithdrawDetected(data: {
    walletAddress: string;
    toAddress: string;
    amount: string;
    amountFormatted?: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date | string;
    chainId: number;
    userId?: string;
}): void;
/**
 * Emit balanceUpdate event when balance changes (after deposit/withdraw)
 * This enables real-time balance updates in the frontend (Binance-like approach)
 * Balance is fetched fresh from blockchain after database update
 */
export declare function emitBalanceUpdate(data: {
    walletAddress: string;
    balance: string;
    balanceFormatted: string;
    chainId: number;
    userId: string;
}): void;
//# sourceMappingURL=updateEmitter.d.ts.map