import express, { Request, Response } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { ethers } from 'ethers';
import Token from '../models/Token';
import TokenHolder from '../models/TokenHolder';
import Transaction from '../models/Transaction';
import { authenticateToken } from '../middleware/auth';
import { validateAddress } from '../middleware/validation';
import { AuthRequest } from '../types';
import { getContract, getProvider, getFactoryAddressForChain } from '../config/blockchain';
import { recalculatePercentages } from '../sync/handler';
import TokenABI from '../config/abi/Token.json';

const router = express.Router();

// GET /api/tokens - Get all tokens with pagination
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('sortBy').optional().isIn(['createdAt', 'currentPriceUSD', 'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
  query('verified').optional().isBoolean().withMessage('Verified must be true or false'),
  query('active').optional().isBoolean().withMessage('Active must be true or false'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
  query('minMarketCap').optional().isFloat({ min: 0 }).withMessage('Min market cap must be a positive number'),
  query('maxMarketCap').optional().isFloat({ min: 0 }).withMessage('Max market cap must be a positive number'),
  query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', 'all']).withMessage('Invalid time range'),
  query('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate').optional().isISO8601().withMessage('End date must be a valid ISO 8601 date')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      chainId,
      verified,
      active,
      search,
      minPrice,
      maxPrice,
      minMarketCap,
      maxMarketCap,
      timeRange,
      startDate,
      endDate
    } = req.query;

    // Build filter object
    const filter: any = {};
    const exprConditions: any[] = [];
    
    if (chainId) {
      filter.chainId = parseInt(chainId as string);
    }
    if (verified !== undefined) filter.isVerified = verified === 'true';
    if (active !== undefined) filter.isActive = active === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { symbol: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Price range filter (currentPrice is stored as decimal string like "0.000008")
    // Use $expr for numeric comparison since we're comparing string fields as numbers
    if (minPrice || maxPrice) {
      if (minPrice) {
        exprConditions.push({ $gte: [{ $toDouble: '$currentPrice' }, parseFloat(minPrice as string)] });
      }
      if (maxPrice) {
        exprConditions.push({ $lte: [{ $toDouble: '$currentPrice' }, parseFloat(maxPrice as string)] });
      }
    }

    // Market cap range filter (marketCap is stored as string in wei format)
    if (minMarketCap || maxMarketCap) {
      const minWei = minMarketCap ? parseFloat(minMarketCap as string) * 1e18 : null;
      const maxWei = maxMarketCap ? parseFloat(maxMarketCap as string) * 1e18 : null;
      
      if (minWei !== null) {
        exprConditions.push({ $gte: [{ $toDouble: '$marketCap' }, minWei] });
      }
      if (maxWei !== null) {
        exprConditions.push({ $lte: [{ $toDouble: '$marketCap' }, maxWei] });
      }
    }

    // Add $expr if we have any numeric conditions
    if (exprConditions.length > 0) {
      filter.$expr = { $and: exprConditions };
    }

    // Time-based filter
    if (timeRange && timeRange !== 'all') {
      const now = new Date();
      let startTime: Date;
      
      switch (timeRange) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(0); // All time
      }
      filter.createdAt = { $gte: startTime };
    }

    // Custom date range filter
    if (startDate || endDate) {
      if (!filter.createdAt) filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate as string);
      }
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    const [tokens, totalCount] = await Promise.all([
      Token.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('liquidityEventsCount')
        .populate('transactionsCount')
        .populate('holdersCount')
        .lean(), // Use lean() for better performance (returns plain JS objects)
      Token.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      tokens: [],
      data: tokens,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching tokens:', error);
    res.status(500).json({ error: 'Failed to fetch tokens' });
  }
});

