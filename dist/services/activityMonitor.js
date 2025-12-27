"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startActivityMonitoring = startActivityMonitoring;
exports.stopActivityMonitoring = stopActivityMonitoring;
exports.addWalletToMonitoring = addWalletToMonitoring;
exports.getMonitoringDiagnostics = getMonitoringDiagnostics;
exports.isWalletMonitored = isWalletMonitored;
exports.getWalletMonitoringStatus = getWalletMonitoringStatus;
exports.triggerDepositCheck = triggerDepositCheck;
exports.checkWalletForDeposits = checkWalletForDeposits;
const ethers_1 = require("ethers");
const User_1 = __importDefault(require("../models/User"));
const activityService_1 = require("./activityService");
const blockchain_1 = require("../config/blockchain");
const logger_1 = require("../utils/logger");
const activityMonitor_1 = require("../config/activityMonitor");
// Store monitored wallets per chain
const monitoredWallets = new Map();
// Store wallet to userId mapping for activity tracking
const walletToUserId = new Map();
const monitoringIntervals = new Map();
// Store WebSocket providers for real-time monitoring
const wsProviders = new Map();
const wsSubscriptions = new Map();
const wsHealthChecks = new Map(); // Track health check intervals
const wsTimeBasedIntervals = new Map(); // Track time-based check intervals (10-second intervals as fallback)
const wsBlockProcessingTimeouts = new Map(); // Track debounced block processing timeouts per chain
// Track last checked block per chain
const lastCheckedBlock = new Map();
// Track last known block number per chain (from WebSocket events)
// This eliminates the need for getBlockNumber RPC calls
const lastKnownBlockNumber = new Map();
// Track timestamp of last known block number (for staleness checks)
const lastKnownBlockTimestamp = new Map(); // chainId -> timestamp
// Track blocks currently being processed to prevent duplicate fetches
const blocksBeingProcessed = new Map(); // chainId -> Set<blockNumber>
// Rate limit tracking for adaptive throttling
const rateLimitCount = new Map(); // Consecutive rate limit errors per chain
const rateLimitFrequency = new Map(); // Timestamps of rate limit errors (for frequency calculation)
// Circuit breaker: track when to stop checking due to excessive rate limits
const circuitBreaker = new Map();
// Concurrency control: prevent multiple checkForDeposits running simultaneously for same chain
const activeChecks = new Map();
// Track number of new blocks since last check per chain (for batching)
const blocksSinceLastCheck = new Map();
// Helper function for rate limiting delays
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/**
 * Check if WebSocket is connected and ready for a given chain
 */
function isWebSocketReady(chainId) {
    const wsProvider = wsProviders.get(chainId);
    if (!wsProvider)
        return false;
    try {
        const underlyingWs = wsProvider.websocket || wsProvider._websocket;
        if (underlyingWs) {
            const readyState = underlyingWs.readyState;
            // WebSocket readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSING, 3 = CLOSED
            return readyState === 1; // OPEN
        }
    }
    catch (error) {
        // Ignore errors
    }
    return false;
}
// Global RPC request queue
const globalRequestQueue = [];
let activeRequests = 0;
let lastGetBlockNumberTime = 0;
/**
 * Wait for an available RPC request slot
 * This prevents exceeding Alchemy's concurrent request limit
 * Also enforces minimum delay between getBlockNumber calls to prevent per-second rate limits
 */
async function waitForRequestSlot() {
    return new Promise((resolve) => {
        const now = Date.now();
        const timeSinceLastRequest = now - lastGetBlockNumberTime;
        const delayNeeded = Math.max(0, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MIN_DELAY_BETWEEN_GET_BLOCK_NUMBER - timeSinceLastRequest);
        if (activeRequests < activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_CONCURRENT_REQUESTS && delayNeeded === 0) {
            activeRequests++;
            lastGetBlockNumberTime = now;
            resolve();
        }
        else {
            const executeRequest = () => {
                activeRequests++;
                lastGetBlockNumberTime = Date.now();
                resolve();
            };
            if (activeRequests < activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_CONCURRENT_REQUESTS) {
                setTimeout(executeRequest, delayNeeded);
            }
            else {
                globalRequestQueue.push({ resolve: executeRequest, timestamp: now });
            }
        }
    });
}
/**
 * Release an RPC request slot and process next queued request
 * Uses longer delay to ensure proper spacing between requests (prevents per-second rate limits)
 */
function releaseRequestSlot() {
    activeRequests = Math.max(0, activeRequests - 1);
    if (globalRequestQueue.length > 0) {
        const next = globalRequestQueue.shift();
        if (next) {
            const now = Date.now();
            const timeSinceLastRequest = now - lastGetBlockNumberTime;
            const delayNeeded = Math.max(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MIN_DELAY_BETWEEN_GET_BLOCK_NUMBER, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MIN_DELAY_BETWEEN_GET_BLOCK_NUMBER - timeSinceLastRequest);
            setTimeout(() => next.resolve(), delayNeeded);
        }
    }
}
/**
 * Get block number with retry logic and exponential backoff for rate limits
 * Handles Infura/rate limit errors gracefully
 */
async function getBlockNumberWithRetry(provider, chainId, maxRetries = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                const backoffDelay = Math.min(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.RETRY_BACKOFF_BASE * Math.pow(2, attempt - 1), activityMonitor_1.ACTIVITY_MONITOR_CONFIG.RETRY_BACKOFF_MAX);
                logger_1.logger.debug(`Retrying getBlockNumber for chain ${chainId}`, { attempt: attempt + 1, maxRetries, backoffDelay });
                await delay(backoffDelay);
            }
            await waitForRequestSlot();
            try {
                const blockNumber = await provider.getBlockNumber();
                if (attempt > 0) {
                    const currentCount = rateLimitCount.get(chainId) || 0;
                    rateLimitCount.set(chainId, Math.max(0, currentCount - 1));
                }
                return blockNumber;
            }
            finally {
                releaseRequestSlot();
            }
        }
        catch (error) {
            lastError = error;
            const isRateLimitError = error?.code === -32005 ||
                error?.code === 429 ||
                error?.code === 'BAD_DATA' ||
                error?.code === 'TIMEOUT' ||
                error?.code === 'UNKNOWN_ERROR' ||
                error?.error?.code === 429 ||
                error?.message?.includes('Too Many Requests') ||
                error?.message?.includes('exceeded its compute units') ||
                error?.message?.includes('timeout') ||
                error?.shortMessage?.includes('missing response') ||
                (Array.isArray(error?.value) && error.value.some((v) => v.code === -32005 || v.code === 429));
            if (isRateLimitError) {
                if (!rateLimitFrequency.has(chainId)) {
                    rateLimitFrequency.set(chainId, []);
                }
                const errors = rateLimitFrequency.get(chainId);
                errors.push(Date.now());
                if (errors.length > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.RATE_LIMIT_FREQUENCY_MAX_SIZE) {
                    errors.shift();
                }
                const consecutiveErrors = rateLimitCount.get(chainId) || 0;
                rateLimitCount.set(chainId, consecutiveErrors + 1);
                if (attempt === maxRetries - 1) {
                    logger_1.logger.error(`Failed to get block number for chain ${chainId} after ${maxRetries} attempts`, error);
                    throw error;
                }
                continue;
            }
            else {
                throw error;
            }
        }
    }
    throw lastError || new Error('Failed to get block number after retries');
}
/**
 * Get block with full transactions using direct RPC call
 * This ensures Ankr returns full transaction objects via eth_getBlockByNumber(blockNum, true)
 * Falls back to normal getBlock if direct RPC fails
 */
async function getBlockWithFullTransactions(provider, blockNum, chainId) {
    await waitForRequestSlot();
    try {
        const blockHex = `0x${blockNum.toString(16)}`;
        // Direct RPC call: eth_getBlockByNumber(blockNum, true)
        // The 'true' parameter should force Ankr to return full transaction objects
        const rpcResponse = await provider.send('eth_getBlockByNumber', [blockHex, true]);
        if (!rpcResponse || !rpcResponse.transactions) {
            logger_1.logger.debug(`RPC returned empty block or no transactions for block ${blockNum}`, {
                chainId,
                blockNum
            });
            return null;
        }
        // Check if transactions are full objects (have 'from' field) or just hashes (strings)
        const firstTx = rpcResponse.transactions[0];
        const transactionsAreFull = firstTx && typeof firstTx === 'object' && 'from' in firstTx && 'to' in firstTx;
        if (transactionsAreFull) {
            // Ankr returned full transactions! Parse using ethers.js utilities
            // Use ethers.js utility functions to properly format hex values from RPC response
            try {
                // Parse block header fields using ethers.js utilities
                const blockNumber = ethers_1.ethers.getNumber(rpcResponse.number);
                const timestamp = ethers_1.ethers.getNumber(rpcResponse.timestamp);
                // Parse full transactions from RPC response into TransactionResponse-like objects
                const fullTransactions = rpcResponse.transactions.map((tx, index) => ({
                    hash: tx.hash,
                    to: tx.to,
                    from: tx.from,
                    value: tx.value ? ethers_1.ethers.getBigInt(tx.value) : 0n,
                    data: tx.input || '0x',
                    blockNumber: blockNumber,
                    blockHash: rpcResponse.hash,
                    transactionIndex: tx.transactionIndex !== undefined ? ethers_1.ethers.getNumber(tx.transactionIndex) : index,
                    gasLimit: tx.gas ? ethers_1.ethers.getBigInt(tx.gas) : 0n,
                    gasPrice: tx.gasPrice ? ethers_1.ethers.getBigInt(tx.gasPrice) : null,
                    nonce: tx.nonce !== undefined ? ethers_1.ethers.getNumber(tx.nonce) : 0,
                    type: tx.type !== undefined ? ethers_1.ethers.getNumber(tx.type) : 0,
                    accessList: tx.accessList || null,
                    maxFeePerGas: tx.maxFeePerGas ? ethers_1.ethers.getBigInt(tx.maxFeePerGas) : null,
                    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? ethers_1.ethers.getBigInt(tx.maxPriorityFeePerGas) : null,
                    chainId: tx.chainId ? ethers_1.ethers.getNumber(tx.chainId) : chainId,
                    confirmations: 1,
                }));
                // Construct Block object directly from parsed RPC response
                // This matches ethers.Block interface without needing another RPC call
                const block = {
                    hash: rpcResponse.hash,
                    number: blockNumber,
                    timestamp: timestamp,
                    transactions: fullTransactions,
                    gasLimit: rpcResponse.gasLimit ? ethers_1.ethers.getBigInt(rpcResponse.gasLimit) : 0n,
                    gasUsed: rpcResponse.gasUsed ? ethers_1.ethers.getBigInt(rpcResponse.gasUsed) : 0n,
                    extraData: rpcResponse.extraData || '0x',
                    miner: rpcResponse.miner || '0x',
                    parentHash: rpcResponse.parentHash || '0x',
                    receiptsRoot: rpcResponse.receiptsRoot || rpcResponse.receiptRoot || '0x',
                    stateRoot: rpcResponse.stateRoot || '0x',
                    transactionsRoot: rpcResponse.transactionsRoot || '0x',
                    logsBloom: rpcResponse.logsBloom || '0x',
                    difficulty: rpcResponse.difficulty ? ethers_1.ethers.getBigInt(rpcResponse.difficulty) : null,
                    totalDifficulty: rpcResponse.totalDifficulty ? ethers_1.ethers.getBigInt(rpcResponse.totalDifficulty) : null,
                    nonce: rpcResponse.nonce || null,
                    baseFeePerGas: rpcResponse.baseFeePerGas ? ethers_1.ethers.getBigInt(rpcResponse.baseFeePerGas) : null,
                };
                // Verify that transactions are full objects (not hashes)
                if (block.transactions.length > 0) {
                    const firstBlockTx = block.transactions[0];
                    if (typeof firstBlockTx === 'string') {
                        // Shouldn't happen, but check anyway
                        logger_1.logger.warn(`Block ${blockNum} transactions are still hashes after parsing`, {
                            chainId,
                            blockNum
                        });
                        // Fallback to normal getBlock (will trigger individual transaction fetching)
                        return await provider.getBlock(blockNum, true);
                    }
                    // Success! Block has full transactions from single RPC call
                    logger_1.logger.debug(`Successfully fetched block ${blockNum} with ${block.transactions.length} full transactions via eth_getBlockByNumber(blockNum, true)`, {
                        chainId,
                        blockNum,
                        transactionCount: block.transactions.length,
                        note: 'Single RPC call - parsed with ethers.js utilities - minimal credit usage'
                    });
                    return block;
                }
                else {
                    // Empty transactions array
                    logger_1.logger.debug(`Block ${blockNum} has no transactions`, {
                        chainId,
                        blockNum
                    });
                    return block;
                }
            }
            catch (parseError) {
                logger_1.logger.warn(`Failed to parse RPC response for block ${blockNum}, using fallback`, {
                    chainId,
                    blockNum,
                    error: parseError.message || String(parseError)
                });
                // Fallback to normal getBlock (will trigger individual transaction fetching)
                return await provider.getBlock(blockNum, true);
            }
        }
        else {
            // Ankr returned hashes despite eth_getBlockByNumber(blockNum, true)
            // This means Ankr doesn't support fullTransactions parameter or has a limitation
            logger_1.logger.warn(`Ankr returned transaction hashes for block ${blockNum} despite eth_getBlockByNumber(blockNum, true)`, {
                chainId,
                blockNum,
                transactionCount: rpcResponse.transactions.length,
                firstTxType: typeof firstTx,
                note: 'Ankr may not support fullTransactions parameter. Will fetch transactions individually.'
            });
            // Fallback to normal getBlock (will trigger individual transaction fetching)
            return await provider.getBlock(blockNum, true);
        }
    }
    catch (error) {
        // Direct RPC call failed - fallback to normal getBlock
        logger_1.logger.debug(`Direct RPC call failed for block ${blockNum}, using fallback`, {
            chainId,
            blockNum,
            error: error.message || String(error)
        });
        // Fallback to normal getBlock
        return await provider.getBlock(blockNum, true);
    }
    finally {
        releaseRequestSlot();
    }
}
/**
 * Get all embedded wallet addresses from database with pagination
 * Optimized for large datasets (10k+ wallets)
 */
