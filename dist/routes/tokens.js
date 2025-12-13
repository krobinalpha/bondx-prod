"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const ethers_1 = require("ethers");
const Token_1 = __importDefault(require("../models/Token"));
const TokenHolder_1 = __importDefault(require("../models/TokenHolder"));
const Transaction_1 = __importDefault(require("../models/Transaction"));
const auth_1 = require("../middleware/auth");
const validation_1 = require("../middleware/validation");
const blockchain_1 = require("../config/blockchain");
const handler_1 = require("../sync/handler");
const Token_json_1 = __importDefault(require("../config/abi/Token.json"));
const router = express_1.default.Router();
// GET /api/tokens - Get all tokens with pagination
router.get('/', [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('sortBy').optional().isIn(['createdAt', 'currentPriceUSD', 'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent']).withMessage('Invalid sort field'),
    (0, express_validator_1.query)('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
    (0, express_validator_1.query)('verified').optional().isBoolean().withMessage('Verified must be true or false'),
    (0, express_validator_1.query)('active').optional().isBoolean().withMessage('Active must be true or false'),
    (0, express_validator_1.query)('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
    (0, express_validator_1.query)('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
    (0, express_validator_1.query)('minMarketCap').optional().isFloat({ min: 0 }).withMessage('Min market cap must be a positive number'),
    (0, express_validator_1.query)('maxMarketCap').optional().isFloat({ min: 0 }).withMessage('Max market cap must be a positive number'),
    (0, express_validator_1.query)('timeRange').optional().isIn(['1h', '24h', '7d', '30d', 'all']).withMessage('Invalid time range'),
    (0, express_validator_1.query)('startDate').optional().isISO8601().withMessage('Start date must be a valid ISO 8601 date'),
    (0, express_validator_1.query)('endDate').optional().isISO8601().withMessage('End date must be a valid ISO 8601 date')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc', chainId, verified, active, search, minPrice, maxPrice, minMarketCap, maxMarketCap, timeRange, startDate, endDate } = req.query;
        // Build filter object
        const filter = {};
        const exprConditions = [];
        if (chainId) {
            filter.chainId = parseInt(chainId);
        }
        if (verified !== undefined)
            filter.isVerified = verified === 'true';
        if (active !== undefined)
            filter.isActive = active === 'true';
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
                exprConditions.push({ $gte: [{ $toDouble: '$currentPrice' }, parseFloat(minPrice)] });
            }
            if (maxPrice) {
                exprConditions.push({ $lte: [{ $toDouble: '$currentPrice' }, parseFloat(maxPrice)] });
            }
        }
        // Market cap range filter (marketCap is stored as string in wei format)
        if (minMarketCap || maxMarketCap) {
            const minWei = minMarketCap ? parseFloat(minMarketCap) * 1e18 : null;
            const maxWei = maxMarketCap ? parseFloat(maxMarketCap) * 1e18 : null;
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
            let startTime;
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
            if (!filter.createdAt)
                filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.createdAt.$lte = new Date(endDate);
            }
        }
        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        // Execute query with pagination
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        const [tokens, totalCount] = await Promise.all([
            Token_1.default.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('liquidityEventsCount')
                .populate('transactionsCount')
                .populate('holdersCount'),
            Token_1.default.countDocuments(filter)
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            tokens: [],
            data: tokens,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching tokens:', error);
        res.status(500).json({ error: 'Failed to fetch tokens' });
    }
});
// GET /api/tokens/by-creator/:address - Get tokens created by a specific address
router.get('/by-creator/:address', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid creator address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('sortBy').optional().isIn(['createdAt', 'currentPriceUSD', 'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent']).withMessage('Invalid sort field'),
    (0, express_validator_1.query)('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { page = 1, pageSize = 20, sortBy = 'createdAt', sortOrder = 'desc', chainId } = req.query;
        // Build filter object - filter by creator address
        const filter = {
            creatorAddress: address.toLowerCase() // Case-insensitive match
        };
        // Optional chainId filter
        if (chainId) {
            filter.chainId = parseInt(chainId);
        }
        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
        // Execute query with pagination
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const limit = parseInt(pageSize);
        const [tokens, totalCount] = await Promise.all([
            Token_1.default.find(filter)
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .populate('liquidityEventsCount')
                .populate('transactionsCount')
                .populate('holdersCount'),
            Token_1.default.countDocuments(filter)
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        res.json({
            tokens: [],
            data: tokens,
            totalCount,
            currentPage: parseInt(page),
            totalPages,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
        });
    }
    catch (error) {
        console.error('Error fetching tokens by creator:', error);
        res.status(500).json({ error: 'Failed to fetch tokens by creator' });
    }
});
// GET /api/tokens/trending - Get trending tokens
router.get('/trending', [
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
    (0, express_validator_1.query)('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be a positive number'),
    (0, express_validator_1.query)('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be a positive number'),
    (0, express_validator_1.query)('minMarketCap').optional().isFloat({ min: 0 }).withMessage('Min market cap must be a positive number'),
    (0, express_validator_1.query)('maxMarketCap').optional().isFloat({ min: 0 }).withMessage('Max market cap must be a positive number'),
    (0, express_validator_1.query)('timeRange').optional().isIn(['1h', '24h', '7d', '30d', 'all']).withMessage('Invalid time range')
], async (req, res) => {
    try {
        const { limit = 10, chainId, minPrice, maxPrice, minMarketCap, maxMarketCap, timeRange } = req.query;
        // Build filter object
        const filter = { isActive: true };
        const exprConditions = [];
        if (chainId)
            filter.chainId = parseInt(chainId);
        // Price range filter (currentPrice is stored as decimal string)
        if (minPrice || maxPrice) {
            if (minPrice) {
                exprConditions.push({ $gte: [{ $toDouble: '$currentPrice' }, parseFloat(minPrice)] });
            }
            if (maxPrice) {
                exprConditions.push({ $lte: [{ $toDouble: '$currentPrice' }, parseFloat(maxPrice)] });
            }
        }
        // Market cap range filter (marketCap is stored as string in wei format)
        if (minMarketCap || maxMarketCap) {
            const minWei = minMarketCap ? parseFloat(minMarketCap) * 1e18 : null;
            const maxWei = maxMarketCap ? parseFloat(maxMarketCap) * 1e18 : null;
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
            let startTime;
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
        const tokens = await Token_1.default.find(filter)
            .sort({ volume24hUSD: -1, priceChange24hPercent: -1 })
            .limit(parseInt(limit))
            .populate('liquidityEventsCount')
            .populate('transactionsCount');
        res.json({ data: tokens });
    }
    catch (error) {
        console.error('Error fetching trending tokens:', error);
        res.status(500).json({ error: 'Failed to fetch trending tokens' });
    }
});
// GET /api/tokens/address/:address/info-and-transactions - Get token by address
router.get('/address/:address/info-and-transactions', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { transactionPage = 1, transactionPageSize = 10, chainId } = req.query;
        console.log(`[Token Route] Fetching token: ${address}, chainId: ${chainId}`);
        // Build token query with chainId if provided
        const tokenQuery = { address: address.toLowerCase() };
        if (chainId) {
            tokenQuery.chainId = parseInt(chainId);
        }
        console.log(`[Token Route] Query:`, tokenQuery);
        const token = await Token_1.default.findOne(tokenQuery)
            .populate('liquidityEventsCount')
            .populate('transactionsCount')
            .populate('holdersCount')
            .lean(); // Use lean() to get plain JavaScript object
        if (!token) {
            console.log(`[Token Route] Token not found for address: ${address}, chainId: ${chainId}`);
            return res.status(404).json({
                error: 'Token not found',
                address: address.toLowerCase(),
                chainId: chainId ? parseInt(chainId) : 'not specified',
                query: tokenQuery
            });
        }
        const skip = (parseInt(transactionPage) - 1) * parseInt(transactionPageSize);
        const limit = parseInt(transactionPageSize);
        // Build transaction query with chainId
        const transactionQuery = {
            tokenAddress: address.toLowerCase(),
            chainId: token.chainId // Use token's chainId
        };
        const transactions = await Transaction_1.default.find(transactionQuery)
            .sort({ blockTimestamp: -1 })
            .skip(skip)
            .limit(limit);
        const totalTransactions = await Transaction_1.default.countDocuments(transactionQuery);
        res.json({
            data: {
                token,
                transactions: {
                    data: transactions,
                    pagination: {
                        page: parseInt(transactionPage),
                        pageSize: limit,
                        total: totalTransactions,
                        totalPages: Math.ceil(totalTransactions / limit)
                    }
                }
            }
        });
    }
    catch (error) {
        console.error('Error fetching token:', error);
        res.status(500).json({ error: 'Failed to fetch token' });
    }
});
// PATCH /api/tokens/updateToken - Update token information (upsert - creates if doesn't exist)
router.patch('/updateToken', [
    auth_1.authenticateToken,
    (0, express_validator_1.body)('address').custom(validation_1.validateAddress).withMessage('Invalid token address')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address, data, chainId } = req.body;
        const normalizedAddress = address.toLowerCase();
        // Try to find existing token with chainId if provided
        const tokenQuery = { address: normalizedAddress };
        if (chainId) {
            tokenQuery.chainId = parseInt(chainId);
        }
        else if (data?.chainId) {
            tokenQuery.chainId = parseInt(data.chainId);
        }
        let token = await Token_1.default.findOne(tokenQuery);
        if (!token) {
            // Token doesn't exist yet - create it with basic info from data
            // This handles the case where frontend calls updateToken before backend event listener processes it
            console.log(`Token ${normalizedAddress} not found, creating new token record...`);
            // Validate required fields
            if (!data.name || !data.symbol || !data.creatorAddress) {
                return res.status(400).json({
                    error: 'Token not found and missing required fields (name, symbol, creatorAddress) to create it'
                });
            }
            // Create new token with provided data
            token = await Token_1.default.create({
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
            console.log(`Created new token record: ${normalizedAddress}`);
            // ✅ CREATE HOLDER SYNCHRONOUSLY BEFORE SENDING RESPONSE
            // This ensures holder exists when frontend redirects
            try {
                const bondingCurveAddress = (0, blockchain_1.getFactoryAddressForChain)(token.chainId)?.toLowerCase();
                const totalSupply = token.totalSupply || '0';
                if (bondingCurveAddress && totalSupply && totalSupply !== '0') {
                    // Check if holder already exists
                    const existingHolder = await TokenHolder_1.default.findOne({
                        tokenId: token._id,
                        holderAddress: bondingCurveAddress,
                        chainId: token.chainId
                    });
                    if (!existingHolder) {
                        await TokenHolder_1.default.create({
                            tokenId: token._id,
                            tokenAddress: normalizedAddress,
                            holderAddress: bondingCurveAddress,
                            balance: totalSupply,
                            firstTransactionHash: '',
                            lastTransactionHash: '',
                            transactionCount: 0,
                            chainId: token.chainId
                        });
                        console.log(`✅ Initial bonding curve holder created via updateToken API: ${bondingCurveAddress}`);
                        // Recalculate percentages
                        await (0, handler_1.recalculatePercentages)(normalizedAddress, totalSupply, token.chainId);
                    }
                }
            }
            catch (holderError) {
                // Log but don't fail - WebSocket event handler will create it as fallback
                console.warn('⚠️ Could not create holder via updateToken API (will be created by event handler):', holderError.message);
            }
        }
        else {
            // Token exists - update it with new data
            // Only update fields that are provided and not undefined
            Object.keys(data).forEach(key => {
                if (data[key] !== undefined && data[key] !== null) {
                    token[key] = data[key];
                }
            });
            // Ensure addresses are lowercase
            if (data.creatorAddress) {
                token.creatorAddress = data.creatorAddress.toLowerCase();
            }
            await token.save();
            console.log(`Updated existing token: ${normalizedAddress}`);
        }
        res.json({ data: token });
    }
    catch (error) {
        console.error('Error updating token:', error);
        // Handle duplicate key error (race condition)
        if (error.code === 11000) {
            // Token was created by another process, try to fetch and update it
            try {
                const { address, data, chainId } = req.body;
                const tokenQuery = { address: address.toLowerCase() };
                if (chainId) {
                    tokenQuery.chainId = parseInt(chainId);
                }
                else if (data?.chainId) {
                    tokenQuery.chainId = parseInt(data.chainId);
                }
                const token = await Token_1.default.findOne(tokenQuery);
                if (token) {
                    Object.assign(token, req.body.data);
                    await token.save();
                    return res.json({ data: token });
                }
            }
            catch (retryError) {
                console.error('Error retrying token update:', retryError);
            }
        }
        res.status(500).json({ error: 'Failed to update token', details: error.message });
    }
});
// GET /api/tokens/:address/graduation-progress - Get graduation progress from database (with contract fallback)
router.get('/address/:address/graduation-progress', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { chainId } = req.query;
        const targetChainId = chainId ? parseInt(chainId) : parseInt(process.env.CHAIN_ID || '84532');
        // Try to get from database first (much faster)
        const token = await Token_1.default.findOne({
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
            factoryContract = (0, blockchain_1.getContract)(targetChainId);
        }
        catch (error) {
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
        }
        catch (contractError) {
            console.error('Error reading graduation progress from contract:', contractError);
            res.status(500).json({
                error: 'Failed to read graduation progress from contract',
                details: contractError.message
            });
        }
    }
    catch (error) {
        console.error('Error fetching graduation progress:', error);
        res.status(500).json({ error: 'Failed to fetch graduation progress' });
    }
});
// GET /api/tokens/:address/calc-buy-return - Calculate token amount for ETH amount
router.get('/address/:address/calc-buy-return', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('ethAmount').isString().withMessage('ETH amount is required'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { ethAmount, chainId } = req.query;
        const targetChainId = chainId ? parseInt(chainId) : parseInt(process.env.CHAIN_ID || '84532');
        let factoryContract;
        try {
            factoryContract = (0, blockchain_1.getContract)(targetChainId);
        }
        catch (error) {
            return res.status(500).json({
                error: `Factory address or RPC URL not configured for chain ${targetChainId}`,
                details: error.message
            });
        }
        try {
            const ethAmountWei = ethers_1.ethers.parseUnits(ethAmount, 18);
            const tokenAmount = await factoryContract.calculateTokenAmount(address, ethAmountWei);
            res.json({
                ethAmount: ethAmount,
                tokenAmount: tokenAmount.toString(),
                tokenAmountFormatted: ethers_1.ethers.formatUnits(tokenAmount, 18)
            });
        }
        catch (contractError) {
            console.error('Error calculating buy return:', contractError);
            res.status(500).json({
                error: 'Failed to calculate buy return',
                details: contractError.message
            });
        }
    }
    catch (error) {
        console.error('Error calculating buy return:', error);
        res.status(500).json({ error: 'Failed to calculate buy return' });
    }
});
// GET /api/tokens/:address/calc-sell-return - Calculate ETH amount for token amount
router.get('/address/:address/calc-sell-return', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('tokenAmount').isString().withMessage('Token amount is required'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address } = req.params;
        const { tokenAmount, chainId } = req.query;
        const targetChainId = chainId ? parseInt(chainId) : parseInt(process.env.CHAIN_ID || '84532');
        let factoryContract;
        try {
            factoryContract = (0, blockchain_1.getContract)(targetChainId);
        }
        catch (error) {
            return res.status(500).json({
                error: `Factory address or RPC URL not configured for chain ${targetChainId}`,
                details: error.message
            });
        }
        try {
            const tokenAmountWei = ethers_1.ethers.parseUnits(tokenAmount, 18);
            const ethAmount = await factoryContract.calculateEthAmount(address, tokenAmountWei);
            res.json({
                tokenAmount: tokenAmount,
                ethAmount: ethAmount.toString(),
                ethAmountFormatted: ethers_1.ethers.formatUnits(ethAmount, 18)
            });
        }
        catch (contractError) {
            console.error('Error calculating sell return:', contractError);
            res.status(500).json({
                error: 'Failed to calculate sell return',
                details: contractError.message
            });
        }
    }
    catch (error) {
        console.error('Error calculating sell return:', error);
        res.status(500).json({ error: 'Failed to calculate sell return' });
    }
});
// GET /api/tokens/:address/user-balance - Get user's ETH and token balance
router.get('/address/:address/user-balance', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('userAddress').custom(validation_1.validateAddress).withMessage('Invalid user address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address: tokenAddress } = req.params;
        const { userAddress, chainId } = req.query;
        const targetChainId = chainId ? parseInt(chainId) : parseInt(process.env.CHAIN_ID || '84532');
        try {
            // Check if token exists in database first
            const token = await Token_1.default.findOne({
                address: tokenAddress.toLowerCase(),
                chainId: targetChainId
            });
            // Get provider for this chain
            const chainProvider = (0, blockchain_1.getProvider)(targetChainId);
            // Get ETH balance
            const ethBalance = await chainProvider.getBalance(userAddress);
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
                        console.warn(`⚠️ No contract found at address ${tokenAddress} on chain ${targetChainId}${token ? ' (token exists in DB)' : ''}`);
                    }
                }
                else {
                    // Contract exists, try to call balanceOf
                    const tokenContract = new ethers_1.ethers.Contract(tokenAddress, Token_json_1.default, chainProvider);
                    tokenBalance = await tokenContract.balanceOf(userAddress);
                    tokenBalanceFormatted = ethers_1.ethers.formatUnits(tokenBalance, 18);
                }
            }
            catch (balanceError) {
                // If balanceOf fails, return 0 balance
                // Only log error if token exists in DB (unexpected failure)
                if (token) {
                    console.warn(`⚠️ Failed to get token balance for ${tokenAddress}:`, balanceError.message);
                }
                tokenBalance = 0n;
                tokenBalanceFormatted = '0';
            }
            res.json({
                ethBalance: ethBalance.toString(),
                ethBalanceFormatted: ethers_1.ethers.formatUnits(ethBalance, 18),
                tokenBalance: tokenBalance.toString(),
                tokenBalanceFormatted: tokenBalanceFormatted
            });
        }
        catch (contractError) {
            console.error('Error reading balances from contract:', contractError);
            res.status(500).json({
                error: 'Failed to read balances from contract',
                details: contractError.message
            });
        }
    }
    catch (error) {
        console.error('Error fetching user balance:', error);
        res.status(500).json({ error: 'Failed to fetch user balance' });
    }
});
// GET /api/tokens/:address/token-allowance - Get token allowance
router.get('/address/:address/token-allowance', [
    (0, express_validator_1.param)('address').custom(validation_1.validateAddress).withMessage('Invalid token address'),
    (0, express_validator_1.query)('owner').custom(validation_1.validateAddress).withMessage('Invalid owner address'),
    (0, express_validator_1.query)('spender').custom(validation_1.validateAddress).withMessage('Invalid spender address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { address: tokenAddress } = req.params;
        const { owner, spender, chainId } = req.query;
        const targetChainId = chainId ? parseInt(chainId) : parseInt(process.env.CHAIN_ID || '84532');
        try {
            // Get provider for this chain
            const chainProvider = (0, blockchain_1.getProvider)(targetChainId);
            const tokenContract = new ethers_1.ethers.Contract(tokenAddress, Token_json_1.default, chainProvider);
            const allowance = await tokenContract.allowance(owner, spender);
            res.json({
                allowance: allowance.toString(),
                allowanceFormatted: ethers_1.ethers.formatUnits(allowance, 18)
            });
        }
        catch (contractError) {
            console.error('Error reading allowance from contract:', contractError);
            res.status(500).json({
                error: 'Failed to read allowance from contract',
                details: contractError.message
            });
        }
    }
    catch (error) {
        console.error('Error fetching token allowance:', error);
        res.status(500).json({ error: 'Failed to fetch token allowance' });
    }
});
exports.default = router;
//# sourceMappingURL=tokens.js.map