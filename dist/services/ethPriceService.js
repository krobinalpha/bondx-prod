"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEthPriceUSD = getEthPriceUSD;
exports.clearEthPriceCache = clearEthPriceCache;
const axios_1 = __importDefault(require("axios"));
// Cache ETH price for 5 minutes (300000 ms)
const CACHE_DURATION = 5 * 60 * 1000;
let cachedPrice = null;
/**
 * Fetches the current ETH price in USD from Alchemy API
 * Uses caching to reduce API calls (5-minute cache)
 * Falls back to CoinGecko if Alchemy fails
 *
 * @returns Promise<string> ETH price in USD as a string
 */
async function getEthPriceUSD() {
    // Check cache first
    if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_DURATION) {
        return cachedPrice.price;
    }
    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    // Try Alchemy API first
    if (alchemyApiKey) {
        try {
            const response = await axios_1.default.get('https://api.g.alchemy.com/prices/v1/tokens/by-symbol', {
                params: {
                    symbols: 'ETH'
                },
                headers: {
                    'Authorization': `Bearer ${alchemyApiKey}`
                },
                timeout: 5000 // 5 second timeout
            });
            if (response.data?.data?.[0]?.prices) {
                const usdPrice = response.data.data[0].prices.find((p) => p.currency === 'USD');
                if (usdPrice?.value) {
                    const price = usdPrice.value.toString();
                    // Update cache
                    cachedPrice = {
                        price,
                        timestamp: Date.now()
                    };
                    return price;
                }
            }
        }
        catch (error) {
            console.error('❌ Error fetching ETH price from Alchemy:', error.message);
            // Fall through to CoinGecko fallback
        }
    }
    // Fallback to CoinGecko API
    try {
        const response = await axios_1.default.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'ethereum',
                vs_currencies: 'usd'
            },
            timeout: 5000
        });
        if (response.data?.ethereum?.usd) {
            const price = response.data.ethereum.usd.toString();
            // Update cache
            cachedPrice = {
                price,
                timestamp: Date.now()
            };
            return price;
        }
    }
    catch (error) {
        console.error('❌ Error fetching ETH price from CoinGecko:', error.message);
    }
    // If both fail, return last cached price or default
    if (cachedPrice) {
        console.error('⚠️ Using stale cached ETH price due to API failures');
        return cachedPrice.price;
    }
    // Last resort: return a default price (should rarely happen)
    console.error('❌ All ETH price APIs failed, using default price');
    return '3000'; // Default fallback price
}
/**
 * Clears the ETH price cache (useful for testing)
 */
function clearEthPriceCache() {
    cachedPrice = null;
}
//# sourceMappingURL=ethPriceService.js.map