import Activity from '../models/Activity';
import { IActivity } from '../types';
import { getEthPriceUSD } from './ethPriceService';
import { ethers } from 'ethers';
import { logger } from '../utils/logger';
import { ACTIVITY_MONITOR_CONFIG } from '../config/activityMonitor';

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a database operation with exponential backoff
 */
async function retryDbOperation<T>(
  operation: () => Promise<T>,
  maxAttempts: number = ACTIVITY_MONITOR_CONFIG.DB_RETRY_MAX_ATTEMPTS,
  baseDelay: number = ACTIVITY_MONITOR_CONFIG.DB_RETRY_DELAY_BASE
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on duplicate key errors (11000)
      if (error.code === 11000) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxAttempts - 1) {
        throw error;
      }
      
      const delayMs = baseDelay * Math.pow(2, attempt);
      logger.warn(`Database operation failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})`, { error: error.message });
      await delay(delayMs);
    }
  }
  
  throw lastError || new Error('Database operation failed after retries');
}

/**
 * Save activity to database with duplicate prevention
 * @param activityData Activity data to save
 * @returns Saved activity document
 */
export async function saveActivity(activityData: {
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
}): Promise<IActivity> {
  try {
    // Check if activity already exists (prevent duplicates)
    const existing = await Activity.findOne({
      txHash: activityData.txHash.toLowerCase(),
      chainId: activityData.chainId
    });

    if (existing) {
      return existing;
    }

    // Calculate USD amount if not provided
    let amountUSD = '0';
    if (activityData.amount && activityData.amount !== '0') {
      try {
        const ethPriceUSD = await getEthPriceUSD();
        const amountInEth = parseFloat(ethers.formatEther(activityData.amount));
        const ethPrice = parseFloat(ethPriceUSD);
        
        // Validate parseFloat results are valid numbers
        if (!isFinite(amountInEth) || isNaN(amountInEth) || amountInEth < 0) {
          logger.warn('Invalid amountInEth calculated:', { amount: activityData.amount, amountInEth });
          amountUSD = '0';
        } else if (!isFinite(ethPrice) || isNaN(ethPrice) || ethPrice <= 0) {
          logger.warn('Invalid ethPriceUSD:', { ethPriceUSD, ethPrice });
          amountUSD = '0';
        } else {
          const usdValue = amountInEth * ethPrice;
          // Validate final result
          if (!isFinite(usdValue) || isNaN(usdValue) || usdValue < 0) {
            logger.warn('Invalid USD value calculated:', { amountInEth, ethPrice, usdValue });
            amountUSD = '0';
          } else {
            amountUSD = usdValue.toString();
          }
        }
      } catch (error) {
        logger.error('Error calculating USD amount for activity', error);
        // Continue without USD amount
      }
    }

    // Create activity with retry logic
    const activity = await retryDbOperation(async () => {
      return await Activity.create({
        ...activityData,
        txHash: activityData.txHash.toLowerCase(),
        walletAddress: activityData.walletAddress.toLowerCase(),
        fromAddress: activityData.fromAddress.toLowerCase(),
        toAddress: activityData.toAddress.toLowerCase(),
        amountUSD,
        status: activityData.status || 'confirmed',
        gasUsed: activityData.gasUsed || '0',
        gasCost: activityData.gasCost || '0',
        userId: activityData.userId || null
      });
    });

    return activity;
  } catch (error: any) {
    // Handle duplicate key error gracefully
    if (error.code === 11000) {
      // Duplicate entry - return existing
      const existing = await Activity.findOne({
        txHash: activityData.txHash.toLowerCase(),
        chainId: activityData.chainId
      });
      if (existing) {
        return existing;
      }
    }
    throw error;
  }
}

/**
 * Get activities for a wallet address with pagination
 * @param walletAddress Wallet address to query
 * @param chainId Optional chain ID filter
 * @param page Page number (default: 1)
 * @param pageSize Page size (default: 10)
 * @param type Optional type filter ('deposit' | 'withdraw')
 * @returns Paginated activities
 */