// GET /api/tokens/by-creator/:address - Get tokens created by a specific address
router.get('/by-creator/:address', [
  param('address').custom(validateAddress).withMessage('Invalid creator address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('sortBy').optional().isIn(['createdAt', 'currentPriceUSD', 'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const {
      page = 1,
      pageSize = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      chainId
    } = req.query;

    // Build filter object - filter by creator address
    const filter: any = {
      creatorAddress: address.toLowerCase() // Case-insensitive match
    };

    // Optional chainId filter
    if (chainId) {
      filter.chainId = parseInt(chainId as string);
    }

    // Build sort object
    const sort: any = {};
    sort[sortBy as string] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with pagination
    const skip = (parseInt(page as string) - 1) * parseInt(pageSize as string);
    const limit = parseInt(pageSize as string);

    const [tokens, totalCount] = await Promise.all([
      Token.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate('liquidityEventsCount')
        .populate('transactionsCount')
        .populate('holdersCount')
        .lean(), // Use lean() for better performance (returns plain JS objects)
      Token.countDocuments(filter)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      tokens: [],
      data: tokens,
      totalCount,
      currentPage: parseInt(page as string),
      totalPages,
      hasNextPage: parseInt(page as string) < totalPages,
      hasPrevPage: parseInt(page as string) > 1
    });
  } catch (error) {
    console.error('Error fetching tokens by creator:', error);
    res.status(500).json({ error: 'Failed to fetch tokens by creator' });
  }
});

// GET /api/tokens/trending - Get trending tokens
router.get('/trending', [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
  query('minMarketCap').optional().isFloat({ min: 0 }).withMessage('Min market cap must be a positive number'),
  query('maxMarketCap').optional().isFloat({ min: 0 }).withMessage('Max market cap must be a positive number'),
  query('timeRange').optional().isIn(['1h', '24h', '7d', '30d', 'all']).withMessage('Invalid time range')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { 
      limit = 10,
      chainId,
      minPrice,
      maxPrice,
      minMarketCap,
      maxMarketCap,
      timeRange
    } = req.query;
    
    // Build filter object
    const filter: any = { isActive: true };
    const exprConditions: any[] = [];
    
    if (chainId) filter.chainId = parseInt(chainId as string);
    
    // Price range filter (currentPrice is stored as decimal string)
    if (minPrice || maxPrice) {
      if (minPrice) {
        exprConditions.push({ $gte: [{ $toDouble: '$currentPrice' }, parseFloat(minPrice as string)] });
      }
      if (maxPrice) {
        exprConditions.push({ $lte: [{ $toDouble: '$currentPrice' }, parseFloat(maxPrice as string)] });
      }
    }

    // Market cap range filter (marketCap is stored as string in wei format)
    if (minMarketCap || maxMarketCap) {
      const minWei = minMarketCap ? parseFloat(minMarketCap as string) * 1e18 : null;
      const maxWei = maxMarketCap ? parseFloat(maxMarketCap as string) * 1e18 : null;
      
      if (minWei !== null) {
        exprConditions.push({ $gte: [{ $toDouble: '$marketCap' }, minWei] });
      }
      if (maxWei !== null) {
        exprConditions.push({ $lte: [{ $toDouble: '$marketCap' }, maxWei] });
      }
    }

    // Add $expr if we have any numeric conditions
    if (exprConditions.length > 0) {
      filter.$expr = { $and: exprConditions };
    }

    // Time-based filter
    if (timeRange && timeRange !== 'all') {
      const now = new Date();
      let startTime: Date;
      
      switch (timeRange) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(0);
      }
      filter.createdAt = { $gte: startTime };
    }
    
    const tokens = await Token.find(filter)
      .sort({ volume24hUSD: -1, priceChange24hPercent: -1 })
      .limit(parseInt(limit as string))
      .populate('liquidityEventsCount')
      .populate('transactionsCount')
      .lean(); // Use lean() for better performance (returns plain JS objects)

    res.json({ data: tokens });
  } catch (error) {
    console.error('Error fetching trending tokens:', error);
    res.status(500).json({ error: 'Failed to fetch trending tokens' });
  }
});

