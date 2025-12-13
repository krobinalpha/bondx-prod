"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const TokenHolder_1 = __importDefault(require("../models/TokenHolder"));
const Token_1 = __importDefault(require("../models/Token"));
const validation_1 = require("../middleware/validation");
const router = express_1.default.Router();
// GET /api/holders/token/:tokenAddress - Get token holders
router.get('/token/:tokenAddress', [
    (0, express_validator_1.param)('tokenAddress').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 1000 }).withMessage('Page size must be between 1 and 1000'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { tokenAddress } = req.params;
        const { page = 1, pageSize = 100, chainId } = req.query; // Increased default from 25 to 100
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
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        const [holders, totalCount] = await Promise.all([
            TokenHolder_1.default.find(query)
                .sort({ balance: -1 })
                .skip(skip)
                .limit(limit)
                .select('holderAddress balance balanceUSD percentage')
                .lean(),
            TokenHolder_1.default.countDocuments(query)
        ]);
        // Format response to match frontend expectations
        const formattedHolders = holders.map(holder => ({
            owner_address: holder.holderAddress,
            balance: holder.balance,
            balanceUSD: holder.balanceUSD || '0',
            percentage: holder.percentage || 0
        }));
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            result: formattedHolders,
            data: formattedHolders,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching token holders:', error);
        res.status(500).json({ error: 'Failed to fetch token holders' });
    }
});
// GET /api/holders/address/:holderAddress - Get tokens held by an address
router.get('/address/:holderAddress', [
    (0, express_validator_1.param)('holderAddress').custom(validation_1.validateAddress).withMessage('Invalid holder address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { holderAddress } = req.params;
        const { page = 1, pageSize = 100, chainId } = req.query;
        // Build query - only return tokens with balance > 0
        const query = {
            holderAddress: holderAddress.toLowerCase(),
            balance: { $ne: '0' } // Only return tokens with balance > 0
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        // Get holders with token information
        // Sort by balance (BigInt) descending, then by balanceUSD if available
        // Filter out zero balances in query for better performance
        const holders = await TokenHolder_1.default.find({
            ...query,
            balance: { $ne: '0', $gt: '0' } // Only non-zero balances
        })
            .populate('tokenId', 'name symbol address chainId logo')
            .sort({
            balance: -1, // Primary sort by balance (string comparison works for BigInt strings)
            balanceUSD: -1 // Secondary sort by USD value if available
        })
            .skip(skip)
            .limit(limit)
            .lean();
        // Format response to match frontend expectations
        const tokens = holders
            .filter((holder) => holder.tokenId && holder.balance && BigInt(holder.balance) > 0n)
            .map((holder) => ({
            address: holder.tokenAddress,
            token_address: holder.tokenAddress,
            symbol: holder.tokenId?.symbol || 'Unknown',
            name: holder.tokenId?.name || 'Unknown',
            balance: holder.balance,
            balanceUSD: holder.balanceUSD || '0',
            percentage: holder.percentage || 0,
            chainId: holder.chainId,
            logo: holder.tokenId?.logo || '/chats/noimg.svg'
        }));
        const totalCount = await TokenHolder_1.default.countDocuments(query);
        res.json({
            result: tokens,
            data: tokens,
            totalCount,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / limit),
            hasNextPage: parseInt(page) < Math.ceil(totalCount / limit),
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching tokens by holder address:', error);
        res.status(500).json({ error: 'Failed to fetch tokens by holder address' });
    }
});
// GET /api/holders/address/:holderAddress/batch - Get tokens held with full details in one call
router.get('/address/:holderAddress/batch', [
    (0, express_validator_1.param)('holderAddress').custom(validation_1.validateAddress).withMessage('Invalid holder address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { holderAddress } = req.params;
        const { chainId } = req.query;
        // Build query - only return tokens with balance > 0
        const query = {
            holderAddress: holderAddress.toLowerCase(),
            balance: { $ne: '0', $gt: '0' }
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        // Get all holders (no pagination for batch endpoint - frontend can paginate)
        const holders = await TokenHolder_1.default.find(query)
            .populate('tokenId', 'name symbol address chainId logo totalSupply currentPrice marketCap graduationProgress')
            .sort({ balance: -1 })
            .lean();
        // Format response with full token details
        const tokens = holders
            .filter((holder) => holder.tokenId && holder.balance && BigInt(holder.balance) > 0n)
            .map((holder) => ({
            address: holder.tokenAddress,
            token_address: holder.tokenAddress,
            symbol: holder.tokenId?.symbol || 'Unknown',
            name: holder.tokenId?.name || 'Unknown',
            balance: holder.balance,
            balanceUSD: holder.balanceUSD || '0',
            percentage: holder.percentage || 0,
            chainId: holder.chainId,
            logo: holder.tokenId?.logo || '/chats/noimg.svg',
            // Include token details to reduce frontend API calls
            totalSupply: holder.tokenId?.totalSupply || '0',
            currentPrice: holder.tokenId?.currentPrice || '0',
            marketCap: holder.tokenId?.marketCap || '0',
            graduationProgress: holder.tokenId?.graduationProgress || '0'
        }));
        res.json({
            result: tokens,
            data: tokens,
            totalCount: tokens.length
        });
    }
    catch (error) {
        console.error('Error fetching tokens by holder address (batch):', error);
        res.status(500).json({ error: 'Failed to fetch tokens by holder address' });
    }
});
exports.default = router;
//# sourceMappingURL=holders.js.map