async function getAllEmbeddedWallets() {
    try {
        const wallets = [];
        const chains = (0, blockchain_1.getConfiguredChains)();
        const BATCH_SIZE = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.DB_BATCH_SIZE;
        let skip = 0;
        let hasMore = true;
        while (hasMore) {
            const users = await User_1.default.find({
                'walletAddresses.isSmartWallet': true
            })
                .select('walletAddresses _id')
                .skip(skip)
                .limit(BATCH_SIZE)
                .lean();
            if (users.length === 0) {
                hasMore = false;
                break;
            }
            users.forEach((user) => {
                user.walletAddresses.forEach((wallet) => {
                    if (wallet.isSmartWallet && wallet.address) {
                        chains.forEach(chainId => {
                            wallets.push({
                                address: wallet.address.toLowerCase(),
                                chainId: chainId,
                                userId: user._id.toString()
                            });
                        });
                    }
                });
            });
            skip += BATCH_SIZE;
            hasMore = users.length === BATCH_SIZE;
        }
        return wallets;
    }
    catch (error) {
        logger_1.logger.error('Error fetching embedded wallets', error);
        return [];
    }
}
/**
 * Helper function to process transactions in a block and extract deposits
 */
function processBlockTransactions(block, blockNum, walletSet, depositsToSave, chainId) {
    if (!block || !block.transactions) {
        return;
    }
    const blockTimestamp = block.timestamp ? new Date(block.timestamp * 1000) : new Date();
    // CRITICAL: Log walletSet for debugging (only if there are transactions and wallets)
    if (block.transactions.length > 0 && walletSet.size > 0) {
        logger_1.logger.debug(`Processing ${block.transactions.length} transactions in block ${blockNum} on chain ${chainId}`, {
            chainId,
            blockNum,
            transactionCount: block.transactions.length,
            walletSetSize: walletSet.size,
            walletSetSample: Array.from(walletSet).slice(0, 3) // First 3 for debugging
        });
    }
    // Check each transaction in the block
    let txCount = 0;
    let skippedStrings = 0;
    let skippedContractCreation = 0;
    let sampleTxTos = []; // Collect sample addresses for analysis
    const walletSetArray = Array.from(walletSet); // Convert to array for detailed comparison
    for (const tx of block.transactions) {
        // CRITICAL: Log transaction type BEFORE skipping to diagnose issues
        if (txCount === 0 && skippedStrings === 0 && skippedContractCreation === 0) {
            // Log details for first transaction only to understand format
            logger_1.logger.debug(`First transaction in block ${blockNum} analysis`, {
                chainId,
                blockNum,
                txType: typeof tx,
                isString: typeof tx === 'string',
                isObject: typeof tx === 'object',
                hasTo: tx && typeof tx === 'object' ? ('to' in tx) : false,
                txKeys: tx && typeof tx === 'object' ? Object.keys(tx).slice(0, 10) : [],
                txToString: typeof tx === 'string' ? tx.substring(0, 20) + '...' : 'not a string'
            });
        }
        // Skip if not a full transaction object
        if (typeof tx === 'string') {
            skippedStrings++;
            continue;
        }
        // Type assertion: after the check above, tx is a TransactionResponse
        const txResponse = tx;
        // CRITICAL FIX: Check tx.to !== null BEFORE calling toLowerCase()
        // Contract creation transactions have tx.to === null, which should be skipped
        if (txResponse.to === null || !txResponse.to) {
            skippedContractCreation++;
            continue; // Skip contract creation transactions (they don't have a recipient)
        }
        // Enhanced transaction detection with better variable extraction
        const txTo = txResponse.to.toLowerCase(); // Safe now - we've checked tx.to !== null above
        const txFrom = txResponse.from?.toLowerCase();
        // CRITICAL: Collect sample transaction 'to' addresses for debugging
        txCount++;
        if (txCount <= 10 && txTo) {
            sampleTxTos.push(txTo);
        }
        // CRITICAL: Check if this address matches any in walletSet (with detailed logging for first few)
        if (txCount <= 5 && walletSet.size > 0) {
            const matchesWallet = walletSetArray.some(w => w.toLowerCase() === txTo.toLowerCase());
            const walletSetHas = walletSet.has(txTo);
            const directComparisons = walletSetArray.map(w => ({
                wallet: w,
                walletLower: w.toLowerCase(),
                txTo: txTo,
                exactMatch: w === txTo,
                caseInsensitiveMatch: w.toLowerCase() === txTo.toLowerCase()
            }));
            logger_1.logger.debug(`Checking transaction ${txCount} in block ${blockNum}`, {
                chainId,
                blockNum,
                txTo,
                txFrom: txFrom || 'missing',
                walletSet: walletSetArray,
                matchesWallet,
                walletSetHas,
                directComparisons
            });
        }
        // CRITICAL FIX: Normalize tx.value to bigint if needed
        // ethers.js returns value as bigint, but we need to handle edge cases
        let txValue;
        if (txResponse.value === undefined || txResponse.value === null) {
            txValue = 0n;
        }
        else if (typeof txResponse.value === 'string') {
            // Handle string values (shouldn't happen with ethers, but be safe)
            try {
                txValue = BigInt(txResponse.value);
            }
            catch {
                txValue = 0n;
            }
        }
        else if (typeof txResponse.value === 'bigint') {
            txValue = txResponse.value;
        }
        else if (typeof txResponse.value === 'number') {
            // Handle number values (shouldn't happen, but be safe)
            txValue = BigInt(txResponse.value);
        }
        else {
            txValue = 0n;
        }
        const txHash = txResponse.hash?.toLowerCase();
        // Check if this is an ETH transfer to ANY monitored wallet
        const isToMonitoredWallet = txTo && walletSet.has(txTo);
        const isFromMonitoredWallet = txFrom && walletSet.has(txFrom);
        // FIXED: Simplified validation - removed redundant checks
        // txTo is guaranteed to be a string (not null/undefined) after the check above
        const isValidTransfer = isToMonitoredWallet && // Transaction is to a monitored wallet
            txFrom && // Ensure from address exists
            txFrom !== txTo && // Not a self-transfer
            !isFromMonitoredWallet && // Not from another monitored wallet
            txValue > 0n && // Has ETH value
            txHash; // Has transaction hash
        // CRITICAL: Log when transaction is to a monitored wallet
        if (isToMonitoredWallet) {
            logger_1.logger.debug(`Transaction to monitored wallet found in block ${blockNum}`, {
                chainId,
                blockNum,
                txHash: txHash || 'missing',
                txTo,
                txFrom: txFrom || 'missing',
                txValue: txValue.toString(),
                isToMonitoredWallet,
                isValidTransfer,
                reason: !txFrom ? 'no from address' :
                    txFrom === txTo ? 'self-transfer' :
                        isFromMonitoredWallet ? 'from monitored wallet' :
                            txValue === 0n ? 'zero value' :
                                !txHash ? 'no tx hash' : 'valid'
            });
        }
        // Log transactions that are to monitored wallets but don't match criteria (for debugging)
        if (isToMonitoredWallet && !isValidTransfer) {
            logger_1.logger.debug(`Transaction to monitored wallet but not detected as deposit`, {
                chainId,
                txHash: txHash || 'missing',
                txTo,
                txFrom: txFrom || 'missing',
                txValue: txValue.toString(),
                reason: !txFrom ? 'no from address' :
                    txFrom === txTo ? 'self-transfer' :
                        isFromMonitoredWallet ? 'from monitored wallet' :
                            txValue === 0n ? 'zero value' :
                                !txHash ? 'no tx hash' : 'unknown'
            });
        }
        if (isValidTransfer) {
            const amountEth = ethers_1.ethers.formatEther(txValue);
            const userId = walletToUserId.get(txTo);
            // Log deposit detection
            logger_1.logger.info(`✅ Deposit detected`, {
                chainId,
                txHash,
                walletAddress: txTo,
                fromAddress: txFrom,
                amount: amountEth,
                amountWei: txValue.toString(),
                blockNumber: blockNum,
                blockTimestamp: blockTimestamp.toISOString(),
                userId: userId || null
            });
            // Save deposit immediately when detected (simpler and more reliable)
            // Use fire-and-forget async pattern since this function is synchronous
            (async () => {
                try {
                    const savedActivity = await (0, activityService_1.saveActivity)({
                        type: 'deposit',
                        walletAddress: txTo,
                        fromAddress: txFrom,
                        toAddress: txTo,
                        amount: txValue.toString(),
                        txHash,
                        blockNumber: blockNum,
                        blockTimestamp,
                        chainId,
                        status: 'confirmed',
                        userId
                    });
                    logger_1.logger.info(`✅ Deposit saved to database immediately`, {
                        chainId,
                        txHash,
                        walletAddress: txTo,
                        fromAddress: txFrom,
                        amount: amountEth,
                        blockNumber: blockNum,
                        userId: userId || null
                    });
                    // Emit WebSocket event for real-time updates
                    try {
                        const { emitDepositDetected, emitBalanceUpdate } = await Promise.resolve().then(() => __importStar(require('../socket/updateEmitter')));
                        // Emit deposit detected event
                        emitDepositDetected({
                            walletAddress: savedActivity.walletAddress,
                            fromAddress: savedActivity.fromAddress,
                            amount: savedActivity.amount,
                            amountFormatted: ethers_1.ethers.formatEther(savedActivity.amount),
                            txHash: savedActivity.txHash,
                            blockNumber: savedActivity.blockNumber,
                            blockTimestamp: savedActivity.blockTimestamp,
                            chainId: savedActivity.chainId,
                            userId: savedActivity.userId?.toString()
                        });
                        // Fetch fresh balance and emit balance update (Binance-like approach)
                        if (savedActivity.userId) {
                            try {
                                const provider = (0, blockchain_1.getProvider)(chainId);
                                const freshBalance = await provider.getBalance(savedActivity.walletAddress);
                                const balanceFormatted = ethers_1.ethers.formatEther(freshBalance);
                                emitBalanceUpdate({
                                    walletAddress: savedActivity.walletAddress,
                                    balance: freshBalance.toString(),
                                    balanceFormatted: balanceFormatted,
                                    chainId: savedActivity.chainId,
                                    userId: savedActivity.userId.toString(),
                                });
                                logger_1.logger.info(`✅ Balance update sent to user ${savedActivity.userId}`, {
                                    walletAddress: savedActivity.walletAddress,
                                    balance: balanceFormatted,
                                    chainId
                                });
                            }
                            catch (balanceError) {
                                // Don't fail if balance fetch fails - log and continue
                                logger_1.logger.warn(`Failed to fetch/emit balance update for ${savedActivity.walletAddress}`, {
                                    error: balanceError.message,
                                    chainId
                                });
                            }
                        }
                    }
                    catch (error) {
                        // Don't fail deposit saving if event emission fails
                        logger_1.logger.warn(`Failed to emit deposit event for ${txHash}`, error);
                    }
                }
                catch (error) {
                    logger_1.logger.error(`❌ Failed to save deposit immediately, will retry in batch`, {
                        chainId,
                        txHash,
                        error: error.message,
                        errorCode: error.code,
                        stack: error.stack
                    });
                    // Fallback: Add to array for batch save (safety net)
                    depositsToSave.push({
                        txHash,
                        walletAddress: txTo,
                        fromAddress: txFrom,
                        amount: txValue.toString(),
                        blockNumber: blockNum,
                        blockTimestamp,
                        userId
                    });
                }
            })();
        }
    }
    // CRITICAL: Always log summary, even if no transactions were processed
    logger_1.logger.debug(`Transaction processing summary for block ${blockNum} on chain ${chainId}`, {
        chainId,
        blockNum,
        totalTransactions: block.transactions.length,
        skippedStrings,
        skippedContractCreation,
        processedCount: txCount,
        walletSetSize: walletSet.size,
        sampleTxTosCount: sampleTxTos.length
    });
    // CRITICAL: Log summary of transaction addresses checked (only if there are transactions and wallets)
    if (block.transactions.length > 0 && walletSet.size > 0 && sampleTxTos.length > 0) {
        const anyMatches = sampleTxTos.some(txTo => walletSet.has(txTo));
        const allComparisons = sampleTxTos.map(txTo => ({
            txTo,
            walletSetHas: walletSet.has(txTo),
            matchesAnyWallet: walletSetArray.some(w => w.toLowerCase() === txTo.toLowerCase())
        }));
        logger_1.logger.debug(`Transaction address analysis for block ${blockNum} on chain ${chainId}`, {
            chainId,
            blockNum,
            totalTransactions: block.transactions.length,
            transactionsChecked: txCount,
            walletSet: walletSetArray,
            sampleTxTos: sampleTxTos.slice(0, 10),
            anyMatches,
            allComparisons: allComparisons.slice(0, 10)
        });
    }
}
/**
 * Check for new deposits on a specific chain with concurrency control
 */
