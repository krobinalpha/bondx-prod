"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const Transaction_1 = __importDefault(require("../models/Transaction"));
const validation_1 = require("../middleware/validation");
const router = express_1.default.Router();
// GET /api/transactions/token/:tokenAddress - Get transactions for a token
router.get('/token/:tokenAddress', [
    (0, express_validator_1.param)('tokenAddress').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { tokenAddress } = req.params;
        const { page = 1, pageSize = 10, chainId } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        // Build query with chainId if provided
        const query = {
            tokenAddress: tokenAddress.toLowerCase()
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        const [transactions, totalCount] = await Promise.all([
            Transaction_1.default.find(query)
                .sort({ blockTimestamp: -1 })
                .skip(skip)
                .limit(limit),
            Transaction_1.default.countDocuments(query)
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            transactions: transactions,
            data: transactions,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching token transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});
// GET /api/transactions/address/:address - Get transactions for an address
router.get('/address/:address', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { page = 1, pageSize = 10, chainId } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        // Build query - find transactions where address is sender or recipient
        const query = {
            $or: [
                { senderAddress: address.toLowerCase() },
                { recipientAddress: address.toLowerCase() }
            ]
        };
        if (chainId) {
            query.chainId = parseInt(chainId);
        }
        const [transactions, totalCount] = await Promise.all([
            Transaction_1.default.find(query)
                .sort({ blockTimestamp: -1 })
                .skip(skip)
                .limit(limit),
            Transaction_1.default.countDocuments(query)
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            transactions: transactions,
            data: transactions,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching address transactions:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});
exports.default = router;
//# sourceMappingURL=transactions.js.map