// GET /api/tokens/address/:address/info-and-transactions - Get token by address
router.get('/address/:address/info-and-transactions', [
  param('address').custom(validateAddress).withMessage('Invalid token address')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const { transactionPage = 1, transactionPageSize = 10, chainId } = req.query;
    
    
    // Build token query with chainId if provided
    const tokenQuery: any = { address: address.toLowerCase() };
    if (chainId) {
      tokenQuery.chainId = parseInt(chainId as string);
    }
    
    
    const token = await Token.findOne(tokenQuery)
      .populate('liquidityEventsCount')
      .populate('transactionsCount')
      .populate('holdersCount')
      .lean(); // Use lean() to get plain JavaScript object

    if (!token) {
      return res.status(404).json({ 
        error: 'Token not found',
        address: address.toLowerCase(),
        chainId: chainId ? parseInt(chainId as string) : 'not specified',
        query: tokenQuery
      });
    }

    const skip = (parseInt(transactionPage as string) - 1) * parseInt(transactionPageSize as string);
    const limit = parseInt(transactionPageSize as string);

    // Build transaction query with chainId
    const transactionQuery: any = { 
      tokenAddress: address.toLowerCase(),
      chainId: token.chainId // Use token's chainId
    };

    const transactions = await Transaction.find(transactionQuery)
      .sort({ blockTimestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean(); // Use lean() for better performance (returns plain JS objects)

    const totalTransactions = await Transaction.countDocuments(transactionQuery);

    res.json({
      data: {
        token,
        transactions: {
          data: transactions,
          pagination: {
            page: parseInt(transactionPage as string),
            pageSize: limit,
            total: totalTransactions,
            totalPages: Math.ceil(totalTransactions / limit)
          }
        }
      }
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: 'Failed to fetch token' });
  }
});

// PATCH /api/tokens/updateToken - Update token information (upsert - creates if doesn't exist)
router.patch('/updateToken', [
  authenticateToken,
  body('address').custom(validateAddress).withMessage('Invalid token address')
], async (req: AuthRequest, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address, data, chainId } = req.body;
    const normalizedAddress = address.toLowerCase();

    // Try to find existing token with chainId if provided
    const tokenQuery: any = { address: normalizedAddress };
    if (chainId) {
      tokenQuery.chainId = parseInt(chainId as string);
    } else if (data?.chainId) {
      tokenQuery.chainId = parseInt(data.chainId);
    }
    let token = await Token.findOne(tokenQuery);

    if (!token) {
      // Token doesn't exist yet - create it with basic info from data
      // This handles the case where frontend calls updateToken before backend event listener processes it
      
      // Validate required fields
      if (!data.name || !data.symbol || !data.creatorAddress) {
        return res.status(400).json({ 
          error: 'Token not found and missing required fields (name, symbol, creatorAddress) to create it' 
        });
      }

      // Create new token with provided data
      token = await Token.create({
        address: normalizedAddress,
        name: data.name,
        symbol: data.symbol,
        creatorAddress: data.creatorAddress.toLowerCase(),
        chainId: data.chainId || parseInt(process.env.CHAIN_ID || '1'),
        logo: data.logo || '/chats/noimg.svg',
        description: data.description || '',
        website: data.website || '',
        telegram: data.telegram || '',
        discord: data.discord || '',
        twitter: data.twitter || '',
        youtube: data.youtube || '',
        isActive: true,
      });

      
      // ✅ CREATE HOLDER SYNCHRONOUSLY BEFORE SENDING RESPONSE
      // This ensures holder exists when frontend redirects
      try {
        const bondingCurveAddress = getFactoryAddressForChain(token.chainId)?.toLowerCase();
        const totalSupply = token.totalSupply || '0';
        
        if (bondingCurveAddress && totalSupply && totalSupply !== '0') {
          // Check if holder already exists
          const existingHolder = await TokenHolder.findOne({
            tokenId: token._id,
            holderAddress: bondingCurveAddress,
            chainId: token.chainId
          });
          
          if (!existingHolder) {
            await TokenHolder.create({
              tokenId: token._id,
              tokenAddress: normalizedAddress,
              holderAddress: bondingCurveAddress,
              balance: totalSupply,
              firstTransactionHash: '',
              lastTransactionHash: '',
              transactionCount: 0,
              chainId: token.chainId
            });
            
            // Recalculate percentages
            await recalculatePercentages(normalizedAddress, totalSupply, token.chainId);
          }
        }
      } catch (holderError: any) {
        // Log but don't fail - WebSocket event handler will create it as fallback
      }
    } else {
      // Token exists - update it with new data
      // Only update fields that are provided and not undefined
      Object.keys(data).forEach(key => {
        if (data[key] !== undefined && data[key] !== null) {
          (token as any)[key] = data[key];
        }
      });
      
      // Ensure addresses are lowercase
      if (data.creatorAddress) {
        token.creatorAddress = data.creatorAddress.toLowerCase();
      }
      
      await token.save();
    }

    res.json({ data: token });
  } catch (error: any) {
    console.error('Error updating token:', error);
    
    // Handle duplicate key error (race condition)
    if (error.code === 11000) {
      // Token was created by another process, try to fetch and update it
      try {
        const { address, data, chainId } = req.body;
        const tokenQuery: any = { address: address.toLowerCase() };
        if (chainId) {
          tokenQuery.chainId = parseInt(chainId as string);
        } else if (data?.chainId) {
          tokenQuery.chainId = parseInt(data.chainId);
        }
        const token = await Token.findOne(tokenQuery);
        if (token) {
          Object.assign(token, req.body.data);
          await token.save();
          return res.json({ data: token });
        }
      } catch (retryError) {
        console.error('Error retrying token update:', retryError);
      }
    }
    
    res.status(500).json({ error: 'Failed to update token', details: error.message });
  }
});