async function checkForDeposits(chainId, providedBlockNumber) {
    // Prevent concurrent execution for the same chain
    const existingCheck = activeChecks.get(chainId);
    if (existingCheck) {
        // This is expected behavior - skip if check is already running
        // Changed to info level to track when calls are skipped
        logger_1.logger.info(`⏭️ Skipping checkForDeposits for chain ${chainId} - already running`, {
            chainId,
            providedBlockNumber,
            timestamp: new Date().toISOString(),
            note: 'Another check is already in progress. Deposits will be processed when current check completes.'
        });
        return;
    }
    const checkPromise = (async () => {
        // Log when check starts
        logger_1.logger.info(`🚀 Starting checkForDeposits for chain ${chainId}`, {
            chainId,
            providedBlockNumber,
            timestamp: new Date().toISOString()
        });
        try {
            let provider;
            try {
                provider = (0, blockchain_1.getProvider)(chainId);
            }
            catch (error) {
                logger_1.logger.error(`No provider configured for chain ${chainId}`, error);
                return;
            }
            const wallets = monitoredWallets.get(chainId);
            if (!wallets || wallets.size === 0) {
                // CRITICAL: Enhanced logging to see why no wallets
                logger_1.logger.warn(`No wallets being monitored on chain ${chainId} - skipping deposit check`, {
                    chainId,
                    providedBlockNumber,
                    monitoredWalletsSize: wallets?.size || 0,
                    hasMonitoredWallets: !!wallets,
                    allChainsWithWallets: Array.from(monitoredWallets.keys())
                });
                return;
            }
            const recentErrors = (rateLimitFrequency.get(chainId) || [])
                .filter(time => Date.now() - time < 60000).length;
            const consecutiveErrors = rateLimitCount.get(chainId) || 0;
            // Circuit breaker check
            if (consecutiveErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CIRCUIT_BREAKER_THRESHOLD ||
                recentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_ERRORS_PER_MINUTE) {
                const breaker = circuitBreaker.get(chainId);
                const now = Date.now();
                if (!breaker || breaker.until < now) {
                    const cooldownUntil = now + activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CIRCUIT_BREAKER_COOLDOWN;
                    circuitBreaker.set(chainId, { enabled: true, until: cooldownUntil });
                    logger_1.logger.error(`Circuit breaker enabled for chain ${chainId}`, {
                        consecutiveErrors,
                        recentErrors,
                        cooldownMinutes: activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CIRCUIT_BREAKER_COOLDOWN / 60000
                    });
                }
                const activeBreaker = circuitBreaker.get(chainId);
                if (activeBreaker && activeBreaker.enabled && activeBreaker.until > now) {
                    return;
                }
                if (activeBreaker && activeBreaker.until <= now) {
                    rateLimitCount.set(chainId, 0);
                    rateLimitFrequency.set(chainId, []);
                    circuitBreaker.delete(chainId);
                }
            }
            if (!providedBlockNumber &&
                (consecutiveErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.HIGH_ERROR_THRESHOLD ||
                    recentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.HIGH_ERROR_RATE_THRESHOLD)) {
                return;
            }
            if (!providedBlockNumber && recentErrors > 2) {
                const preDelay = Math.min(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.PRE_DELAY_MULTIPLIER * recentErrors, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_PRE_DELAY);
                await delay(preDelay);
            }
            let currentBlock;
            if (providedBlockNumber !== undefined) {
                currentBlock = providedBlockNumber;
                lastKnownBlockNumber.set(chainId, currentBlock);
                lastKnownBlockTimestamp.set(chainId, Date.now());
            }
            else {
                const trackedBlock = lastKnownBlockNumber.get(chainId);
                const trackedBlockTimestamp = lastKnownBlockTimestamp.get(chainId);
                const now = Date.now();
                // Use cached block number if it's recent (less than 2 minutes old)
                // Blocks are typically 12s apart, so 2 minutes is very safe
                const BLOCK_CACHE_MAX_AGE = 120000; // 2 minutes
                const blockAge = trackedBlockTimestamp ? (now - trackedBlockTimestamp) : Infinity;
                if (trackedBlock && blockAge < BLOCK_CACHE_MAX_AGE) {
                    // Use cached block number - saves RPC call
                    currentBlock = trackedBlock;
                    logger_1.logger.debug(`Using cached block number for chain ${chainId}`, {
                        chainId,
                        blockNumber: currentBlock,
                        blockAgeSeconds: Math.floor(blockAge / 1000)
                    });
                }
                else {
                    const wsReady = isWebSocketReady(chainId);
                    const hasReceivedBlock = lastKnownBlockNumber.has(chainId);
                    const maxWait = (wsReady && !hasReceivedBlock)
                        ? activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_LONG
                        : activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_SHORT;
                    let trackedBlock;
                    const startWait = Date.now();
                    while (!trackedBlock && (Date.now() - startWait) < maxWait) {
                        await delay(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_CHECK_INTERVAL);
                        trackedBlock = lastKnownBlockNumber.get(chainId);
                    }
                    if (trackedBlock) {
                        currentBlock = trackedBlock;
                        lastKnownBlockTimestamp.set(chainId, Date.now());
                    }
                    else {
                        try {
                            // Only call RPC if cache is stale or missing
                            currentBlock = await getBlockNumberWithRetry(provider, chainId);
                            lastKnownBlockNumber.set(chainId, currentBlock);
                            lastKnownBlockTimestamp.set(chainId, Date.now());
                        }
                        catch (error) {
                            logger_1.logger.error(`Failed to get block number for chain ${chainId}`, error);
                            return;
                        }
                    }
                }
            }
            const lastBlock = lastCheckedBlock.get(chainId);
            // OPTIMIZATION: Skip if already up to date (saves RPC calls)
            if (lastBlock && currentBlock <= lastBlock) {
                logger_1.logger.debug(`No new blocks to check on chain ${chainId}`, {
                    chainId,
                    lastBlock,
                    currentBlock,
                    reason: 'already_up_to_date'
                });
                return;
            }
            // CRITICAL FIX: Always start from lastBlock + 1 to ensure NO BLOCKS ARE SKIPPED
            // This is the only safe way to guarantee deposit detection completeness
            // The existing batch processing loop will handle large gaps efficiently with concurrency control and rate limiting
            // For initial start (no lastBlock), start from current block (latest block) - simpler and more efficient
            const fromBlock = lastBlock ? lastBlock + 1 : currentBlock;
            const toBlock = currentBlock;
            // Calculate actual block range to process
            const actualBlockRange = toBlock - fromBlock + 1;
            // Calculate expected block time for this chain (in milliseconds)
            // Ethereum: ~12s, Base/Arbitrum: ~2s
            const BLOCK_TIME_MS = chainId === 1 ? 12000 : 2000;
            const gapTimeMinutes = (actualBlockRange * BLOCK_TIME_MS) / 60000;
            // Warning threshold: Based on chain block time (2 minutes worth of blocks)
            // This is more accurate than a fixed block count
            const MAX_EXPECTED_GAP_MS = 2 * 60 * 1000; // 2 minutes
            const MAX_EXPECTED_GAP_BLOCKS = Math.ceil(MAX_EXPECTED_GAP_MS / BLOCK_TIME_MS);
            // Warning for large gaps (indicates server downtime, WebSocket disconnection, or processing delays)
            if (actualBlockRange > MAX_EXPECTED_GAP_BLOCKS) {
                logger_1.logger.warn(`Large block gap detected for chain ${chainId}`, {
                    chainId,
                    lastBlock,
                    currentBlock,
                    fromBlock,
                    toBlock,
                    blockGap: actualBlockRange,
                    gapTimeMinutes: Math.round(gapTimeMinutes * 10) / 10,
                    expectedRange: activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_SIZE + activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_OVERLAP,
                    maxExpectedGapBlocks: MAX_EXPECTED_GAP_BLOCKS,
                    blockTimeSeconds: BLOCK_TIME_MS / 1000,
                    note: 'This may indicate server downtime or WebSocket disconnection. Processing all blocks to ensure no deposits are missed. The batch processing loop will handle this efficiently.'
                });
            }
            else if (actualBlockRange > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_SIZE * 3) {
                // Log moderate gaps at debug level
                logger_1.logger.debug(`Moderate block gap detected for chain ${chainId}`, {
                    chainId,
                    lastBlock,
                    currentBlock,
                    fromBlock,
                    toBlock,
                    blockGap: actualBlockRange,
                    gapTimeMinutes: Math.round(gapTimeMinutes * 10) / 10,
                    note: 'Will process all blocks in gap'
                });
            }
            // Add diagnostic logging
            logger_1.logger.debug(`Starting deposit check for chain ${chainId}`, {
                chainId,
                providedBlockNumber,
                lastBlock,
                currentBlock,
                fromBlock,
                toBlock,
                blocksToCheck: actualBlockRange,
                walletCount: wallets.size
            });
            if (fromBlock > toBlock) {
                logger_1.logger.debug(`No new blocks to check on chain ${chainId}`, {
                    chainId,
                    lastBlock,
                    currentBlock,
                    fromBlock,
                    toBlock,
                    reason: 'fromBlock > toBlock'
                });
                return;
            }
            const walletSet = new Set(Array.from(wallets).map(w => w.toLowerCase()));
            // CRITICAL: Add diagnostic logging for walletSet
            logger_1.logger.debug(`Processing deposits for chain ${chainId}`, {
                chainId,
                walletCount: walletSet.size,
                walletAddresses: Array.from(walletSet).slice(0, 5), // First 5 for debugging
                fromBlock,
                toBlock,
                blocksToCheck: toBlock - fromBlock + 1
            });
            const depositsToSave = [];
            // Dynamic throttling based on error rate
            let maxBlocksToCheck = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.NORMAL_BLOCK_RANGE;
            let BATCH_PAUSE = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.NORMAL_BATCH_PAUSE;
            let CONCURRENT_BLOCKS = 2;
            if (recentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.AGGRESSIVE_THROTTLE_ERROR_COUNT) {
                maxBlocksToCheck = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.AGGRESSIVE_BLOCK_RANGE;
                BATCH_PAUSE = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.AGGRESSIVE_BATCH_PAUSE;
                CONCURRENT_BLOCKS = 1;
            }
            else if (recentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MODERATE_THROTTLE_ERROR_COUNT) {
                maxBlocksToCheck = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MODERATE_BLOCK_RANGE;
                BATCH_PAUSE = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MODERATE_BATCH_PAUSE;
                CONCURRENT_BLOCKS = 2;
            }
            // Process all blocks from fromBlock to toBlock
            // The batch processing loop below will handle rate limiting by processing in smaller batches
            const blockNumbers = Array.from({ length: toBlock - fromBlock + 1 }, (_, i) => fromBlock + i);
            logger_1.logger.debug(`Processing blocks for chain ${chainId}`, {
                chainId,
                fromBlock,
                toBlock,
                totalBlocks: blockNumbers.length,
                maxBlocksToCheck,
                concurrentBlocks: CONCURRENT_BLOCKS,
                batchPause: BATCH_PAUSE,
                throttling: recentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MODERATE_THROTTLE_ERROR_COUNT ? 'active' : 'normal'
            });
            // Track highest successfully processed block across all batches
            // This prevents skipping blocks that weren't actually processed
            let highestProcessedBlock = fromBlock - 1;
            // Process blocks in parallel batches
            for (let i = 0; i < blockNumbers.length; i += CONCURRENT_BLOCKS) {
                const batch = blockNumbers.slice(i, i + CONCURRENT_BLOCKS);
                try {
                    const blockPromises = batch.map(async (blockNum) => {
                        // OPTIMIZATION: Check if block is before lastCheckedBlock (already processed)
                        const lastBlock = lastCheckedBlock.get(chainId);
                        if (lastBlock && blockNum <= lastBlock) {
                            // Add logging for skipped blocks to help diagnose missing deposits
                            logger_1.logger.debug(`⏭️ Block ${blockNum} skipped - marked as already processed`, {
                                chainId,
                                blockNum,
                                lastCheckedBlock: lastBlock,
                                note: 'If this block was not actually processed, deposits will be missed'
                            });
                            return { blockNum, block: null, error: null, skipped: true, reason: 'already_processed' };
                        }
                        // OPTIMIZATION 3: Check if block is currently being processed by another check
                        if (!blocksBeingProcessed.has(chainId)) {
                            blocksBeingProcessed.set(chainId, new Set());
                        }
                        const processingSet = blocksBeingProcessed.get(chainId);
                        if (processingSet.has(blockNum)) {
                            return { blockNum, block: null, error: null, skipped: true, reason: 'being_processed' };
                        }
                        // Mark block as being processed
                        processingSet.add(blockNum);
                        await waitForRequestSlot();
                        try {
                            // CRITICAL OPTIMIZATION: Use direct RPC call to ensure Ankr returns full transactions
                            // This uses eth_getBlockByNumber(blockNum, true) which should return full transaction objects
                            let block = null;
                            try {
                                // Use direct RPC call first to ensure full transactions
                                block = await getBlockWithFullTransactions(provider, blockNum, chainId);
                            }
                            catch (error) {
                                // If direct RPC fails, fallback to normal getBlock
                                logger_1.logger.debug(`getBlockWithFullTransactions failed for block ${blockNum}, trying fallback`, {
                                    chainId,
                                    blockNum,
                                    error: error.message
                                });
                                try {
                                    block = await provider.getBlock(blockNum, true);
                                }
                                catch (fallbackError) {
                                    // If that also fails, try without transactions
                                    const blockHeader = await provider.getBlock(blockNum, false);
                                    if (blockHeader && blockHeader.transactions.length > 0) {
                                        // Only fetch full block if there are transactions
                                        block = await provider.getBlock(blockNum, true);
                                    }
                                    else {
                                        block = blockHeader;
                                    }
                                }
                            }
                            // OPTIMIZATION 3: Skip blocks with no transactions early (saves processing)
                            if (!block || !block.transactions || block.transactions.length === 0) {
                                processingSet.delete(blockNum); // Release lock
                                return { blockNum, block: null, error: null, skipped: false };
                            }
                            // OPTIMIZATION 4: Only fetch transactions if we have monitored wallets
                            // If no wallets to monitor, skip transaction fetching entirely
                            if (walletSet.size === 0) {
                                processingSet.delete(blockNum); // Release lock
                                return { blockNum, block: null, error: null, skipped: false };
                            }
                            // CRITICAL OPTIMIZATION: If transactions are strings (hashes), we need to fetch them
                            // BUT: Only fetch if the provider didn't return full transaction objects
                            // This is the main source of redundant RPC calls
                            if (typeof block.transactions[0] === 'string') {
                                const transactionHashes = block.transactions;
                                // CRITICAL: For pay-as-you-go RPC, we MUST fetch transactions individually
                                // because native ETH transfers don't emit events and we need to check tx.value
                                // However, we can optimize by batching requests and using the request queue
                                logger_1.logger.debug(`Block ${blockNum} contains transaction hashes, fetching full transaction objects`, {
                                    chainId,
                                    blockNum,
                                    transactionCount: transactionHashes.length,
                                    monitoredWallets: walletSet.size
                                });
                                // Fetch all transactions in parallel (with rate limiting via request queue)
                                // This is necessary for native ETH transfers - no way around it
                                const transactionPromises = transactionHashes.map(async (txHash) => {
                                    await waitForRequestSlot();
                                    try {
                                        const tx = await provider.getTransaction(txHash);
                                        return tx;
                                    }
                                    catch (error) {
                                        logger_1.logger.error(`Failed to fetch transaction ${txHash} for block ${blockNum} on chain ${chainId}`, {
                                            chainId,
                                            blockNum,
                                            txHash,
                                            error: error.message || String(error)
                                        });
                                        return null;
                                    }
                                    finally {
                                        releaseRequestSlot();
                                    }
                                });
                                const transactions = await Promise.all(transactionPromises);
                                const validTransactions = transactions.filter(tx => tx !== null);
                                // Replace transaction hashes with full transaction objects
                                block.transactions = validTransactions;
                                logger_1.logger.debug(`Fetched ${validTransactions.length}/${transactionHashes.length} full transaction objects for block ${blockNum}`, {
                                    chainId,
                                    blockNum,
                                    fetched: validTransactions.length,
                                    total: transactionHashes.length
                                });
                            }
                            processingSet.delete(blockNum); // Release lock after successful fetch
                            return { blockNum, block, error: null, skipped: false };
                        }
                        catch (error) {
                            processingSet.delete(blockNum); // Release lock on error
                            return { blockNum, block: null, error, skipped: false };
                        }
                        finally {
                            releaseRequestSlot();
                        }
                    });
                    const blockResults = await Promise.all(blockPromises);
                    for (const { blockNum, block, error, skipped } of blockResults) {
                        if (skipped) {
                            // Log skipped blocks to help diagnose missing deposits
                            const skipReason = blockResults.find(r => r.blockNum === blockNum)?.reason || 'unknown';
                            logger_1.logger.warn(`⏭️ Block ${blockNum} skipped on chain ${chainId}`, {
                                chainId,
                                blockNum,
                                reason: skipReason,
                                fromBlock,
                                toBlock,
                                lastCheckedBlock: lastCheckedBlock.get(chainId),
                                note: 'This block will NOT be processed. Deposits in this block may be missed if incorrectly marked as processed.'
                            });
                            continue;
                        }
                        if (error) {
                            const isRateLimitError = error?.code === -32005 ||
                                error?.code === 429 ||
                                error?.code === 'BAD_DATA' ||
                                error?.code === 'TIMEOUT' ||
                                error?.code === 'UNKNOWN_ERROR' ||
                                error?.error?.code === 429 ||
                                error?.message?.includes('Too Many Requests') ||
                                error?.message?.includes('exceeded its compute units') ||
                                error?.message?.includes('timeout') ||
                                error?.shortMessage?.includes('missing response') ||
                                (Array.isArray(error?.value) && error.value.some((v) => v.code === -32005 || v.code === 429));
                            if (isRateLimitError) {
                                const currentConsecutiveErrors = rateLimitCount.get(chainId) || 0;
                                if (currentConsecutiveErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.EXCESSIVE_ERROR_THRESHOLD) {
                                    continue;
                                }
                                if (!rateLimitFrequency.has(chainId)) {
                                    rateLimitFrequency.set(chainId, []);
                                }
                                const errors = rateLimitFrequency.get(chainId);
                                errors.push(Date.now());
                                if (errors.length > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.RATE_LIMIT_FREQUENCY_MAX_SIZE) {
                                    errors.shift();
                                }
                                const currentRecentErrors = errors.filter(time => Date.now() - time < 60000).length;
                                if (currentConsecutiveErrors + 1 > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CIRCUIT_BREAKER_THRESHOLD ||
                                    currentRecentErrors > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MAX_ERRORS_PER_MINUTE) {
                                    const cooldownUntil = Date.now() + activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CIRCUIT_BREAKER_COOLDOWN;
                                    circuitBreaker.set(chainId, { enabled: true, until: cooldownUntil });
                                    return;
                                }
                                rateLimitCount.set(chainId, currentConsecutiveErrors + 1);
                                const backoffDelay = Math.min(15000 * Math.pow(2, Math.min(currentConsecutiveErrors, 3)), 120000);
                                await delay(backoffDelay);
                                // CRITICAL OPTIMIZATION: Check multiple conditions before retrying to avoid redundant RPC calls
                                const lastBlock = lastCheckedBlock.get(chainId);
                                const isAlreadyProcessed = lastBlock && blockNum <= lastBlock;
                                const isBeingProcessedNow = blocksBeingProcessed.get(chainId)?.has(blockNum);
                                if (isAlreadyProcessed || isBeingProcessedNow) {
                                    logger_1.logger.debug(`Skipping retry for block ${blockNum} - already processed or being processed`, {
                                        chainId,
                                        blockNum,
                                        lastBlock,
                                        isAlreadyProcessed,
                                        isBeingProcessedNow
                                    });
                                    continue;
                                }
                                // Mark as being processed before retry
                                if (!blocksBeingProcessed.has(chainId)) {
                                    blocksBeingProcessed.set(chainId, new Set());
                                }
                                blocksBeingProcessed.get(chainId).add(blockNum);
                                await waitForRequestSlot();
                                try {
                                    // Try to get block with full transactions using direct RPC call
                                    let retryBlock = null;
                                    try {
                                        retryBlock = await getBlockWithFullTransactions(provider, blockNum, chainId);
                                    }
                                    catch (error) {
                                        // Fallback to normal getBlock
                                        logger_1.logger.debug(`getBlockWithFullTransactions failed in retry for block ${blockNum}`, {
                                            chainId,
                                            blockNum,
                                            error: error.message
                                        });
                                        try {
                                            retryBlock = await provider.getBlock(blockNum, true);
                                        }
                                        catch (fallbackError) {
                                            // Final fallback: get block without transactions
                                            const blockHeader = await provider.getBlock(blockNum, false);
                                            if (blockHeader && blockHeader.transactions.length > 0) {
                                                retryBlock = await provider.getBlock(blockNum, true);
                                            }
                                            else {
                                                retryBlock = blockHeader;
                                            }
                                        }
                                    }
                                    // CRITICAL FIX: If transactions are strings (hashes), fetch full transaction objects
                                    if (retryBlock && retryBlock.transactions && retryBlock.transactions.length > 0 && typeof retryBlock.transactions[0] === 'string') {
                                        const transactionHashes = retryBlock.transactions;
                                        const transactionPromises = transactionHashes.map(async (txHash) => {
                                            await waitForRequestSlot();
                                            try {
                                                const tx = await provider.getTransaction(txHash);
                                                return tx;
                                            }
                                            catch (error) {
                                                logger_1.logger.error(`Failed to fetch transaction ${txHash} for retry block ${blockNum} on chain ${chainId}`, {
                                                    chainId,
                                                    blockNum,
                                                    txHash,
                                                    error: error.message || String(error)
                                                });
                                                return null;
                                            }
                                            finally {
                                                releaseRequestSlot();
                                            }
                                        });
                                        const transactions = await Promise.all(transactionPromises);
                                        const validTransactions = transactions.filter(tx => tx !== null);
                                        retryBlock.transactions = validTransactions;
                                    }
                                    if (retryBlock?.transactions) {
                                        processBlockTransactions(retryBlock, blockNum, walletSet, depositsToSave, chainId);
                                        // Track successfully processed block from retry
                                        if (blockNum > highestProcessedBlock) {
                                            highestProcessedBlock = blockNum;
                                        }
                                    }
                                    // Release lock after successful retry
                                    blocksBeingProcessed.get(chainId)?.delete(blockNum);
                                }
                                catch (retryError) {
                                    logger_1.logger.error(`Failed to retry block ${blockNum} on chain ${chainId}`, retryError);
                                    // Release lock on error
                                    blocksBeingProcessed.get(chainId)?.delete(blockNum);
                                }
                                finally {
                                    releaseRequestSlot();
                                }
                            }
                            continue;
                        }
                        // Only process if block exists and has transactions
                        if (block && block.transactions && block.transactions.length > 0) {
                            // CRITICAL: Log transaction count before processing
                            if (walletSet.size > 0) {
                                logger_1.logger.debug(`Processing block ${blockNum} on chain ${chainId}`, {
                                    chainId,
                                    blockNum,
                                    transactionCount: block.transactions.length,
                                    walletSetSize: walletSet.size
                                });
                            }
                            processBlockTransactions(block, blockNum, walletSet, depositsToSave, chainId);
                            // Track successfully processed block
                            if (blockNum > highestProcessedBlock) {
                                highestProcessedBlock = blockNum;
                            }
                        }
                    }
                    if (i + CONCURRENT_BLOCKS < blockNumbers.length) {
                        await delay(BATCH_PAUSE);
                    }
                }
                catch (batchError) {
                    logger_1.logger.error(`Error processing batch on chain ${chainId}`, batchError);
                    continue;
                }
            }
            // Log summary of block processing - CHANGED TO INFO LEVEL for visibility
            logger_1.logger.info(`✅ Completed processing blocks for chain ${chainId}`, {
                chainId,
                blocksProcessed: blockNumbers.length,
                depositsFound: depositsToSave.length,
                depositsToSaveArray: depositsToSave.map(d => ({
                    txHash: d.txHash,
                    walletAddress: d.walletAddress,
                    fromAddress: d.fromAddress
                })),
                fromBlock,
                toBlock
            });
            // Explicit check log before save
            logger_1.logger.info(`🔍 Checking depositsToSave before save on chain ${chainId}`, {
                chainId,
                depositsToSaveLength: depositsToSave.length,
                depositsToSaveIsArray: Array.isArray(depositsToSave),
                willProceedToSave: depositsToSave.length > 0,
                depositsContent: depositsToSave.length > 0 ? depositsToSave.map(d => ({
                    txHash: d.txHash,
                    walletAddress: d.walletAddress
                })) : 'EMPTY ARRAY'
            });
            if (depositsToSave.length > 0) {
                logger_1.logger.info(`Preparing to save ${depositsToSave.length} deposits on chain ${chainId}`, {
                    chainId,
                    depositCount: depositsToSave.length,
                    deposits: depositsToSave.map(d => ({
                        txHash: d.txHash,
                        walletAddress: d.walletAddress,
                        fromAddress: d.fromAddress,
                        amount: d.amount,
                        blockNumber: d.blockNumber,
                        userId: d.userId
                    }))
                });
                try {
                    const activitiesToSave = depositsToSave.map(deposit => ({
                        type: 'deposit',
                        walletAddress: deposit.walletAddress,
                        fromAddress: deposit.fromAddress,
                        toAddress: deposit.walletAddress,
                        amount: deposit.amount,
                        txHash: deposit.txHash,
                        blockNumber: deposit.blockNumber,
                        blockTimestamp: deposit.blockTimestamp,
                        chainId: chainId,
                        status: 'confirmed',
                        userId: deposit.userId
                    }));
                    logger_1.logger.info(`Calling saveActivitiesBatch with ${activitiesToSave.length} activities on chain ${chainId}`, {
                        chainId,
                        activityCount: activitiesToSave.length,
                        firstActivity: activitiesToSave[0] ? {
                            txHash: activitiesToSave[0].txHash,
                            walletAddress: activitiesToSave[0].walletAddress,
                            fromAddress: activitiesToSave[0].fromAddress,
                            amount: activitiesToSave[0].amount,
                            userId: activitiesToSave[0].userId
                        } : null
                    });
                    const savedActivities = await (0, activityService_1.saveActivitiesBatch)(activitiesToSave);
                    logger_1.logger.info(`saveActivitiesBatch returned ${savedActivities.length} saved activities (requested ${activitiesToSave.length}) on chain ${chainId}`, {
                        chainId,
                        savedCount: savedActivities.length,
                        requestedCount: activitiesToSave.length
                    });
                    if (savedActivities.length > 0) {
                        logger_1.logger.info(`✅ Saved ${savedActivities.length} new deposits on chain ${chainId}`, {
                            chainId,
                            saved: savedActivities.length,
                            total: depositsToSave.length,
                            deposits: savedActivities.map(a => ({
                                txHash: a.txHash,
                                walletAddress: a.walletAddress,
                                fromAddress: a.fromAddress,
                                amount: ethers_1.ethers.formatEther(a.amount),
                                amountWei: a.amount,
                                blockNumber: a.blockNumber,
                                userId: a.userId?.toString() || null
                            }))
                        });
                        // Emit WebSocket events for real-time balance updates
                        try {
                            const { emitDepositDetected, emitBalanceUpdate } = await Promise.resolve().then(() => __importStar(require('../socket/updateEmitter')));
                            // Track unique wallets for balance updates (avoid duplicate balance fetches)
                            const walletsToUpdate = new Map();
                            // Emit deposit detected events and collect unique wallets
                            savedActivities.forEach(activity => {
                                emitDepositDetected({
                                    walletAddress: activity.walletAddress,
                                    fromAddress: activity.fromAddress,
                                    amount: activity.amount,
                                    amountFormatted: ethers_1.ethers.formatEther(activity.amount),
                                    txHash: activity.txHash,
                                    blockNumber: activity.blockNumber,
                                    blockTimestamp: activity.blockTimestamp,
                                    chainId: activity.chainId,
                                    userId: activity.userId?.toString()
                                });
                                // Track unique wallets for balance updates
                                if (activity.userId) {
                                    const walletKey = `${activity.chainId}:${activity.walletAddress.toLowerCase()}`;
                                    if (!walletsToUpdate.has(walletKey)) {
                                        walletsToUpdate.set(walletKey, {
                                            userId: activity.userId.toString(),
                                            chainId: activity.chainId
                                        });
                                    }
                                }
                            });
                            // Fetch fresh balances and emit balance updates for unique wallets
                            if (walletsToUpdate.size > 0) {
                                const provider = (0, blockchain_1.getProvider)(chainId);
                                // Process balance updates in parallel (but limit concurrency)
                                const balanceUpdatePromises = Array.from(walletsToUpdate.entries()).map(async ([walletKey, walletInfo]) => {
                                    const [, walletAddress] = walletKey.split(':');
                                    try {
                                        const freshBalance = await provider.getBalance(walletAddress);
                                        const balanceFormatted = ethers_1.ethers.formatEther(freshBalance);
                                        emitBalanceUpdate({
                                            walletAddress: walletAddress,
                                            balance: freshBalance.toString(),
                                            balanceFormatted: balanceFormatted,
                                            chainId: walletInfo.chainId,
                                            userId: walletInfo.userId,
                                        });
                                        logger_1.logger.debug(`✅ Balance update sent for wallet ${walletAddress}`, {
                                            userId: walletInfo.userId,
                                            balance: balanceFormatted,
                                            chainId: walletInfo.chainId
                                        });
                                    }
                                    catch (balanceError) {
                                        logger_1.logger.warn(`Failed to fetch/emit balance update for wallet ${walletAddress}`, {
                                            error: balanceError.message,
                                            chainId: walletInfo.chainId
                                        });
                                    }
                                });
                                // Wait for all balance updates (don't block if some fail)
                                await Promise.allSettled(balanceUpdatePromises);
                                logger_1.logger.info(`✅ Emitted balance updates for ${walletsToUpdate.size} unique wallets on chain ${chainId}`);
                            }
                        }
                        catch (error) {
                            // Don't fail deposit saving if event emission fails
                            logger_1.logger.warn(`Failed to emit deposit events on chain ${chainId}`, error);
                        }
                    }
                    else if (depositsToSave.length > 0) {
                        // All deposits were duplicates - change to info level so it's visible
                        logger_1.logger.info(`⚠️ All ${depositsToSave.length} deposits were duplicates on chain ${chainId}`, {
                            chainId,
                            count: depositsToSave.length,
                            deposits: depositsToSave.map(d => ({
                                txHash: d.txHash,
                                walletAddress: d.walletAddress,
                                fromAddress: d.fromAddress
                            }))
                        });
                    }
                }
                catch (error) {
                    logger_1.logger.error(`❌ Error batch saving deposits on chain ${chainId}`, {
                        chainId,
                        error: error.message,
                        errorCode: error.code,
                        errorName: error.name,
                        stack: error.stack,
                        count: depositsToSave.length,
                        deposits: depositsToSave.map(d => ({
                            txHash: d.txHash,
                            walletAddress: d.walletAddress,
                            fromAddress: d.fromAddress
                        }))
                    });
                }
            }
            else {
                logger_1.logger.debug(`No deposits to save for chain ${chainId}`, { chainId });
            }
            // CRITICAL FIX: Only update lastCheckedBlock to highest successfully processed block
            // NOT to toBlock - this prevents skipping blocks that weren't actually processed
            // This fixes the issue where deposits in earlier blocks are missed when toBlock is larger
            if (highestProcessedBlock >= fromBlock) {
                lastCheckedBlock.set(chainId, highestProcessedBlock);
                logger_1.logger.info(`Updated lastCheckedBlock for chain ${chainId}`, {
                    chainId,
                    fromBlock,
                    toBlock,
                    highestProcessedBlock,
                    blocksProcessed: highestProcessedBlock - fromBlock + 1,
                    blocksRequested: toBlock - fromBlock + 1,
                    note: 'Only updated to highest processed block, not toBlock. This ensures unprocessed blocks are not skipped.'
                });
            }
            else {
                logger_1.logger.warn(`No blocks were successfully processed for chain ${chainId}`, {
                    chainId,
                    fromBlock,
                    toBlock,
                    note: 'lastCheckedBlock was NOT updated to prevent missing deposits'
                });
            }
            // Clean up processing locks for all blocks in this range
            const processingSet = blocksBeingProcessed.get(chainId);
            if (processingSet) {
                for (let blockNum = fromBlock; blockNum <= toBlock; blockNum++) {
                    processingSet.delete(blockNum);
                }
            }
            const finalConsecutiveErrors = rateLimitCount.get(chainId) || 0;
            if (finalConsecutiveErrors > 0) {
                rateLimitCount.set(chainId, Math.max(0, finalConsecutiveErrors - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.ERROR_COUNT_REDUCTION_ON_SUCCESS));
            }
            // Log when check completes successfully
            logger_1.logger.info(`✅ checkForDeposits completed successfully for chain ${chainId}`, {
                chainId,
                providedBlockNumber,
                timestamp: new Date().toISOString()
            });
        }
        catch (error) {
            logger_1.logger.error(`❌ Error checking for deposits on chain ${chainId}`, {
                chainId,
                providedBlockNumber,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
        }
        finally {
            activeChecks.delete(chainId);
            // Clean up any remaining processing locks on error
            // Note: We can't access fromBlock/toBlock here as they're in try scope
            // The locks will be cleaned up naturally as blocks are processed
            // or on the next check cycle
        }
    })();
    activeChecks.set(chainId, checkPromise);
    await checkPromise;
}
/**
 * Set up WebSocket subscription for real-time deposit detection
 * Similar to how Binance tracks deposits - uses WebSocket for instant detection
 */
async function setupWebSocketMonitoring(chainId) {
    try {
        // CRITICAL: Check if URL is configured first
        const wsUrl = (0, blockchain_1.getWsUrl)(chainId);
        // Add diagnostic logging for chain 1
        if (chainId === 1) {
            console.log(`🔍 DEBUG setupWebSocketMonitoring for chain ${chainId}:`, {
                chainId,
                wsUrl: wsUrl || 'NOT SET',
                wsUrlLength: wsUrl?.length,
                envVar: 'ETHEREUM_WS_URL',
                envValue: process.env.ETHEREUM_WS_URL || 'NOT SET',
                envValueLength: process.env.ETHEREUM_WS_URL?.length
            });
        }
        const wsProvider = (0, blockchain_1.getWsProvider)(chainId);
        // Add diagnostic logging for why provider is null
        if (!wsProvider) {
            // Check all possible reasons
            const attemptInfo = blockchain_1.wsConnectionAttempts.get(chainId);
            const cached = blockchain_1.wsProviderCache.get(chainId);
            const now = Date.now();
            if (chainId === 1) {
                console.log(`🔍 DEBUG: getWsProvider returned null for chain ${chainId}`, {
                    chainId,
                    wsUrl: wsUrl || 'NOT SET',
                    hasAttemptInfo: !!attemptInfo,
                    backoffUntil: attemptInfo?.backoffUntil || 0,
                    isInBackoff: attemptInfo && now < attemptInfo.backoffUntil,
                    lastAttempt: attemptInfo?.lastAttempt || 0,
                    timeSinceLastAttempt: attemptInfo ? Math.ceil((now - attemptInfo.lastAttempt) / 1000) : 0,
                    rateLimit: 60000 / 1000,
                    isRateLimited: attemptInfo && (now - attemptInfo.lastAttempt < 60000),
                    hasCached: !!cached,
                    reason: !wsUrl ? 'URL_NOT_SET' :
                        (attemptInfo && now < attemptInfo.backoffUntil) ? 'IN_BACKOFF' :
                            (attemptInfo && (now - attemptInfo.lastAttempt < 60000)) ? 'RATE_LIMITED' :
                                'PROVIDER_CREATION_FAILED'
                });
            }
            // Only warn if URL was actually configured (indicates provider creation failed)
            if (wsUrl) {
                logger_1.logger.warn(`WebSocket provider creation failed for chain ${chainId} - using polling only`, {
                    chainId,
                    note: 'WebSocket URL is configured but provider creation failed. Check logs above for details (backoff, rate limit, or error).'
                });
            }
            else {
                // URL not configured - this is expected, use debug level
                logger_1.logger.debug(`No WebSocket URL configured for chain ${chainId} - using polling only`);
            }
            return;
        }
        const wallets = monitoredWallets.get(chainId);
        if (!wallets || wallets.size === 0) {
            logger_1.logger.debug(`No wallets to monitor on chain ${chainId} - skipping WebSocket setup`);
            return;
        }
        // Check if WebSocket is already set up
        if (wsProviders.has(chainId)) {
            logger_1.logger.debug(`WebSocket monitoring already set up for chain ${chainId}`);
            return;
        }
        // Store provider for cleanup
        wsProviders.set(chainId, wsProvider);
        logger_1.logger.info(`Setting up WebSocket monitoring for chain ${chainId}`, {
            chainId,
            walletCount: wallets.size
        });
        // Block handler: process blocks immediately with debouncing
        // This provides real-time detection (2-3 seconds) while batching rapid blocks to reduce RPC credit usage
        // The debounce batches blocks that arrive within 2 seconds, then processes them together
        const blockHandler = async (blockNumber) => {
            try {
                const now = Date.now();
                lastKnownBlockNumber.set(chainId, blockNumber);
                lastKnownBlockTimestamp.set(chainId, now); // Track timestamp for staleness checks
                // Increment counter for new blocks since last check (for monitoring/debugging)
                const currentCount = (blocksSinceLastCheck.get(chainId) || 0) + 1;
                blocksSinceLastCheck.set(chainId, currentCount);
                // Clear existing timeout if present (debouncing)
                const existingTimeout = wsBlockProcessingTimeouts.get(chainId);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                }
                // Process blocks after debounce delay (batches rapid blocks)
                // This provides near-real-time detection (2-3 seconds) while reducing RPC calls
                const DEBOUNCE_MS = 2000; // 2 seconds - batch blocks that arrive within 2 seconds
                const timeout = setTimeout(async () => {
                    try {
                        const lastBlock = lastCheckedBlock.get(chainId);
                        const currentBlock = lastKnownBlockNumber.get(chainId);
                        // Only process if we have new blocks to check
                        if (currentBlock !== undefined && (lastBlock === undefined || currentBlock > lastBlock)) {
                            logger_1.logger.debug(`Immediate deposit check triggered for chain ${chainId} (debounced)`, {
                                chainId,
                                lastBlock,
                                currentBlock,
                                blocksToProcess: lastBlock !== undefined ? currentBlock - lastBlock : 'initial',
                                accumulatedBlocks: blocksSinceLastCheck.get(chainId) || 0
                            });
                            // Process all blocks from lastCheckedBlock + 1 to currentBlock
                            // This ensures no blocks are missed and no overlaps occur
                            await checkForDeposits(chainId, currentBlock);
                        }
                    }
                    catch (error) {
                        logger_1.logger.error(`Error in immediate deposit check for chain ${chainId}`, error);
                    }
                    finally {
                        // Clear timeout reference after processing
                        wsBlockProcessingTimeouts.delete(chainId);
                    }
                }, DEBOUNCE_MS);
                // Store timeout for cleanup
                wsBlockProcessingTimeouts.set(chainId, timeout);
            }
            catch (error) {
                logger_1.logger.error(`Error handling new block ${blockNumber}`, error);
            }
        };
        // Set up event listeners (block subscription only - pending transactions not supported by all providers)
        wsProvider.on('block', blockHandler);
        // Time-based processing: check every 10 seconds as a fallback safety net
        // This ensures deposits are detected even if WebSocket block handler fails or is delayed
        // The immediate block handler (above) provides real-time detection, this is a backup
        const timeBasedInterval = setInterval(() => {
            try {
                const lastBlock = lastCheckedBlock.get(chainId);
                const currentBlock = lastKnownBlockNumber.get(chainId);
                // Only process if we have new blocks to check
                if (currentBlock !== undefined && (lastBlock === undefined || currentBlock > lastBlock)) {
                    logger_1.logger.debug(`Time-based deposit check triggered for chain ${chainId}`, {
                        chainId,
                        lastBlock,
                        currentBlock,
                        blocksToProcess: lastBlock !== undefined ? currentBlock - lastBlock : 'initial',
                        accumulatedBlocks: blocksSinceLastCheck.get(chainId) || 0
                    });
                    // Process all blocks from lastCheckedBlock + 1 to currentBlock
                    // This ensures no blocks are missed and no overlaps occur
                    checkForDeposits(chainId, currentBlock).catch(error => {
                        logger_1.logger.error(`Error in time-based deposit check for chain ${chainId}`, error);
                    });
                }
                else {
                    logger_1.logger.debug(`Skipping time-based check for chain ${chainId} - no new blocks`, {
                        chainId,
                        lastBlock,
                        currentBlock
                    });
                }
            }
            catch (error) {
                logger_1.logger.error(`Error in time-based interval for chain ${chainId}`, error);
            }
        }, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.CHECK_INTERVAL_SECONDS * 1000);
        // Store interval for cleanup
        wsTimeBasedIntervals.set(chainId, timeBasedInterval);
        // Listen for WebSocket connection errors (supported by ethers)
        wsProvider.on('error', (error) => {
            const errorMessage = error?.message || String(error);
            // If it's a 429 error, don't reconnect immediately - let backoff handle it
            if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
                logger_1.logger.warn(`WebSocket 429 error for chain ${chainId} - will retry after backoff period (handled by getWsProvider)`);
                wsProviders.delete(chainId);
                const healthCheck = wsHealthChecks.get(chainId);
                if (healthCheck) {
                    clearInterval(healthCheck);
                    wsHealthChecks.delete(chainId);
                }
                const timeBasedInterval = wsTimeBasedIntervals.get(chainId);
                if (timeBasedInterval) {
                    clearInterval(timeBasedInterval);
                    wsTimeBasedIntervals.delete(chainId);
                }
                // Don't reconnect immediately - getWsProvider will handle backoff
                return;
            }
            // For other errors, attempt reconnection after delay
            logger_1.logger.error(`WebSocket error on chain ${chainId}`, error);
            wsProviders.delete(chainId);
            const healthCheck = wsHealthChecks.get(chainId);
            if (healthCheck) {
                clearInterval(healthCheck);
                wsHealthChecks.delete(chainId);
            }
            const timeBasedInterval = wsTimeBasedIntervals.get(chainId);
            if (timeBasedInterval) {
                clearInterval(timeBasedInterval);
                wsTimeBasedIntervals.delete(chainId);
            }
            setTimeout(() => {
                setupWebSocketMonitoring(chainId).catch(error => {
                    logger_1.logger.error(`Failed to reconnect WebSocket for chain ${chainId}`, error);
                });
            }, 5000);
        });
        // Access underlying WebSocket to listen for 'close' event
        // ethers.WebSocketProvider doesn't expose 'close' event directly
        const underlyingWs = wsProvider.websocket || wsProvider._websocket;
        if (underlyingWs && typeof underlyingWs.on === 'function') {
            underlyingWs.on('close', (code) => {
                logger_1.logger.warn(`WebSocket closed for chain ${chainId} (code: ${code}) - will attempt to reconnect`);
                wsProviders.delete(chainId);
                const healthCheck = wsHealthChecks.get(chainId);
                if (healthCheck) {
                    clearInterval(healthCheck);
                    wsHealthChecks.delete(chainId);
                }
                const timeBasedInterval = wsTimeBasedIntervals.get(chainId);
                if (timeBasedInterval) {
                    clearInterval(timeBasedInterval);
                    wsTimeBasedIntervals.delete(chainId);
                }
                // Attempt to reconnect after a delay (only if not a normal closure)
                if (code !== 1000) { // 1000 = normal closure
                    // Check if we're in backoff due to 429 errors
                    const attemptInfo = blockchain_1.wsConnectionAttempts.get(chainId);
                    const now = Date.now();
                    const isInBackoff = attemptInfo && now < attemptInfo.backoffUntil;
                    let reconnectDelay = 5000; // Default 5 second delay
                    if (isInBackoff) {
                        // Wait until backoff expires, plus a small buffer
                        const backoffRemaining = attemptInfo.backoffUntil - now;
                        reconnectDelay = backoffRemaining + 2000; // Wait for backoff + 2s buffer
                        logger_1.logger.debug(`WebSocket reconnection for chain ${chainId} delayed due to active backoff. Will retry in ${Math.ceil(reconnectDelay / 1000)}s`, {
                            chainId,
                            backoffRemaining: Math.ceil(backoffRemaining / 1000),
                            reconnectDelay: Math.ceil(reconnectDelay / 1000)
                        });
                    }
                    setTimeout(() => {
                        setupWebSocketMonitoring(chainId).catch(error => {
                            // If it's a backoff error (getWsProvider returns null), that's expected
                            const errorMessage = error?.message || String(error);
                            if (!errorMessage.includes('backoff') && !errorMessage.includes('rate limit')) {
                                logger_1.logger.error(`Failed to reconnect WebSocket for chain ${chainId}`, error);
                            }
                        });
                    }, reconnectDelay);
                }
            });
            underlyingWs.on('error', (error) => {
                const errorMessage = error?.message || String(error);
                // If it's a 429 error, don't reconnect immediately - let backoff handle it
                if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
                    logger_1.logger.warn(`WebSocket 429 error for chain ${chainId} - will retry after backoff period (handled by getWsProvider)`);
                    wsProviders.delete(chainId);
                    const healthCheck = wsHealthChecks.get(chainId);
                    if (healthCheck) {
                        clearInterval(healthCheck);
                        wsHealthChecks.delete(chainId);
                    }
                    const timeBasedInterval = wsTimeBasedIntervals.get(chainId);
                    if (timeBasedInterval) {
                        clearInterval(timeBasedInterval);
                        wsTimeBasedIntervals.delete(chainId);
                    }
                    // Don't reconnect immediately - getWsProvider will handle backoff
                    // The next call to setupWebSocketMonitoring will respect the backoff
                    return;
                }
                // For other errors, log and let normal reconnection logic handle it
                logger_1.logger.error(`Underlying WebSocket error on chain ${chainId}`, error);
            });
        }
        // Store subscriptions for cleanup
        wsSubscriptions.set(chainId, {
            pending: null, // Pending subscription removed - not supported by all providers
            block: blockHandler
        });
        logger_1.logger.info(`WebSocket monitoring successfully set up for chain ${chainId}`, {
            chainId,
            walletCount: wallets.size
        });
        const waitForFirstBlock = new Promise((resolve) => {
            const checkConnection = setInterval(() => {
                const underlyingWs = wsProvider.websocket || wsProvider._websocket;
                if (underlyingWs && underlyingWs.readyState === 1) {
                    if (lastKnownBlockNumber.has(chainId)) {
                        clearInterval(checkConnection);
                        // CRITICAL: Sync lastCheckedBlock when WebSocket reconnects
                        // This prevents large gaps from accumulating and reduces redundant RPC calls
                        const currentBlock = lastKnownBlockNumber.get(chainId);
                        const lastBlock = lastCheckedBlock.get(chainId);
                        if (lastBlock !== undefined && currentBlock > lastBlock) {
                            const gap = currentBlock - lastBlock;
                            // Calculate expected block time for this chain (in milliseconds)
                            // Ethereum: ~12s, Base/Arbitrum: ~2s
                            const BLOCK_TIME_MS = chainId === 1 ? 12000 : 2000; // Ethereum vs Base/Arbitrum
                            // If gap exceeds 2 minutes worth of blocks, sync to prevent huge processing
                            // This allows processing recent blocks but avoids processing very old blocks
                            const MAX_EXPECTED_GAP_MS = 2 * 60 * 1000; // 2 minutes
                            const MAX_EXPECTED_GAP_BLOCKS = Math.ceil(MAX_EXPECTED_GAP_MS / BLOCK_TIME_MS);
                            if (gap > MAX_EXPECTED_GAP_BLOCKS) {
                                // Sync to current block minus a small buffer (INITIAL_BLOCK_RANGE)
                                // This ensures we process recent blocks but don't go too far back
                                const syncBlock = Math.max(currentBlock - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.INITIAL_BLOCK_RANGE, lastBlock);
                                lastCheckedBlock.set(chainId, syncBlock);
                                logger_1.logger.info(`Synced lastCheckedBlock after WebSocket reconnect`, {
                                    chainId,
                                    oldLastBlock: lastBlock,
                                    newLastBlock: syncBlock,
                                    currentBlock,
                                    gap,
                                    gapTimeMinutes: Math.round((gap * BLOCK_TIME_MS) / 60000 * 10) / 10,
                                    maxExpectedGapBlocks: MAX_EXPECTED_GAP_BLOCKS,
                                    note: `Gap exceeded ${MAX_EXPECTED_GAP_BLOCKS} blocks. Synced to process recent ${activityMonitor_1.ACTIVITY_MONITOR_CONFIG.INITIAL_BLOCK_RANGE} blocks.`
                                });
                            }
                            else if (gap > activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_SIZE * 3) {
                                // Log smaller gaps for monitoring (but don't sync)
                                logger_1.logger.debug(`WebSocket reconnected with moderate block gap`, {
                                    chainId,
                                    lastBlock,
                                    currentBlock,
                                    gap,
                                    gapTimeMinutes: Math.round((gap * BLOCK_TIME_MS) / 60000 * 10) / 10,
                                    note: 'Will process all blocks in gap'
                                });
                            }
                        }
                        resolve();
                    }
                }
            }, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_CONNECTION_CHECK_INTERVAL);
            setTimeout(() => {
                clearInterval(checkConnection);
                resolve();
            }, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_FIRST_BLOCK_TIMEOUT);
        });
        await waitForFirstBlock;
    }
    catch (error) {
        logger_1.logger.error(`Error setting up WebSocket monitoring for chain ${chainId}`, error);
    }
}
/**
 * Start monitoring all embedded wallets
 * Optimized for large-scale operations (10k+ wallets)
 */
