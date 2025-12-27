/**
 * Fetches the current ETH price in USD from Alchemy API
 * Uses caching to reduce API calls (5-minute cache)
 * Falls back to CoinGecko if Alchemy fails
 *
 * @returns Promise<string> ETH price in USD as a string
 */
export declare function getEthPriceUSD(): Promise<string>;
/**
 * Clears the ETH price cache (useful for testing)
 */
export declare function clearEthPriceCache(): void;
//# sourceMappingURL=ethPriceService.d.ts.map