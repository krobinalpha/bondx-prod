import { Request } from 'express';
import { Document, Types, Model } from 'mongoose';
export interface AuthRequest extends Request {
    user?: IUser;
}
export interface IUser extends Document {
    _id: Types.ObjectId;
    username: string;
    email: string;
    password: string;
    walletAddresses: Array<{
        address: string;
        isPrimary: boolean;
        isSmartWallet?: boolean;
        verifiedAt: Date | null;
    }>;
    avatar: string;
    bio: string;
    website: string;
    twitter: string;
    telegram: string;
    discord: string;
    github: string;
    tokensCreated: number;
    totalVolume: string;
    totalVolumeUSD: string;
    isVerified: boolean;
    isActive: boolean;
    isBanned: boolean;
    role: 'user' | 'moderator' | 'admin';
    twoFactorEnabled: boolean;
    twoFactorSecret: string | null;
    lastLoginAt: Date | null;
    loginAttempts: number;
    lockUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
    addWalletAddress(address: string, isSmartWallet?: boolean): Promise<IUser>;
    setPrimaryWallet(address: string): Promise<IUser>;
    verifyWallet(address: string): Promise<IUser>;
}
export interface UserModel extends Model<IUser> {
    findByWalletAddress(address: string): Promise<IUser | null>;
    findTopCreators(limit?: number): Promise<IUser[]>;
}
export interface IToken extends Document {
    _id: Types.ObjectId;
    name: string;
    symbol: string;
    address: string;
    chainId: number;
    creatorAddress: string;
    logo: string;
    description: string;
    website: string;
    youtube: string;
    discord: string;
    twitter: string;
    telegram: string;
    totalSupply: string;
    circulatingSupply: string;
    currentPrice: string;
    currentPriceUSD: string;
    marketCap: string;
    marketCapUSD: string;
    totalLiquidity: string;
    totalLiquidityUSD: string;
    graduationEth: string;
    graduationProgress: string;
    volume24h: string;
    volume24hUSD: string;
    priceChange24h: string;
    priceChange24hPercent: string;
    isVerified: boolean;
    isActive: boolean;
    isHoneypot: boolean;
    createdAt: Date;
    updatedAt: Date;
    latestTransactionTimestamp: Date;
    deploymentTxHash: string;
    deploymentBlock: number;
    tags: string[];
    auditScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'extreme';
    updatePriceData(priceData: PriceData): Promise<IToken>;
}
export interface PriceData {
    price: string;
    priceUSD: string;
    marketCap: string;
    marketCapUSD: string;
    volume24h: string;
    volume24hUSD: string;
    priceChange24h: string;
    priceChange24hPercent: string;
}
export interface ITransaction extends Document {
    _id: Types.ObjectId;
    txHash: string;
    tokenId: string;
    tokenAddress: string;
    type: 'Bought' | 'Sold' | 'Add_liquidity' | 'Remove_liquidity' | 'Transfer' | 'Mint' | 'Burn';
    senderAddress: string;
    recipientAddress: string;
    ethAmount: string;
    tokenAmount: string;
    tokenPrice: string;
    tokenPriceUSD: string;
    gasUsed: string;
    gasPrice: string;
    gasCost: string;
    gasCostUSD: string;
    blockNumber: number;
    blockTimestamp: Date;
    chainId: number;
    status: 'pending' | 'confirmed' | 'failed';
    methodName: string;
    inputData: string;
    createdAt: Date;
    updatedAt: Date;
    calculateGasCostUSD(ethPriceUSD: string): Promise<ITransaction>;
}
export interface IActivity extends Document {
    _id: Types.ObjectId;
    type: 'deposit' | 'withdraw';
    walletAddress: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
    amountUSD: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date;
    chainId: number;
    status: 'pending' | 'confirmed' | 'failed';
    gasUsed: string;
    gasCost: string;
    userId: Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface ILiquidityEvent extends Document {
    _id: Types.ObjectId;
    tokenId: string;
    tokenAddress: string;
    type: 'add' | 'remove';
    providerAddress: string;
    ethAmount: string;
    tokenAmount: string;
    tokenPrice: string;
    tokenPriceUSD: string;
    liquidityPoolAddress: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date;
    chainId: number;
    status: 'pending' | 'confirmed' | 'failed';
    methodName: string;
    inputData: string;
    createdAt: Date;
    updatedAt: Date;
    calculateTotalValue(ethPriceUSD: string): string;
}
export interface ITokenHolder extends Document {
    _id: Types.ObjectId;
    tokenId: string;
    tokenAddress: string;
    holderAddress: string;
    balance: string;
    balanceUSD: string;
    percentage: number;
    firstTransactionHash: string;
    lastTransactionHash: string;
    transactionCount: number;
    chainId: number;
    createdAt: Date;
    updatedAt: Date;
}
export interface ITokenHistory extends Document {
    _id: Types.ObjectId;
    tokenId: string;
    tokenAddress: string;
    timestamp: Date;
    tokenPrice: string;
    price: string;
    priceUSD: string;
    marketCap: string;
    marketCapUSD: string;
    volume24h: string;
    volume24hUSD: string;
    totalLiquidity: string;
    totalLiquidityUSD: string;
    holdersCount: number;
    transactionsCount: number;
    blockNumber: number;
    chainId: number;
    createdAt: Date;
}
export interface IChatMessage extends Document {
    _id: Types.ObjectId;
    user: string;
    token: string;
    message: string;
    reply_to: number | null;
    timestamp: Date;
    editedAt?: Date;
    isDeleted?: boolean;
    deletedAt?: Date;
}
export interface JWTPayload {
    userId: string;
    email: string;
    role: string;
}
export interface ErrorHandler extends Error {
    status?: number;
    statusCode?: number;
}
export interface PaginationQuery {
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
    };
}
//# sourceMappingURL=index.d.ts.map