async function startActivityMonitoring() {
    try {
        const wallets = await getAllEmbeddedWallets();
        // CRITICAL: Add detailed logging for wallet loading
        logger_1.logger.info('Loading embedded wallets for monitoring', {
            totalWallets: wallets.length,
            walletsByChain: Array.from(wallets.reduce((acc, w) => {
                acc.set(w.chainId, (acc.get(w.chainId) || 0) + 1);
                return acc;
            }, new Map())).map(([chainId, count]) => ({ chainId, count }))
        });
        if (wallets.length === 0) {
            logger_1.logger.info('No embedded wallets found to monitor');
            return;
        }
        // Group wallets by chain
        const walletsByChain = new Map();
        wallets.forEach(wallet => {
            if (!walletsByChain.has(wallet.chainId)) {
                walletsByChain.set(wallet.chainId, []);
            }
            walletsByChain.get(wallet.chainId).push({
                address: wallet.address,
                userId: wallet.userId
            });
        });
        // Start monitoring for each chain
        // Use index to stagger initial checks and prevent simultaneous RPC bursts
        let chainIndex = 0;
        walletsByChain.forEach((walletList, chainId) => {
            // Initialize monitored wallets set
            if (!monitoredWallets.has(chainId)) {
                monitoredWallets.set(chainId, new Set());
            }
            // Add all wallets for this chain and store userId mapping
            walletList.forEach(wallet => {
                const walletAddress = wallet.address.toLowerCase();
                monitoredWallets.get(chainId).add(walletAddress);
                walletToUserId.set(walletAddress, wallet.userId);
            });
            // CRITICAL: Verify wallets were added
            const addedWallets = monitoredWallets.get(chainId);
            logger_1.logger.info(`Wallets loaded for chain ${chainId}`, {
                chainId,
                expectedCount: walletList.length,
                actualCount: addedWallets?.size || 0,
                walletAddresses: Array.from(addedWallets || []).slice(0, 5) // First 5 for debugging
            });
            const interval = setInterval(() => {
                const breaker = circuitBreaker.get(chainId);
                if (breaker && breaker.enabled && breaker.until > Date.now()) {
                    return;
                }
                // OPTIMIZATION: Skip polling if WebSocket is active and has received recent blocks
                // This saves unnecessary getBlockNumber() calls for pay-as-you-go RPC
                const wsProvider = wsProviders.get(chainId);
                const wsReady = wsProvider && isWebSocketReady(chainId);
                const lastKnownBlock = lastKnownBlockNumber.get(chainId);
                const hasRecentBlock = lastKnownBlock !== undefined;
                // If WebSocket is working and we have a recent block, skip polling
                if (wsReady && hasRecentBlock) {
                    logger_1.logger.debug(`Skipping polling for chain ${chainId} - WebSocket is active`, {
                        chainId,
                        lastKnownBlock,
                        wsReady
                    });
                    return;
                }
                checkForDeposits(chainId).catch(error => {
                    logger_1.logger.error(`Error in deposit check interval for chain ${chainId}`, error);
                });
            }, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.POLLING_INTERVAL);
            monitoringIntervals.set(chainId, interval);
            // Set up WebSocket monitoring for real-time detection (like Binance)
            setupWebSocketMonitoring(chainId).catch(error => {
                console.error(`Error setting up WebSocket monitoring for chain ${chainId}:`, error);
                // Continue with polling only if WebSocket fails
            });
            const initialDelay = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.INITIAL_CHECK_DELAY + (chainIndex * activityMonitor_1.ACTIVITY_MONITOR_CONFIG.INITIAL_CHECK_STAGGER);
            setTimeout(() => {
                checkForDeposits(chainId).catch(error => {
                    logger_1.logger.error(`Error in initial deposit check for chain ${chainId}`, error);
                });
            }, initialDelay);
            chainIndex++;
        });
        logger_1.logger.info('Activity monitoring started', {
            chains: walletsByChain.size,
            wallets: wallets.length
        });
    }
    catch (error) {
        logger_1.logger.error('Error starting activity monitoring', error);
        throw error;
    }
}
/**
 * Stop monitoring (cleanup)
 */
