import { IActivity } from '../types';
/**
 * Save activity to database with duplicate prevention
 * @param activityData Activity data to save
 * @returns Saved activity document
 */
export declare function saveActivity(activityData: {
    type: 'deposit' | 'withdraw';
    walletAddress: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date;
    chainId: number;
    status?: 'pending' | 'confirmed' | 'failed';
    gasUsed?: string;
    gasCost?: string;
    userId?: string;
}): Promise<IActivity>;
/**
 * Get activities for a wallet address with pagination
 * @param walletAddress Wallet address to query
 * @param chainId Optional chain ID filter
 * @param page Page number (default: 1)
 * @param pageSize Page size (default: 10)
 * @param type Optional type filter ('deposit' | 'withdraw')
 * @returns Paginated activities
 */
export declare function getActivitiesByWallet(walletAddress: string, chainId?: number, page?: number, pageSize?: number, type?: 'deposit' | 'withdraw'): Promise<{
    activities: IActivity[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}>;
/**
 * Save multiple activities in batch (optimized for performance)
 * @param activitiesData Array of activity data to save
 * @returns Array of saved activity documents
 */
export declare function saveActivitiesBatch(activitiesData: Array<{
    type: 'deposit' | 'withdraw';
    walletAddress: string;
    fromAddress: string;
    toAddress: string;
    amount: string;
    txHash: string;
    blockNumber: number;
    blockTimestamp: Date;
    chainId: number;
    status?: 'pending' | 'confirmed' | 'failed';
    gasUsed?: string;
    gasCost?: string;
    userId?: string;
    amountUSD?: string;
}>): Promise<IActivity[]>;
/**
 * Check blockchain for new deposits (used by monitor)
 * This function can be called periodically to check for missed deposits
 * @param walletAddress Wallet address to check
 * @param chainId Chain ID
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Array of new deposit activities found
 */
export declare function checkForDeposits(_walletAddress: string, _chainId: number, _fromBlock?: number, _toBlock?: number): Promise<IActivity[]>;
//# sourceMappingURL=activityService.d.ts.map