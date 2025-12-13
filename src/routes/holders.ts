import express, { Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import TokenHolder from '../models/TokenHolder';
import Token from '../models/Token';
import { validateAddress } from '../middleware/validation';

const router = express.Router();

// GET /api/holders/token/:tokenAddress - Get token holders
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
    const { page = 1, pageSize = 25, chainId } = req.query;

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

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    const [holders, totalCount] = await Promise.all([
      TokenHolder.find(query)
        .sort({ balance: -1 })
        .skip(skip)
        .limit(limit)
        .select('holderAddress balance balanceUSD percentage')
        .lean(),
      TokenHolder.countDocuments(query)
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
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching token holders:', error);
    res.status(500).json({ error: 'Failed to fetch token holders' });
  }
});

// GET /api/holders/address/:holderAddress - Get tokens held by an address
router.get('/address/:holderAddress', [
  param('holderAddress').custom(validateAddress).withMessage('Invalid holder address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { holderAddress } = req.params;
    const { page = 1, pageSize = 100, chainId } = req.query;

    // Build query - only return tokens with balance > 0
    const query: any = { 
      holderAddress: holderAddress.toLowerCase(),
      balance: { $ne: '0' } // Only return tokens with balance > 0
    };
    if (chainId) {
      query.chainId = parseInt(chainId as string);
    }

    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    // Get holders with token information
    const holders = await TokenHolder.find(query)
      .populate('tokenId', 'name symbol address chainId logo')
      .sort({ balanceUSD: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Format response to match frontend expectations
    const tokens = holders
      .filter((holder: any) => holder.tokenId && holder.balance && BigInt(holder.balance) > 0n)
      .map((holder: any) => ({
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

    const totalCount = await TokenHolder.countDocuments(query);

    res.json({
      result: tokens,
      data: tokens,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages: Math.ceil(totalCount / limit),
      hasNextPage: parseInt(page as string) < Math.ceil(totalCount / limit),
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching tokens by holder address:', error);
    res.status(500).json({ error: 'Failed to fetch tokens by holder address' });
  }
});

export default router;