function stopActivityMonitoring() {
    monitoringIntervals.forEach((interval) => {
        clearInterval(interval);
    });
    wsTimeBasedIntervals.forEach((interval) => {
        clearInterval(interval);
    });
    // Clear debounced block processing timeouts
    wsBlockProcessingTimeouts.forEach((timeout) => {
        clearTimeout(timeout);
    });
    wsSubscriptions.forEach((subscriptions, chainId) => {
        const wsProvider = wsProviders.get(chainId);
        if (wsProvider) {
            try {
                if (subscriptions.block) {
                    wsProvider.off('block', subscriptions.block);
                }
                wsProvider.destroy();
            }
            catch (error) {
                logger_1.logger.error(`Error stopping WebSocket for chain ${chainId}`, error);
            }
        }
    });
    monitoringIntervals.clear();
    wsTimeBasedIntervals.clear();
    wsBlockProcessingTimeouts.clear();
    monitoredWallets.clear();
    walletToUserId.clear();
    lastCheckedBlock.clear();
    lastKnownBlockNumber.clear();
    lastKnownBlockTimestamp.clear();
    wsProviders.clear();
    wsSubscriptions.clear();
    wsHealthChecks.clear();
    rateLimitCount.clear();
    rateLimitFrequency.clear();
    circuitBreaker.clear();
    blocksSinceLastCheck.clear();
    blocksBeingProcessed.clear();
    activeChecks.clear();
}
/**
 * Add a wallet to monitoring dynamically (for new wallets created after server startup)
 * @param walletAddress Wallet address to monitor
 * @param chainId Chain ID to monitor on
 * @param userId User ID associated with the wallet
 */