// GET /api/tokens/:address/graduation-progress - Get graduation progress from database (with contract fallback)
router.get('/address/:address/graduation-progress', [
  param('address').custom(validateAddress).withMessage('Invalid token address'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const { chainId } = req.query;
    const targetChainId = chainId ? parseInt(chainId as string) : parseInt(process.env.CHAIN_ID || '84532');

    // Try to get from database first (much faster)
    const token = await Token.findOne({
      address: address.toLowerCase(),
      chainId: targetChainId
    });

    if (token && token.graduationProgress !== undefined && token.graduationProgress !== null) {
      // Calculate percentage from stored value
      // graduationProgress is stored as: (realEthReserves * 1e18) / graduationEth
      const ratio = Number(token.graduationProgress) / Number(1e18);
      const percentage = ratio * 100;

      return res.json({
        graduationProgress: token.graduationProgress,
        percentage: Math.min(Math.max(percentage, 0), 100),
        ratio: ratio
      });
    }

    // Fallback to contract if database value is missing (for backward compatibility)
    let factoryContract;
    try {
      factoryContract = getContract(targetChainId);
    } catch (error: any) {
      return res.status(500).json({ 
        error: `Factory address or RPC URL not configured for chain ${targetChainId}`,
        details: error.message 
      });
    }

    try {
      const graduationProgress = await factoryContract.getGraduationProgress(address);
      
      // Contract returns: (realEthReserves * 1e18) / graduationEth
      // This is a ratio scaled by 1e18 (0 to 1e18 = 0% to 100%)
      const ratio = Number(graduationProgress) / Number(1e18);
      const percentage = ratio * 100;

      // Update database with the value from contract (for future requests)
      if (token) {
        token.graduationProgress = graduationProgress.toString();
        await token.save();
      }

      res.json({
        graduationProgress: graduationProgress.toString(),
        percentage: Math.min(Math.max(percentage, 0), 100),
        ratio: ratio
      });
    } catch (contractError: any) {
      console.error('Error reading graduation progress from contract:', contractError);
      res.status(500).json({ 
        error: 'Failed to read graduation progress from contract',
        details: contractError.message 
      });
    }
  } catch (error: any) {
    console.error('Error fetching graduation progress:', error);
    res.status(500).json({ error: 'Failed to fetch graduation progress' });
  }
});

// GET /api/tokens/:address/calc-buy-return - Calculate token amount for ETH amount
router.get('/address/:address/calc-buy-return', [
  param('address').custom(validateAddress).withMessage('Invalid token address'),
  query('ethAmount').isString().withMessage('ETH amount is required'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const { ethAmount, chainId } = req.query;
    const targetChainId = chainId ? parseInt(chainId as string) : parseInt(process.env.CHAIN_ID || '84532');

    let factoryContract;
    try {
      factoryContract = getContract(targetChainId);
    } catch (error: any) {
      return res.status(500).json({ 
        error: `Factory address or RPC URL not configured for chain ${targetChainId}`,
        details: error.message 
      });
    }

    try {
      const ethAmountWei = ethers.parseUnits(ethAmount as string, 18);
      const tokenAmount = await factoryContract.calculateTokenAmount(address, ethAmountWei);

      res.json({
        ethAmount: ethAmount,
        tokenAmount: tokenAmount.toString(),
        tokenAmountFormatted: ethers.formatUnits(tokenAmount, 18)
      });
    } catch (contractError: any) {
      console.error('Error calculating buy return:', contractError);
      res.status(500).json({ 
        error: 'Failed to calculate buy return',
        details: contractError.message 
      });
    }
  } catch (error: any) {
    console.error('Error calculating buy return:', error);
    res.status(500).json({ error: 'Failed to calculate buy return' });
  }
});

