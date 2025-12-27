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
    (0, express_validator_1.body)('message').trim().isLength({ min: 1, max: 100 }).withMessage('Message must be between 1 and 100 characters'),
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
        else if (user.walletAddresses && Array.isArray(user.walletAddresses) && user.walletAddresses.length > 0) {
            // Validate array has elements before accessing index 0
            userAddress = user.walletAddresses[0]?.address?.toLowerCase();
        }
        else if (user.email && typeof user.email === 'string' && user.email.includes('@wallet.local')) {
            // Embedded wallet - extract address from email
            // Validate email contains '@' before splitting
            const emailParts = user.email.split('@');
            if (emailParts.length >= 2 && emailParts[0]) {
                userAddress = emailParts[0].toLowerCase();
            }
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
            timestamp: chatMessage.timestamp.toISOString(),
            editedAt: null
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
                .sort({ timestamp: 1 }) // Oldest first (standard chat behavior)
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
            timestamp: msg.timestamp?.toISOString() || new Date().toISOString(),
            editedAt: msg.editedAt ? msg.editedAt.toISOString() : null
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
// PATCH /api/chat/message/:messageId - Edit a chat message (requires authentication)
router.patch('/message/:messageId', auth_1.authenticateToken, [
    (0, express_validator_1.body)('message').trim().isLength({ min: 1, max: 100 }).withMessage('Message must be between 1 and 100 characters')
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
        const { messageId } = req.params;
        const { message } = req.body;
        // Get user address from authenticated user
        let userAddress;
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (primaryWalletAddress) {
            userAddress = primaryWalletAddress.toLowerCase();
        }
        else if (user.walletAddresses && user.walletAddresses.length > 0) {
            userAddress = user.walletAddresses[0].address.toLowerCase();
        }
        else if (user.email && user.email.includes('@wallet.local')) {
            userAddress = user.email.split('@')[0].toLowerCase();
        }
        if (!userAddress) {
            return res.status(400).json({ error: 'User address not found. Please connect a wallet.' });
        }
        // Find the message and verify ownership
        const chatMessage = await ChatMessage_1.default.findById(messageId);
        if (!chatMessage) {
            return res.status(404).json({ error: 'Message not found' });
        }
        if (chatMessage.user.toLowerCase() !== userAddress.toLowerCase()) {
            return res.status(403).json({ error: 'You can only edit your own messages' });
        }
        // Update message
        chatMessage.message = message.trim();
        chatMessage.editedAt = new Date();
        await chatMessage.save();
        const formattedMessage = {
            id: chatMessage._id.toString(),
            user: chatMessage.user,
            token: chatMessage.token,
            message: chatMessage.message,
            reply_to: chatMessage.reply_to ? chatMessage.reply_to.toString() : null,
            timestamp: chatMessage.timestamp.toISOString(),
            editedAt: chatMessage.editedAt.toISOString()
        };
        // Emit edited message via WebSocket
        (0, chatEmitter_1.emitChatMessageEdited)(formattedMessage);
        res.json(formattedMessage);
    }
    catch (error) {
        console.error('Error editing chat message:', error);
        res.status(500).json({ error: 'Failed to edit chat message' });
    }
});
// DELETE /api/chat/message/:messageId - Delete a chat message (requires authentication)
router.delete('/message/:messageId', auth_1.authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { messageId } = req.params;
        // Get user address from authenticated user
        let userAddress;
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (primaryWalletAddress) {
            userAddress = primaryWalletAddress.toLowerCase();
        }
        else if (user.walletAddresses && user.walletAddresses.length > 0) {
            userAddress = user.walletAddresses[0].address.toLowerCase();
        }
        else if (user.email && user.email.includes('@wallet.local')) {
            userAddress = user.email.split('@')[0].toLowerCase();
        }
        if (!userAddress) {
            return res.status(400).json({ error: 'User address not found. Please connect a wallet.' });
        }
        // Find the message and verify ownership
        const chatMessage = await ChatMessage_1.default.findById(messageId);
        if (!chatMessage) {
            return res.status(404).json({ error: 'Message not found' });
        }
        if (chatMessage.user.toLowerCase() !== userAddress.toLowerCase()) {
            return res.status(403).json({ error: 'You can only delete your own messages' });
        }
        // Store token before deletion for WebSocket emission
        const token = chatMessage.token;
        // messageId is already extracted from req.params above
        // Hard delete the message (completely remove from database)
        await ChatMessage_1.default.findByIdAndDelete(messageId);
        const formattedMessage = {
            id: messageId,
            token: token
        };
        // Emit deleted message via WebSocket
        (0, chatEmitter_1.emitChatMessageDeleted)(formattedMessage);
        res.json({ success: true, messageId });
    }
    catch (error) {
        console.error('Error deleting chat message:', error);
        res.status(500).json({ error: 'Failed to delete chat message' });
    }
});
exports.default = router;
//# sourceMappingURL=chat.js.map