async function addWalletToMonitoring(walletAddress, chainId, userId) {
    try {
        const walletLower = walletAddress.toLowerCase();
        // Add to monitored wallets for this chain
        if (!monitoredWallets.has(chainId)) {
            monitoredWallets.set(chainId, new Set());
        }
        if (monitoredWallets.get(chainId).has(walletLower)) {
            logger_1.logger.debug(`Wallet ${walletLower} already being monitored on chain ${chainId}`, {
                chainId,
                walletAddress: walletLower,
                userId
            });
            return;
        }
        monitoredWallets.get(chainId).add(walletLower);
        walletToUserId.set(walletLower, userId);
        logger_1.logger.info(`Added wallet to monitoring`, {
            chainId,
            walletAddress: walletLower,
            userId,
            totalWalletsOnChain: monitoredWallets.get(chainId).size
        });
        // Verify wallet was added successfully
        const isNowMonitored = monitoredWallets.get(chainId).has(walletLower);
        if (!isNowMonitored) {
            logger_1.logger.error(`Failed to verify wallet was added to monitoring`, {
                chainId,
                walletAddress: walletLower,
                userId
            });
            throw new Error(`Failed to add wallet ${walletLower} to monitoring on chain ${chainId}`);
        }
        // Ensure WebSocket monitoring is set up for this chain
        const wsProvider = wsProviders.get(chainId);
        if (!wsProvider) {
            // Try to set up WebSocket monitoring if not already done
            setupWebSocketMonitoring(chainId).catch(error => {
                logger_1.logger.warn(`Failed to set up WebSocket monitoring for chain ${chainId} after adding wallet`, error);
                // Continue - polling will still work
            });
        }
        setTimeout(async () => {
            try {
                // Fix: Properly catch getProvider errors
                let provider;
                try {
                    provider = (0, blockchain_1.getProvider)(chainId);
                }
                catch (error) {
                    logger_1.logger.error(`No provider configured for chain ${chainId} in addWalletToMonitoring`, error);
                    return;
                }
                let currentBlock;
                const trackedBlock = lastKnownBlockNumber.get(chainId);
                if (trackedBlock) {
                    currentBlock = trackedBlock;
                }
                else {
                    const wsReady = isWebSocketReady(chainId);
                    const hasReceivedBlock = lastKnownBlockNumber.has(chainId);
                    const maxWait = (wsReady && !hasReceivedBlock)
                        ? activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_LONG
                        : activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_SHORT;
                    let trackedBlock;
                    const startWait = Date.now();
                    while (!trackedBlock && (Date.now() - startWait) < maxWait) {
                        await delay(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_CHECK_INTERVAL);
                        trackedBlock = lastKnownBlockNumber.get(chainId);
                    }
                    if (trackedBlock) {
                        currentBlock = trackedBlock;
                    }
                    else {
                        try {
                            currentBlock = await getBlockNumberWithRetry(provider, chainId);
                            lastKnownBlockNumber.set(chainId, currentBlock);
                            lastKnownBlockTimestamp.set(chainId, Date.now());
                        }
                        catch (error) {
                            logger_1.logger.error(`Failed to get block number for chain ${chainId} in addWalletToMonitoring`, error);
                            return;
                        }
                    }
                }
                // CRITICAL OPTIMIZATION: Check lastCheckedBlock to avoid re-fetching already processed blocks
                const lastBlock = lastCheckedBlock.get(chainId);
                const checkFromBlock = lastBlock
                    ? Math.max(lastBlock + 1, currentBlock - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.NEW_WALLET_BLOCK_RANGE)
                    : Math.max(currentBlock - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.NEW_WALLET_BLOCK_RANGE, 0);
                const checkToBlock = currentBlock;
                // Skip if no new blocks to check
                if (checkFromBlock > checkToBlock) {
                    logger_1.logger.debug(`No new blocks to check for new wallet on chain ${chainId}`, {
                        chainId,
                        lastBlock,
                        currentBlock,
                        checkFromBlock,
                        checkToBlock
                    });
                    return;
                }
                // Quick check for recent deposits (only new blocks, with request queue)
                for (let blockNum = checkFromBlock; blockNum <= checkToBlock; blockNum++) {
                    // CRITICAL: Multiple checks to prevent redundant RPC calls
                    const isAlreadyProcessed = lastBlock && blockNum <= lastBlock;
                    const isBeingProcessed = blocksBeingProcessed.get(chainId)?.has(blockNum);
                    if (isAlreadyProcessed || isBeingProcessed) {
                        logger_1.logger.debug(`Skipping block ${blockNum} for new wallet - already processed or being processed`, {
                            chainId,
                            blockNum,
                            isAlreadyProcessed,
                            isBeingProcessed
                        });
                        continue;
                    }
                    // Mark as being processed
                    if (!blocksBeingProcessed.has(chainId)) {
                        blocksBeingProcessed.set(chainId, new Set());
                    }
                    blocksBeingProcessed.get(chainId).add(blockNum);
                    await waitForRequestSlot(); // Use request queue to prevent 429 errors
                    try {
                        // Try to get block with full transactions using direct RPC call
                        let block = null;
                        try {
                            block = await getBlockWithFullTransactions(provider, blockNum, chainId);
                        }
                        catch (error) {
                            // Fallback to normal getBlock
                            logger_1.logger.debug(`getBlockWithFullTransactions failed in addWalletToMonitoring for block ${blockNum}`, {
                                chainId,
                                blockNum,
                                error: error.message
                            });
                            try {
                                block = await provider.getBlock(blockNum, true);
                            }
                            catch (fallbackError) {
                                // Final fallback: get block without transactions
                                const blockHeader = await provider.getBlock(blockNum, false);
                                if (blockHeader && blockHeader.transactions.length > 0) {
                                    block = await provider.getBlock(blockNum, true);
                                }
                                else {
                                    block = blockHeader;
                                }
                            }
                        }
                        // CRITICAL FIX: If transactions are strings (hashes), fetch full transaction objects
                        if (block && block.transactions && block.transactions.length > 0 && typeof block.transactions[0] === 'string') {
                            const transactionHashes = block.transactions;
                            const transactionPromises = transactionHashes.map(async (txHash) => {
                                await waitForRequestSlot();
                                try {
                                    const tx = await provider.getTransaction(txHash);
                                    return tx;
                                }
                                catch (error) {
                                    logger_1.logger.error(`Failed to fetch transaction ${txHash} for block ${blockNum} in addWalletToMonitoring on chain ${chainId}`, {
                                        chainId,
                                        blockNum,
                                        txHash,
                                        error: error.message || String(error)
                                    });
                                    return null;
                                }
                                finally {
                                    releaseRequestSlot();
                                }
                            });
                            const transactions = await Promise.all(transactionPromises);
                            const validTransactions = transactions.filter(tx => tx !== null);
                            block.transactions = validTransactions;
                        }
                        // CRITICAL FIX: If transactions are strings (hashes), fetch full transaction objects
                        if (block && block.transactions && block.transactions.length > 0 && typeof block.transactions[0] === 'string') {
                            const transactionHashes = block.transactions;
                            const transactionPromises = transactionHashes.map(async (txHash) => {
                                await waitForRequestSlot();
                                try {
                                    const tx = await provider.getTransaction(txHash);
                                    return tx;
                                }
                                catch (error) {
                                    logger_1.logger.error(`Failed to fetch transaction ${txHash} for block ${blockNum} in addWalletToMonitoring on chain ${chainId}`, {
                                        chainId,
                                        blockNum,
                                        txHash,
                                        error: error.message || String(error)
                                    });
                                    return null;
                                }
                                finally {
                                    releaseRequestSlot();
                                }
                            });
                            const transactions = await Promise.all(transactionPromises);
                            const validTransactions = transactions.filter(tx => tx !== null);
                            block.transactions = validTransactions;
                        }
                        if (!block || !block.transactions) {
                            blocksBeingProcessed.get(chainId)?.delete(blockNum); // Release lock
                            releaseRequestSlot();
                            continue;
                        }
                        const blockTimestamp = block.timestamp ? new Date(block.timestamp * 1000) : new Date();
                        for (const tx of block.transactions) {
                            if (typeof tx === 'string')
                                continue;
                            // Type assertion: after the check above, tx is a TransactionResponse
                            const txResponse = tx;
                            // CRITICAL FIX: Check tx.to !== null BEFORE calling toLowerCase()
                            // Contract creation transactions have tx.to === null
                            if (txResponse.to === null || !txResponse.to) {
                                continue; // Skip contract creation transactions
                            }
                            // Normalize tx.value to bigint
                            let txValue;
                            if (txResponse.value === undefined || txResponse.value === null) {
                                txValue = 0n;
                            }
                            else if (typeof txResponse.value === 'string') {
                                try {
                                    txValue = BigInt(txResponse.value);
                                }
                                catch {
                                    txValue = 0n;
                                }
                            }
                            else if (typeof txResponse.value === 'bigint') {
                                txValue = txResponse.value;
                            }
                            else if (typeof txResponse.value === 'number') {
                                txValue = BigInt(txResponse.value);
                            }
                            else {
                                txValue = 0n;
                            }
                            // Validate transaction has all required fields
                            // tx.to is guaranteed to be non-null after the check above
                            if (txResponse.to.toLowerCase() === walletLower &&
                                txResponse.from &&
                                txResponse.from.toLowerCase() !== walletLower &&
                                txValue > 0n &&
                                txResponse.hash) { // Ensure transaction hash exists
                                // Found a deposit - save it
                                try {
                                    await (0, activityService_1.saveActivity)({
                                        type: 'deposit',
                                        walletAddress: walletLower,
                                        fromAddress: txResponse.from.toLowerCase(),
                                        toAddress: walletLower,
                                        amount: txValue.toString(),
                                        txHash: txResponse.hash.toLowerCase(), // Safe to use now - validated above
                                        blockNumber: blockNum,
                                        blockTimestamp,
                                        chainId: chainId,
                                        status: 'confirmed',
                                        userId: userId
                                    });
                                    logger_1.logger.info(`✅ Deposit detected for new wallet`, {
                                        chainId,
                                        txHash: txResponse.hash.toLowerCase(),
                                        walletAddress: walletLower,
                                        fromAddress: txResponse.from.toLowerCase(),
                                        amount: ethers_1.ethers.formatEther(txValue),
                                        blockNumber: blockNum
                                    });
                                }
                                catch (saveError) {
                                    if (saveError.code !== 11000) {
                                        logger_1.logger.error(`Error saving deposit for new wallet`, saveError);
                                    }
                                }
                            }
                        }
                        // Release lock after processing
                        blocksBeingProcessed.get(chainId)?.delete(blockNum);
                    }
                    catch (blockError) {
                        // Release lock on error
                        blocksBeingProcessed.get(chainId)?.delete(blockNum);
                        // Skip block on error
                    }
                    finally {
                        releaseRequestSlot(); // Always release slot
                    }
                }
            }
            catch (error) {
                logger_1.logger.error(`Error checking recent deposits for new wallet ${walletAddress}`, error);
            }
        }, activityMonitor_1.ACTIVITY_MONITOR_CONFIG.NEW_WALLET_CHECK_DELAY);
    }
    catch (error) {
        logger_1.logger.error(`Error adding wallet to monitoring`, error);
        throw error;
    }
}
/**
 * Manually check for deposits for a specific wallet
 * This can be called when we know a deposit might have happened
 */
