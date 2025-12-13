import express, { Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import TokenHistory from '../models/TokenHistory';
import Token from '../models/Token';
import { validateAddress } from '../middleware/validation';

const router = express.Router();

// GET /api/histories/token/:tokenAddress - Get price history for a token
router.get('/token/:tokenAddress', [
  param('tokenAddress').custom(validateAddress).withMessage('Invalid token address'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tokenAddress } = req.params;
    const { chainId, limit = 100 } = req.query;

    // Build query
    const query: any = { 
      tokenAddress: tokenAddress.toLowerCase()
    };
    if (chainId) {
      query.chainId = parseInt(chainId as string);
    } else {
      // If no chainId provided, try to get it from token
      const token = await Token.findOne({ address: tokenAddress.toLowerCase() });
      if (token) {
        query.chainId = token.chainId;
      }
    }

    const histories = await TokenHistory.find(query)
      .sort({ timestamp: 1 }) // Ascending order (oldest to newest) for proper chart display
      .limit(parseInt(limit as string))
      .select('tokenPrice timestamp blockNumber')
      .lean();

    // Format response to match frontend expectations - return just price
    const formattedHistories = histories.map(history => ({
      price: history.tokenPrice || '0',
      timestamp: history.timestamp?.toISOString() || new Date().toISOString(),
      blockNumber: history.blockNumber || 0
    }));

    res.json({
      data: formattedHistories
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

export default router;
