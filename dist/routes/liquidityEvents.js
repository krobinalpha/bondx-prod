"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const LiquidityEvent_1 = __importDefault(require("../models/LiquidityEvent"));
const Token_1 = __importDefault(require("../models/Token"));
const validation_1 = require("../middleware/validation");
const router = express_1.default.Router();
// GET /api/liquidity-events - Get liquidity events for a token
router.get('/', [
    (0, express_validator_1.query)('tokenAddress').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { tokenAddress, page = 1, pageSize = 20, chainId } = req.query;
        // Build query
        const query = {
            tokenAddress: tokenAddress.toLowerCase()
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        else {
            // If no chainId provided, try to get it from token (optimize with lean and select only chainId)
            const token = await Token_1.default.findOne({ address: tokenAddress.toLowerCase() })
                .select('chainId')
                .lean();
            if (token) {
                query.chainId = token.chainId;
            }
        }
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        const [events, totalCount] = await Promise.all([
            LiquidityEvent_1.default.find(query)
                .sort({ blockTimestamp: -1 })
                .skip(skip)
                .limit(limit)
                .populate('tokenId', 'name symbol')
                .lean(),
            LiquidityEvent_1.default.countDocuments(query)
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            data: events,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching liquidity events:', error);
        res.status(500).json({ error: 'Failed to fetch liquidity events' });
    }
});
exports.default = router;
//# sourceMappingURL=liquidityEvents.js.map