/**
 * Get diagnostic information about activity monitoring
 * Used for debugging and health checks
 */
function getMonitoringDiagnostics() {
    const diagnostics = {
        monitoredWallets: {},
        lastCheckedBlocks: {},
        lastKnownBlocks: {},
        activeChecks: {},
        circuitBreakers: {},
        rateLimitCounts: {},
        websocketStatus: {},
        blocksSinceLastCheck: {},
    };
    // Convert Maps to plain objects for JSON serialization
    monitoredWallets.forEach((wallets, chainId) => {
        diagnostics.monitoredWallets[chainId] = Array.from(wallets);
    });
    lastCheckedBlock.forEach((block, chainId) => {
        diagnostics.lastCheckedBlocks[chainId] = block;
    });
    lastKnownBlockNumber.forEach((block, chainId) => {
        diagnostics.lastKnownBlocks[chainId] = block;
    });
    activeChecks.forEach((_, chainId) => {
        diagnostics.activeChecks[chainId] = true;
    });
    circuitBreaker.forEach((breaker, chainId) => {
        diagnostics.circuitBreakers[chainId] = breaker;
    });
    rateLimitCount.forEach((count, chainId) => {
        diagnostics.rateLimitCounts[chainId] = count;
    });
    wsProviders.forEach((_, chainId) => {
        diagnostics.websocketStatus[chainId] = true;
    });
    blocksSinceLastCheck.forEach((count, chainId) => {
        diagnostics.blocksSinceLastCheck[chainId] = count;
    });
    return diagnostics;
}
/**
 * Check if a wallet is being monitored
 */