// GET /api/tokens/:address/calc-sell-return - Calculate ETH amount for token amount
router.get('/address/:address/calc-sell-return', [
  param('address').custom(validateAddress).withMessage('Invalid token address'),
  query('tokenAmount').isString().withMessage('Token amount is required'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address } = req.params;
    const { tokenAmount, chainId } = req.query;
    const targetChainId = chainId ? parseInt(chainId as string) : parseInt(process.env.CHAIN_ID || '84532');

    let factoryContract;
    try {
      factoryContract = getContract(targetChainId);
    } catch (error: any) {
      return res.status(500).json({ 
        error: `Factory address or RPC URL not configured for chain ${targetChainId}`,
        details: error.message 
      });
    }

    try {
      const tokenAmountWei = ethers.parseUnits(tokenAmount as string, 18);
      const ethAmount = await factoryContract.calculateEthAmount(address, tokenAmountWei);

      res.json({
        tokenAmount: tokenAmount,
        ethAmount: ethAmount.toString(),
        ethAmountFormatted: ethers.formatUnits(ethAmount, 18)
      });
    } catch (contractError: any) {
      console.error('Error calculating sell return:', contractError);
      res.status(500).json({ 
        error: 'Failed to calculate sell return',
        details: contractError.message 
      });
    }
  } catch (error: any) {
    console.error('Error calculating sell return:', error);
    res.status(500).json({ error: 'Failed to calculate sell return' });
  }
});

// GET /api/tokens/:address/user-balance - Get user's ETH and token balance
router.get('/address/:address/user-balance', [
  param('address').custom(validateAddress).withMessage('Invalid token address'),
  query('userAddress').custom(validateAddress).withMessage('Invalid user address'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { address: tokenAddress } = req.params;
    const { userAddress, chainId } = req.query;
    const targetChainId = chainId ? parseInt(chainId as string) : parseInt(process.env.CHAIN_ID || '84532');

    try {
      // Check if token exists in database first
      const token = await Token.findOne({ 
        address: tokenAddress.toLowerCase(),
        chainId: targetChainId 
      });

      // Get provider for this chain
      const chainProvider = getProvider(targetChainId);
      
      // Get ETH balance
      const ethBalance = await chainProvider.getBalance(userAddress as string);

      // Get token balance - with error handling for invalid contracts
      let tokenBalance = 0n;
      let tokenBalanceFormatted = '0';
      
      try {
        // Check if contract exists by trying to get code
        const code = await chainProvider.getCode(tokenAddress);
        if (code === '0x' || !code) {
          // Contract doesn't exist at this address
          // Only warn if token exists in DB (unexpected) or in development
          if (token || process.env.NODE_ENV === 'development') {
          }
        } else {
          // Contract exists, try to call balanceOf
          const tokenContract = new ethers.Contract(tokenAddress, TokenABI, chainProvider);
          tokenBalance = await tokenContract.balanceOf(userAddress as string);
          tokenBalanceFormatted = ethers.formatUnits(tokenBalance, 18);
        }
      } catch (balanceError: any) {
        // If balanceOf fails, return 0 balance
        // Only log error if token exists in DB (unexpected failure)
        if (token) {
        }
        tokenBalance = 0n;
        tokenBalanceFormatted = '0';
      }

      res.json({
        ethBalance: ethBalance.toString(),
        ethBalanceFormatted: ethers.formatUnits(ethBalance, 18),
        tokenBalance: tokenBalance.toString(),
        tokenBalanceFormatted: tokenBalanceFormatted
      });
    } catch (contractError: any) {
      console.error('Error reading balances from contract:', contractError);
      res.status(500).json({ 
        error: 'Failed to read balances from contract',
        details: contractError.message 
      });
    }
  } catch (error: any) {
    console.error('Error fetching user balance:', error);
    res.status(500).json({ error: 'Failed to fetch user balance' });
  }
});

export default router;

