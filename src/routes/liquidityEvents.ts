import express, { Request, Response } from 'express';
import { query, validationResult } from 'express-validator';
import LiquidityEvent from '../models/LiquidityEvent';
import Token from '../models/Token';
import { validateAddress } from '../middleware/validation';

const router = express.Router();

// GET /api/liquidity-events - Get liquidity events for a token
router.get('/', [
  query('tokenAddress').custom(validateAddress).withMessage('Invalid token address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tokenAddress, page = 1, pageSize = 20, chainId } = req.query;

    // Build query
    const query: any = { 
      tokenAddress: (tokenAddress as string).toLowerCase()
    };
    if (chainId) {
      query.chainId = parseInt(chainId as string);
    } else {
      // If no chainId provided, try to get it from token
      const token = await Token.findOne({ address: (tokenAddress as string).toLowerCase() });
      if (token) {
        query.chainId = token.chainId;
      }
    }

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    const [events, totalCount] = await Promise.all([
      LiquidityEvent.find(query)
        .sort({ blockTimestamp: -1 })
        .skip(skip)
        .limit(limit)
        .populate('tokenId', 'name symbol')
        .lean(),
      LiquidityEvent.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      data: events,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching liquidity events:', error);
    res.status(500).json({ error: 'Failed to fetch liquidity events' });
  }
});

export default router;


