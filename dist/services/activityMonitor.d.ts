/**
 * Start monitoring all embedded wallets
 * Optimized for large-scale operations (10k+ wallets)
 */
export declare function startActivityMonitoring(): Promise<void>;
/**
 * Stop monitoring (cleanup)
 */
export declare function stopActivityMonitoring(): void;
/**
 * Add a wallet to monitoring dynamically (for new wallets created after server startup)
 * @param walletAddress Wallet address to monitor
 * @param chainId Chain ID to monitor on
 * @param userId User ID associated with the wallet
 */
export declare function addWalletToMonitoring(walletAddress: string, chainId: number, userId: string): Promise<void>;
/**
 * Manually check for deposits for a specific wallet
 * This can be called when we know a deposit might have happened
 */
/**
 * Get diagnostic information about activity monitoring
 * Used for debugging and health checks
 */
export declare function getMonitoringDiagnostics(): {
    monitoredWallets: Record<number, string[]>;
    lastCheckedBlocks: Record<number, number>;
    lastKnownBlocks: Record<number, number>;
    activeChecks: Record<number, boolean>;
    circuitBreakers: Record<number, {
        enabled: boolean;
        until: number;
    }>;
    rateLimitCounts: Record<number, number>;
    websocketStatus: Record<number, boolean>;
    blocksSinceLastCheck: Record<number, number>;
};
/**
 * Check if a wallet is being monitored
 */
export declare function isWalletMonitored(walletAddress: string, chainId: number): boolean;
/**
 * Get monitoring status for a specific wallet
 */
export declare function getWalletMonitoringStatus(walletAddress: string, chainId: number): {
    isMonitored: boolean;
    userId: string | undefined;
    lastCheckedBlock: number | undefined;
    lastKnownBlock: number | undefined;
    chainId: number;
};
/**
 * Manually trigger deposit check for a specific chain
 * Useful for testing and debugging
 */
export declare function triggerDepositCheck(chainId: number): Promise<{
    success: boolean;
    message: string;
    blockRange?: {
        from: number;
        to: number;
    };
    error?: string;
}>;
export declare function checkWalletForDeposits(_walletAddress: string, chainId: number, fromBlock?: number): Promise<void>;
//# sourceMappingURL=activityMonitor.d.ts.map