"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const TokenHistory_1 = __importDefault(require("../models/TokenHistory"));
const Token_1 = __importDefault(require("../models/Token"));
const validation_1 = require("../middleware/validation");
const router = express_1.default.Router();
// GET /api/histories/token/:tokenAddress - Get price history for a token
router.get('/token/:tokenAddress', [
    (0, express_validator_1.param)('tokenAddress').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { tokenAddress } = req.params;
        const { chainId, limit = 100 } = req.query;
        // Build query
        const query = {
            tokenAddress: tokenAddress.toLowerCase()
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        else {
            // If no chainId provided, try to get it from token
            const token = await Token_1.default.findOne({ address: tokenAddress.toLowerCase() });
            if (token) {
                query.chainId = token.chainId;
            }
        }
        const histories = await TokenHistory_1.default.find(query)
            .sort({ timestamp: 1 }) // Ascending order (oldest to newest) for proper chart display
            .limit(parseInt(limit))
            .select('tokenPrice priceUSD marketCap marketCapUSD timestamp blockNumber')
            .lean();
        // Format response to include both price and market cap data
        const formattedHistories = histories.map(history => ({
            price: history.tokenPrice || '0',
            priceUSD: history.priceUSD || '0',
            marketCap: history.marketCap || '0',
            marketCapUSD: history.marketCapUSD || '0',
            timestamp: history.timestamp?.toISOString() || new Date().toISOString(),
            blockNumber: history.blockNumber || 0
        }));
        res.json({
            data: formattedHistories
        });
    }
    catch (error) {
        console.error('Error fetching price history:', error);
        res.status(500).json({ error: 'Failed to fetch price history' });
    }
});
exports.default = router;
//# sourceMappingURL=histories.js.map