export async function getActivitiesByWallet(
  walletAddress: string,
  chainId?: number,
  page: number = 1,
  pageSize: number = 10,
  type?: 'deposit' | 'withdraw'
): Promise<{
  activities: IActivity[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}> {
  const skip = (page - 1) * pageSize;
  const limit = pageSize;

  // Build query
  const query: any = {
    walletAddress: walletAddress.toLowerCase()
  };

  if (chainId) {
    query.chainId = chainId;
  }

  if (type) {
    query.type = type;
  }

  // Fetch activities and total count
  const [activities, totalCount] = await Promise.all([
    Activity.find(query)
      .sort({ blockTimestamp: -1 }) // Newest first
      .skip(skip)
      .limit(limit)
      .lean(),
    Activity.countDocuments(query)
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return {
    activities: activities as unknown as IActivity[],
    totalCount,
    currentPage: page,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1
  };
}

/**
 * Save multiple activities in batch (optimized for performance)
 * @param activitiesData Array of activity data to save
 * @returns Array of saved activity documents
 */
export async function saveActivitiesBatch(
  activitiesData: Array<{
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
    amountUSD?: string; // Optional - will be calculated if not provided
  }>
): Promise<IActivity[]> {
  if (activitiesData.length === 0) {
    logger.debug('saveActivitiesBatch called with empty array');
    return [];
  }

  logger.info(`saveActivitiesBatch: Processing ${activitiesData.length} activities`, {
    count: activitiesData.length,
    chainIds: [...new Set(activitiesData.map(a => a.chainId))],
    sampleTxHash: activitiesData[0]?.txHash
  });

  try {
    // Get all txHashes to check for duplicates in one query
    const txHashes = activitiesData.map(a => a.txHash.toLowerCase());
    const chainIds = [...new Set(activitiesData.map(a => a.chainId))];
    
    logger.debug(`saveActivitiesBatch: Checking for duplicates`, {
      txHashCount: txHashes.length,
      chainIds: chainIds
    });

    const existingActivities = await Activity.find({
      txHash: { $in: txHashes },
      chainId: { $in: chainIds }
    }).select('txHash chainId').lean();

    logger.debug(`saveActivitiesBatch: Found ${existingActivities.length} existing activities`, {
      existingCount: existingActivities.length,
      existingTxHashes: existingActivities.map((a: any) => `${a.txHash}-${a.chainId}`)
    });

    const existingKeys = new Set(
      existingActivities.map(a => `${(a as any).txHash.toLowerCase()}-${a.chainId}`)
    );

    // Filter out duplicates
    const newActivities = activitiesData.filter(
      a => !existingKeys.has(`${a.txHash.toLowerCase()}-${a.chainId}`)
    );

    if (newActivities.length === 0) {
      logger.info(`saveActivitiesBatch: All ${activitiesData.length} activities were duplicates`, {
        totalCount: activitiesData.length,
        duplicateTxHashes: txHashes
      });
      return [];
    }

    logger.info(`saveActivitiesBatch: ${newActivities.length} new activities to insert (${activitiesData.length - newActivities.length} duplicates filtered)`, {
      newCount: newActivities.length,
      duplicateCount: activitiesData.length - newActivities.length
    });

    // Get ETH price once for all activities (batch USD calculation)
    let ethPriceUSD = '0';
    try {
      ethPriceUSD = await getEthPriceUSD();
    } catch (error) {
      logger.error('Error fetching ETH price for batch USD calculation', error);
      // Continue without USD amounts
    }

    // Prepare activities for batch insert
    const activitiesToInsert = newActivities.map(activityData => {
      // Calculate USD amount if not provided
      let amountUSD = activityData.amountUSD || '0';
      if (!activityData.amountUSD && activityData.amount && activityData.amount !== '0' && ethPriceUSD !== '0') {
        try {
          const amountInEth = parseFloat(ethers.formatEther(activityData.amount));
          const usdValue = amountInEth * parseFloat(ethPriceUSD);
          amountUSD = usdValue.toString();
        } catch (error) {
          // Continue without USD amount
          amountUSD = '0';
        }
      }

      return {
        type: activityData.type,
        walletAddress: activityData.walletAddress.toLowerCase(),
        fromAddress: activityData.fromAddress.toLowerCase(),
        toAddress: activityData.toAddress.toLowerCase(),
        amount: activityData.amount,
        amountUSD,
        txHash: activityData.txHash.toLowerCase(),
        blockNumber: activityData.blockNumber,
        blockTimestamp: activityData.blockTimestamp,
        chainId: activityData.chainId,
        status: activityData.status || 'confirmed',
        gasUsed: activityData.gasUsed || '0',
        gasCost: activityData.gasCost || '0',
        userId: activityData.userId || null
      };
    });

    // Batch insert all activities at once with retry logic
    logger.info(`saveActivitiesBatch: Attempting to insert ${activitiesToInsert.length} activities into database`, {
      count: activitiesToInsert.length,
      sampleActivity: activitiesToInsert[0] ? {
        txHash: activitiesToInsert[0].txHash,
        walletAddress: activitiesToInsert[0].walletAddress,
        chainId: activitiesToInsert[0].chainId
      } : null
    });

    const savedActivities = await retryDbOperation(async () => {
      return await Activity.insertMany(activitiesToInsert, {
        ordered: false // Continue inserting even if some fail (duplicates)
      });
    });

    logger.info(`saveActivitiesBatch: Successfully inserted ${savedActivities.length} activities`, {
      insertedCount: savedActivities.length,
      requestedCount: activitiesToInsert.length
    });

    return savedActivities;
  } catch (error: any) {
    logger.error(`saveActivitiesBatch: Error occurred`, {
      error: error.message,
      errorCode: error.code,
      errorName: error.name,
      writeErrors: error.writeErrors,
      activitiesCount: activitiesData.length,
      stack: error.stack
    });

    // Handle partial failures (some duplicates might still exist)
    if (error.code === 11000 || error.writeErrors) {
      logger.info(`saveActivitiesBatch: Handling partial failure (duplicates)`, {
        errorCode: error.code,
        writeErrorCount: error.writeErrors?.length || 0
      });

      // Some activities were inserted, some failed due to duplicates
      // Fetch the successfully inserted ones
      const txHashes = activitiesData.map(a => a.txHash.toLowerCase());
      const chainIds = [...new Set(activitiesData.map(a => a.chainId))];
      
      const inserted = await Activity.find({
        txHash: { $in: txHashes },
        chainId: { $in: chainIds }
      }).lean();

      logger.info(`saveActivitiesBatch: Retrieved ${inserted.length} successfully inserted activities after partial failure`, {
        insertedCount: inserted.length,
        requestedCount: activitiesData.length
      });

      return inserted as unknown as IActivity[];
    }
    throw error;
  }
}

/**
 * Check blockchain for new deposits (used by monitor)
 * This function can be called periodically to check for missed deposits
 * @param walletAddress Wallet address to check
 * @param chainId Chain ID
 * @param fromBlock Optional starting block number
 * @param toBlock Optional ending block number
 * @returns Array of new deposit activities found
 */
export async function checkForDeposits(
  _walletAddress: string,
  _chainId: number,
  _fromBlock?: number,
  _toBlock?: number
): Promise<IActivity[]> {
  // This function will be implemented in activityMonitor
  // It's here for the service interface
  // The actual implementation will query the blockchain directly
  return [];
}

