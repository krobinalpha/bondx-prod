import express, { Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import Transaction from '../models/Transaction';
import { validateAddress } from '../middleware/validation';

const router = express.Router();

// GET /api/transactions/token/:tokenAddress - Get transactions for a token
router.get('/token/:tokenAddress', [
  param('tokenAddress').custom(validateAddress).withMessage('Invalid token address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tokenAddress } = req.params;
    const { page = 1, pageSize = 10, chainId } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    // Build query with chainId if provided
    const query: any = { 
      tokenAddress: tokenAddress.toLowerCase()
    };
    if (chainId) {
      query.chainId = parseInt(chainId as string);
    }

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(query)
        .sort({ blockTimestamp: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      transactions: transactions,
      data: transactions,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching token transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// GET /api/transactions/address/:address - Get transactions for an address
router.get('/address/:address', [
  param('address').custom(validateAddress).withMessage('Invalid address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const { page = 1, pageSize = 10, chainId } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    // Build query - find transactions where address is sender or recipient
    const query: any = {
      $or: [
        { senderAddress: address.toLowerCase() },
        { recipientAddress: address.toLowerCase() }
      ]
    };
    if (chainId) {
      query.chainId = parseInt(chainId as string);
    }

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(query)
        .sort({ blockTimestamp: -1 })
        .skip(skip)
        .limit(limit),
      Transaction.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      transactions: transactions,
      data: transactions,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching address transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export default router;
