"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const ChatMessage_1 = __importDefault(require("../models/ChatMessage"));
const validation_1 = require("../middleware/validation");
const auth_1 = require("../middleware/auth");
const chatEmitter_1 = require("../socket/chatEmitter");
const router = express_1.default.Router();
// POST /api/chat/message - Add a new chat message (requires authentication)
router.post('/message', auth_1.authenticateToken, [
    (0, express_validator_1.body)('token').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.body)('message').trim().isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters'),
    (0, express_validator_1.body)('reply_to').optional().isMongoId().withMessage('Invalid reply_to ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { token, message, reply_to } = req.body;
        // Get user address from authenticated user
        // Priority: primaryWallet > first walletAddress > email (for embedded wallets)
        let userAddress;
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (primaryWalletAddress) {
            userAddress = primaryWalletAddress.toLowerCase();
        }
        else if (user.walletAddresses && user.walletAddresses.length > 0) {
            userAddress = user.walletAddresses[0].address.toLowerCase();
        }
        else if (user.email && user.email.includes('@wallet.local')) {
            // Embedded wallet - extract address from email
            userAddress = user.email.split('@')[0].toLowerCase();
        }
        if (!userAddress) {
            return res.status(400).json({ error: 'User address not found. Please connect a wallet.' });
        }
        const chatMessage = await ChatMessage_1.default.create({
            token: token.toLowerCase(),
            user: userAddress,
            message: message.trim(),
            reply_to: reply_to || null,
            timestamp: new Date()
        });
        const formattedMessage = {
            id: chatMessage._id.toString(),
            user: chatMessage.user,
            token: chatMessage.token,
            message: chatMessage.message,
            reply_to: chatMessage.reply_to ? chatMessage.reply_to.toString() : null,
            timestamp: chatMessage.timestamp.toISOString()
        };
        // Emit new message via WebSocket for real-time updates
        (0, chatEmitter_1.emitChatMessage)(formattedMessage);
        res.status(201).json(formattedMessage);
    }
    catch (error) {
        console.error('Error adding chat message:', error);
        res.status(500).json({ error: 'Failed to add chat message' });
    }
});
// GET /api/chat/messages - Get chat messages for a token
router.get('/messages', [
    (0, express_validator_1.query)('token').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { token, page = 1, pageSize = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        const [messages, totalCount] = await Promise.all([
            ChatMessage_1.default.find({ token: token.toLowerCase() })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .populate('reply_to')
                .lean(),
            ChatMessage_1.default.countDocuments({ token: token.toLowerCase() })
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        // Format response
        const formattedMessages = messages.map(msg => ({
            id: msg._id.toString(),
            user: msg.user,
            token: msg.token,
            message: msg.message,
            reply_to: msg.reply_to ? (typeof msg.reply_to === 'object' && msg.reply_to !== null && '_id' in msg.reply_to ? String(msg.reply_to._id) : (typeof msg.reply_to === 'string' ? msg.reply_to : null)) : null,
            timestamp: msg.timestamp?.toISOString() || new Date().toISOString()
        }));
        res.json({
            data: formattedMessages,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching chat messages:', error);
        res.status(500).json({ error: 'Failed to fetch chat messages' });
    }
});
exports.default = router;
//# sourceMappingURL=chat.js.map