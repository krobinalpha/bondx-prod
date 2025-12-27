import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import ChatMessage from '../models/ChatMessage';
import { validateAddress } from '../middleware/validation';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';
import { emitChatMessage, emitChatMessageEdited, emitChatMessageDeleted } from '../socket/chatEmitter';

const router = express.Router();

// POST /api/chat/message - Add a new chat message (requires authentication)
router.post('/message', 
  authenticateToken,
  [
    body('token').custom(validateAddress).withMessage('Invalid token address'),
    body('message').trim().isLength({ min: 1, max: 100 }).withMessage('Message must be between 1 and 100 characters'),
    body('reply_to').optional().isMongoId().withMessage('Invalid reply_to ID')
  ], 
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
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
    let userAddress: string | undefined;
    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    if (primaryWalletAddress) {
      userAddress = primaryWalletAddress.toLowerCase();
    } else if (user.walletAddresses && Array.isArray(user.walletAddresses) && user.walletAddresses.length > 0) {
      // Validate array has elements before accessing index 0
      userAddress = user.walletAddresses[0]?.address?.toLowerCase();
    } else if (user.email && typeof user.email === 'string' && user.email.includes('@wallet.local')) {
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

    const chatMessage = await ChatMessage.create({
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
    emitChatMessage(formattedMessage);

    res.status(201).json(formattedMessage);
  } catch (error) {
    console.error('Error adding chat message:', error);
    res.status(500).json({ error: 'Failed to add chat message' });
  }
});

// GET /api/chat/messages - Get chat messages for a token
router.get('/messages', [
  query('token').custom(validateAddress).withMessage('Invalid token address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, page = 1, pageSize = 50 } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    const [messages, totalCount] = await Promise.all([
      ChatMessage.find({ token: (token as string).toLowerCase() })
        .sort({ timestamp: 1 }) // Oldest first (standard chat behavior)
        .skip(skip)
        .limit(limit)
        .populate('reply_to')
        .lean(),
      ChatMessage.countDocuments({ token: (token as string).toLowerCase() })
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    // Format response
    const formattedMessages = messages.map(msg => ({
      id: msg._id.toString(),
      user: msg.user,
      token: msg.token,
      message: msg.message,
      reply_to: msg.reply_to ? (typeof msg.reply_to === 'object' && msg.reply_to !== null && '_id' in msg.reply_to ? String((msg.reply_to as { _id: any })._id) : (typeof msg.reply_to === 'string' ? msg.reply_to : null)) : null,
      timestamp: msg.timestamp?.toISOString() || new Date().toISOString(),
      editedAt: msg.editedAt ? msg.editedAt.toISOString() : null
    }));

    res.json({
      data: formattedMessages,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching chat messages:', error);
    res.status(500).json({ error: 'Failed to fetch chat messages' });
  }
});

// PATCH /api/chat/message/:messageId - Edit a chat message (requires authentication)
router.patch('/message/:messageId',
  authenticateToken,
  [
    body('message').trim().isLength({ min: 1, max: 100 }).withMessage('Message must be between 1 and 100 characters')
  ],
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const errors = validationResult(req);
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
      let userAddress: string | undefined;
      const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
      if (primaryWalletAddress) {
        userAddress = primaryWalletAddress.toLowerCase();
      } else if (user.walletAddresses && user.walletAddresses.length > 0) {
        userAddress = user.walletAddresses[0].address.toLowerCase();
      } else if (user.email && user.email.includes('@wallet.local')) {
        userAddress = user.email.split('@')[0].toLowerCase();
      }

      if (!userAddress) {
        return res.status(400).json({ error: 'User address not found. Please connect a wallet.' });
      }

      // Find the message and verify ownership
      const chatMessage = await ChatMessage.findById(messageId);
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
      emitChatMessageEdited(formattedMessage);

      res.json(formattedMessage);
    } catch (error) {
      console.error('Error editing chat message:', error);
      res.status(500).json({ error: 'Failed to edit chat message' });
    }
  }
);

// DELETE /api/chat/message/:messageId - Delete a chat message (requires authentication)
router.delete('/message/:messageId',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<Response | void> => {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Unauthorized - User not found' });
      }

      const { messageId } = req.params;

      // Get user address from authenticated user
      let userAddress: string | undefined;
      const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
      if (primaryWalletAddress) {
        userAddress = primaryWalletAddress.toLowerCase();
      } else if (user.walletAddresses && user.walletAddresses.length > 0) {
        userAddress = user.walletAddresses[0].address.toLowerCase();
      } else if (user.email && user.email.includes('@wallet.local')) {
        userAddress = user.email.split('@')[0].toLowerCase();
      }

      if (!userAddress) {
        return res.status(400).json({ error: 'User address not found. Please connect a wallet.' });
      }

      // Find the message and verify ownership
      const chatMessage = await ChatMessage.findById(messageId);
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
      await ChatMessage.findByIdAndDelete(messageId);

      const formattedMessage = {
        id: messageId,
        token: token
      };

      // Emit deleted message via WebSocket
      emitChatMessageDeleted(formattedMessage);

      res.json({ success: true, messageId });
    } catch (error) {
      console.error('Error deleting chat message:', error);
      res.status(500).json({ error: 'Failed to delete chat message' });
    }
  }
);

export default router;
