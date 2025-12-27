"use strict";
/**
 * Configuration constants for activity monitoring
 * All magic numbers and thresholds are centralized here
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVITY_MONITOR_CONFIG = void 0;
exports.ACTIVITY_MONITOR_CONFIG = {
    // Block range settings
    DEFAULT_BLOCK_RANGE: 20,
    INITIAL_BLOCK_RANGE: 20,
    NEW_WALLET_BLOCK_RANGE: 10,
    MANUAL_CHECK_BLOCK_RANGE: 100,
    // Block batching (check every N new blocks, process N+overlap blocks)
    // OPTIMIZED: For pay-as-you-go RPC, check immediately and remove overlap
    BLOCKS_BATCH_SIZE: 1, // Trigger check on every block for 10s detection
    BLOCKS_BATCH_OVERLAP: 0, // No overlap - saves 1 block fetch per check
    // Time-based batching (check every N seconds instead of every block)
    // This reduces RPC credit usage while ensuring no blocks are missed
    CHECK_INTERVAL_SECONDS: 10, // Check every 10 seconds (processes all accumulated blocks)
    // Rate limiting
    MAX_CONCURRENT_REQUESTS: 3,
    MIN_DELAY_BETWEEN_GET_BLOCK_NUMBER: 500, // ms
    MAX_RETRIES: 3,
    RETRY_BACKOFF_BASE: 5000, // ms
    RETRY_BACKOFF_MAX: 30000, // ms
    // Circuit breaker
    CIRCUIT_BREAKER_THRESHOLD: 50,
    CIRCUIT_BREAKER_COOLDOWN: 30 * 60 * 1000, // 30 minutes
    MAX_ERRORS_PER_MINUTE: 10,
    HIGH_ERROR_THRESHOLD: 20,
    HIGH_ERROR_RATE_THRESHOLD: 15,
    // Throttling thresholds
    AGGRESSIVE_THROTTLE_ERROR_COUNT: 5,
    MODERATE_THROTTLE_ERROR_COUNT: 2,
    AGGRESSIVE_BLOCK_RANGE: 10,
    MODERATE_BLOCK_RANGE: 15,
    NORMAL_BLOCK_RANGE: 20,
    // Batch processing
    NORMAL_BATCH_SIZE: 3,
    MODERATE_BATCH_SIZE: 2,
    AGGRESSIVE_BATCH_SIZE: 2,
    NORMAL_BATCH_PAUSE: 5000, // ms (reduced from 15000 for faster processing)
    MODERATE_BATCH_PAUSE: 8000, // ms (reduced from 18000 for faster processing)
    AGGRESSIVE_BATCH_PAUSE: 5000, // ms (reduced from 15000 for faster processing)
    // Delays
    NORMAL_DELAY_BETWEEN_BLOCKS: 500, // ms
    MODERATE_DELAY_BETWEEN_BLOCKS: 750, // ms
    AGGRESSIVE_DELAY_BETWEEN_BLOCKS: 1000, // ms
    MAX_PRE_DELAY: 30000, // ms
    PRE_DELAY_MULTIPLIER: 5000, // ms per error
    // Polling
    POLLING_INTERVAL: 600000, // 10 minutes
    INITIAL_CHECK_DELAY: 5000, // ms
    INITIAL_CHECK_STAGGER: 10000, // ms per chain
    NEW_WALLET_CHECK_DELAY: 2000, // ms
    // WebSocket
    WS_CONNECTION_CHECK_INTERVAL: 1000, // ms
    WS_FIRST_BLOCK_TIMEOUT: 30000, // ms
    WS_BLOCK_WAIT_SHORT: 5000, // ms
    WS_BLOCK_WAIT_LONG: 30000, // ms
    WS_BLOCK_CHECK_INTERVAL: 500, // ms
    WS_RECONNECT_DELAY_BASE: 5000, // ms
    WS_RECONNECT_DELAY_MAX: 60000, // ms
    WS_RECONNECT_MAX_ATTEMPTS: 10,
    // Memory management
    BLOCKS_PROCESSED_CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
    BLOCKS_PROCESSED_MAX_AGE: 30 * 60 * 1000, // 30 minutes
    RATE_LIMIT_FREQUENCY_MAX_SIZE: 50,
    BLOCKS_PROCESSED_MAX_SIZE: 1000, // Max blocks per chain
    // Database
    DB_RETRY_MAX_ATTEMPTS: 3,
    DB_RETRY_DELAY_BASE: 1000, // ms
    DB_BATCH_SIZE: 1000,
    // Concurrency control
    DEBOUNCE_DELAY: 2000, // ms - debounce WebSocket block events
    MAX_CONCURRENT_CHECKS_PER_CHAIN: 1,
    // Error recovery
    ERROR_COUNT_REDUCTION_ON_SUCCESS: 10,
    EXCESSIVE_ERROR_THRESHOLD: 100,
};
//# sourceMappingURL=activityMonitor.js.map