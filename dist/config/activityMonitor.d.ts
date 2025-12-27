/**
 * Configuration constants for activity monitoring
 * All magic numbers and thresholds are centralized here
 */
export declare const ACTIVITY_MONITOR_CONFIG: {
    readonly DEFAULT_BLOCK_RANGE: 20;
    readonly INITIAL_BLOCK_RANGE: 20;
    readonly NEW_WALLET_BLOCK_RANGE: 10;
    readonly MANUAL_CHECK_BLOCK_RANGE: 100;
    readonly BLOCKS_BATCH_SIZE: 1;
    readonly BLOCKS_BATCH_OVERLAP: 0;
    readonly CHECK_INTERVAL_SECONDS: 10;
    readonly MAX_CONCURRENT_REQUESTS: 3;
    readonly MIN_DELAY_BETWEEN_GET_BLOCK_NUMBER: 500;
    readonly MAX_RETRIES: 3;
    readonly RETRY_BACKOFF_BASE: 5000;
    readonly RETRY_BACKOFF_MAX: 30000;
    readonly CIRCUIT_BREAKER_THRESHOLD: 50;
    readonly CIRCUIT_BREAKER_COOLDOWN: number;
    readonly MAX_ERRORS_PER_MINUTE: 10;
    readonly HIGH_ERROR_THRESHOLD: 20;
    readonly HIGH_ERROR_RATE_THRESHOLD: 15;
    readonly AGGRESSIVE_THROTTLE_ERROR_COUNT: 5;
    readonly MODERATE_THROTTLE_ERROR_COUNT: 2;
    readonly AGGRESSIVE_BLOCK_RANGE: 10;
    readonly MODERATE_BLOCK_RANGE: 15;
    readonly NORMAL_BLOCK_RANGE: 20;
    readonly NORMAL_BATCH_SIZE: 3;
    readonly MODERATE_BATCH_SIZE: 2;
    readonly AGGRESSIVE_BATCH_SIZE: 2;
    readonly NORMAL_BATCH_PAUSE: 5000;
    readonly MODERATE_BATCH_PAUSE: 8000;
    readonly AGGRESSIVE_BATCH_PAUSE: 5000;
    readonly NORMAL_DELAY_BETWEEN_BLOCKS: 500;
    readonly MODERATE_DELAY_BETWEEN_BLOCKS: 750;
    readonly AGGRESSIVE_DELAY_BETWEEN_BLOCKS: 1000;
    readonly MAX_PRE_DELAY: 30000;
    readonly PRE_DELAY_MULTIPLIER: 5000;
    readonly POLLING_INTERVAL: 600000;
    readonly INITIAL_CHECK_DELAY: 5000;
    readonly INITIAL_CHECK_STAGGER: 10000;
    readonly NEW_WALLET_CHECK_DELAY: 2000;
    readonly WS_CONNECTION_CHECK_INTERVAL: 1000;
    readonly WS_FIRST_BLOCK_TIMEOUT: 30000;
    readonly WS_BLOCK_WAIT_SHORT: 5000;
    readonly WS_BLOCK_WAIT_LONG: 30000;
    readonly WS_BLOCK_CHECK_INTERVAL: 500;
    readonly WS_RECONNECT_DELAY_BASE: 5000;
    readonly WS_RECONNECT_DELAY_MAX: 60000;
    readonly WS_RECONNECT_MAX_ATTEMPTS: 10;
    readonly BLOCKS_PROCESSED_CLEANUP_INTERVAL: number;
    readonly BLOCKS_PROCESSED_MAX_AGE: number;
    readonly RATE_LIMIT_FREQUENCY_MAX_SIZE: 50;
    readonly BLOCKS_PROCESSED_MAX_SIZE: 1000;
    readonly DB_RETRY_MAX_ATTEMPTS: 3;
    readonly DB_RETRY_DELAY_BASE: 1000;
    readonly DB_BATCH_SIZE: 1000;
    readonly DEBOUNCE_DELAY: 2000;
    readonly MAX_CONCURRENT_CHECKS_PER_CHAIN: 1;
    readonly ERROR_COUNT_REDUCTION_ON_SUCCESS: 10;
    readonly EXCESSIVE_ERROR_THRESHOLD: 100;
};
//# sourceMappingURL=activityMonitor.d.ts.map