function isWalletMonitored(walletAddress, chainId) {
    const wallets = monitoredWallets.get(chainId);
    if (!wallets)
        return false;
    return wallets.has(walletAddress.toLowerCase());
}
/**
 * Get monitoring status for a specific wallet
 */
function getWalletMonitoringStatus(walletAddress, chainId) {
    const walletLower = walletAddress.toLowerCase();
    const wallets = monitoredWallets.get(chainId);
    const isMonitored = wallets ? wallets.has(walletLower) : false;
    return {
        isMonitored,
        userId: walletToUserId.get(walletLower),
        lastCheckedBlock: lastCheckedBlock.get(chainId),
        lastKnownBlock: lastKnownBlockNumber.get(chainId),
        chainId,
    };
}
/**
 * Manually trigger deposit check for a specific chain
 * Useful for testing and debugging
 */
async function triggerDepositCheck(chainId) {
    try {
        const wallets = monitoredWallets.get(chainId);
        if (!wallets || wallets.size === 0) {
            return {
                success: false,
                message: `No wallets being monitored on chain ${chainId}`,
            };
        }
        // OPTIMIZATION: Use WebSocket block number if available (saves getBlockNumber RPC call)
        let currentBlock;
        const trackedBlock = lastKnownBlockNumber.get(chainId);
        const trackedBlockTimestamp = lastKnownBlockTimestamp.get(chainId);
        const now = Date.now();
        const BLOCK_CACHE_MAX_AGE = 120000; // 2 minutes
        const blockAge = trackedBlockTimestamp ? (now - trackedBlockTimestamp) : Infinity;
        if (trackedBlock && blockAge < BLOCK_CACHE_MAX_AGE) {
            // Use cached block number - saves RPC call
            currentBlock = trackedBlock;
        }
        else {
            const provider = (0, blockchain_1.getProvider)(chainId);
            currentBlock = await provider.getBlockNumber();
            lastKnownBlockNumber.set(chainId, currentBlock);
            lastKnownBlockTimestamp.set(chainId, Date.now());
        }
        const lastBlock = lastCheckedBlock.get(chainId) || currentBlock - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.INITIAL_BLOCK_RANGE;
        const blockRange = activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_SIZE + activityMonitor_1.ACTIVITY_MONITOR_CONFIG.BLOCKS_BATCH_OVERLAP;
        const fromBlock = Math.max(lastBlock + 1, currentBlock - blockRange + 1);
        await checkForDeposits(chainId, currentBlock);
        return {
            success: true,
            message: `Deposit check triggered for chain ${chainId}`,
            blockRange: {
                from: fromBlock,
                to: currentBlock,
            },
        };
    }
    catch (error) {
        logger_1.logger.error(`Error triggering deposit check for chain ${chainId}`, error);
        return {
            success: false,
            message: `Failed to trigger deposit check`,
            error: error.message || String(error),
        };
    }
}
async function checkWalletForDeposits(_walletAddress, chainId, fromBlock) {
    try {
        const provider = (0, blockchain_1.getProvider)(chainId);
        if (!provider) {
            return;
        }
        // Get block number (prefer tracked from WebSocket, fallback to RPC)
        let currentBlock;
        const trackedBlock = lastKnownBlockNumber.get(chainId);
        if (trackedBlock) {
            currentBlock = trackedBlock;
        }
        else {
            const wsReady = isWebSocketReady(chainId);
            const hasReceivedBlock = lastKnownBlockNumber.has(chainId);
            const maxWait = (wsReady && !hasReceivedBlock)
                ? activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_LONG
                : activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_WAIT_SHORT;
            let trackedBlock;
            const startWait = Date.now();
            while (!trackedBlock && (Date.now() - startWait) < maxWait) {
                await delay(activityMonitor_1.ACTIVITY_MONITOR_CONFIG.WS_BLOCK_CHECK_INTERVAL);
                trackedBlock = lastKnownBlockNumber.get(chainId);
            }
            if (trackedBlock) {
                currentBlock = trackedBlock;
            }
            else {
                await waitForRequestSlot();
                try {
                    currentBlock = await provider.getBlockNumber();
                    lastKnownBlockNumber.set(chainId, currentBlock);
                    lastKnownBlockTimestamp.set(chainId, Date.now());
                }
                finally {
                    releaseRequestSlot();
                }
            }
        }
        // Calculate checkFromBlock (currently unused but kept for future implementation)
        // @ts-expect-error - Variable is intentionally unused but kept for future implementation
        const _checkFromBlock = fromBlock || Math.max(currentBlock - activityMonitor_1.ACTIVITY_MONITOR_CONFIG.MANUAL_CHECK_BLOCK_RANGE, 0);
    }
    catch (error) {
        logger_1.logger.error(`Error in manual deposit check`, error);
    }
}
//# sourceMappingURL=activityMonitor.js.map