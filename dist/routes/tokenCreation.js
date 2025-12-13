"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const Token_1 = __importDefault(require("../models/Token"));
const TokenHolder_1 = __importDefault(require("../models/TokenHolder"));
const ethers_1 = require("ethers");
const blockchain_1 = require("../config/blockchain");
const handler_1 = require("../sync/handler");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const router = express_1.default.Router();
/**
 * POST /api/tokens/create-with-embedded-wallet
 * Create a token using the user's embedded wallet
 * This endpoint signs and sends the transaction on behalf of the user
 */
router.post('/create-with-embedded-wallet', auth_1.authenticateToken, async (req, res) => {
    try {
        // req.user is the full User document from mongoose (set by authenticateToken middleware)
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { name, symbol, description, uri, initialPurchaseAmount, paymentToken, chainId } = req.body;
        // Validate required fields (initialPurchaseAmount is optional)
        if (!name || !symbol || !description || !uri || !chainId) {
            return res.status(400).json({ error: 'Missing required fields: name, symbol, description, uri, or chainId' });
        }
        // Convert initialPurchaseAmount to BigInt (it comes as string from frontend, can be 0 or undefined)
        let purchaseAmount = 0n;
        if (initialPurchaseAmount !== undefined && initialPurchaseAmount !== null && initialPurchaseAmount !== '') {
            try {
                purchaseAmount = BigInt(initialPurchaseAmount);
                if (purchaseAmount < 0n) {
                    return res.status(400).json({ error: 'Initial purchase amount cannot be negative' });
                }
            }
            catch (error) {
                return res.status(400).json({ error: 'Invalid initial purchase amount format' });
            }
        }
        // User is already loaded by authenticateToken middleware (req.user is the full User document)
        // No need to fetch user again from database
        // Find embedded wallet
        // First try to find wallet marked as smart wallet
        let embeddedWallet = user.walletAddresses.find((w) => w.isSmartWallet === true);
        // Fallback: If no wallet is marked as smart wallet, check if user has a primary wallet
        // This handles users who logged in before we added the isSmartWallet field
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (!embeddedWallet && primaryWalletAddress) {
            embeddedWallet = user.walletAddresses.find((w) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase());
            // If found, mark it as smart wallet for future use
            if (embeddedWallet && !embeddedWallet.isSmartWallet) {
                embeddedWallet.isSmartWallet = true;
                await user.save();
            }
        }
        if (!embeddedWallet) {
            return res.status(400).json({
                error: 'No embedded wallet found. Please create a token using a connected wallet instead.',
                debug: {
                    hasWallets: user.walletAddresses.length > 0,
                    walletCount: user.walletAddresses.length,
                    primaryWallet: primaryWalletAddress,
                    walletAddresses: user.walletAddresses.map((w) => ({
                        address: w.address,
                        isSmartWallet: w.isSmartWallet,
                        isPrimary: w.isPrimary
                    }))
                }
            });
        }
        // Get factory address for chain
        const chainName = getChainName(chainId);
        console.log("chaindName:", chainName);
        const factoryAddress = process.env[`FACTORY_ADDRESS_${chainName}`] || process.env.TOKEN_FACTORY_ADDRESS;
        if (!factoryAddress) {
            return res.status(400).json({
                error: `Factory address not configured for chain ${chainId}`
            });
        }
        // Get RPC URL for chain
        const rpcUrl = getRpcUrl(chainId);
        if (!rpcUrl) {
            return res.status(400).json({
                error: `RPC URL not configured for chain ${chainId}`,
                chainId: chainId,
                suggestion: `Please set ${getRpcUrlEnvKey(chainId)} in your backend .env file`
            });
        }
        // Validate RPC URL doesn't contain placeholders
        if (rpcUrl.includes('YOUR_') || rpcUrl.includes('your_') || rpcUrl.includes('PLACEHOLDER') || rpcUrl.includes('example')) {
            return res.status(400).json({
                error: `Invalid RPC URL configuration for chain ${chainId}`,
                chainId: chainId,
                rpcUrl: rpcUrl.substring(0, 50) + '...',
                suggestion: `Please set a valid ${getRpcUrlEnvKey(chainId)} in your backend .env file. The URL contains a placeholder value.`
            });
        }
        // Generate deterministic private key for embedded wallet
        // This MUST match the logic in auth.ts exactly
        const userId = user._id.toString();
        const userEmail = user.email.toLowerCase().trim();
        const jwtSecret = process.env.JWT_SECRET || 'default-secret';
        // Use the exact same seed format as in auth.ts
        const seed = `${userId}-${userEmail}-${jwtSecret}`;
        const privateKey = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(seed));
        const wallet = new ethers_1.ethers.Wallet(privateKey);
        // Verify wallet address matches
        const generatedAddress = wallet.address.toLowerCase();
        const storedAddress = embeddedWallet.address.toLowerCase();
        if (generatedAddress !== storedAddress) {
            // If addresses don't match, it might be because the wallet was created with the old SHA256 method
            // Try to update the wallet address in the database to match the new keccak256 method
            console.warn('Wallet address mismatch - attempting to update stored address:', {
                generated: generatedAddress,
                stored: storedAddress,
                userId: userId,
                email: userEmail,
            });
            // Update the wallet address in the database to match the generated one
            const walletIndex = user.walletAddresses.findIndex((w) => w.address.toLowerCase() === storedAddress);
            if (walletIndex !== -1) {
                user.walletAddresses[walletIndex].address = generatedAddress;
                await user.save();
                console.log('✅ Updated wallet address in database to match generated address');
            }
            else {
                console.error('Could not find wallet to update in user.walletAddresses');
                return res.status(500).json({
                    error: 'Wallet address mismatch. Please contact support.',
                    debug: {
                        generatedAddress: generatedAddress,
                        storedAddress: storedAddress,
                        userId: userId,
                        email: userEmail,
                    }
                });
            }
        }
        // Connect to provider
        const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        const signer = wallet.connect(provider);
        // Load factory ABI
        const FactoryABI = require('../config/abi/TokenFactory.json');
        // Create contract instance
        const factory = new ethers_1.ethers.Contract(factoryAddress, FactoryABI, signer);
        // Check balance (skip getNetwork() to avoid timeouts - we already know chainId)
        const balance = await provider.getBalance(wallet.address);
        console.log('Wallet info:', {
            address: wallet.address,
            balance: ethers_1.ethers.formatEther(balance),
            purchaseAmount: ethers_1.ethers.formatEther(purchaseAmount),
            chainId: chainId.toString(),
            factoryAddress: factoryAddress,
            rpcUrl: rpcUrl.substring(0, 30) + '...',
        });
        // Chain ID verification removed - provider is already created with correct chainId
        // No need to verify via getNetwork() which causes timeouts
        // Check if we have enough for gas fees (add 20% buffer)
        const estimatedGasPrice = await provider.getFeeData();
        const gasPrice = estimatedGasPrice.gasPrice || 0n;
        const estimatedGasLimit = 500000n; // Estimated gas for createToken
        const gasCost = gasPrice * estimatedGasLimit;
        const totalRequired = purchaseAmount + gasCost;
        // Only check balance if purchase amount is greater than 0
        if (purchaseAmount > 0n && balance < purchaseAmount) {
            return res.status(400).json({
                error: `Insufficient balance for purchase. Required: ${ethers_1.ethers.formatEther(purchaseAmount)} ETH, Available: ${ethers_1.ethers.formatEther(balance)} ETH`,
                balance: ethers_1.ethers.formatEther(balance),
                required: ethers_1.ethers.formatEther(purchaseAmount),
                address: wallet.address,
                message: `Your embedded wallet address is ${wallet.address}. Please send ETH to this address to create tokens.`,
                explorerUrl: `https://sepolia.basescan.org/address/${wallet.address}`,
            });
        }
        // Always check if we have enough for gas fees
        if (balance < totalRequired) {
            return res.status(400).json({
                error: `Insufficient balance for gas fees. Required: ${ethers_1.ethers.formatEther(totalRequired)} ETH (${ethers_1.ethers.formatEther(purchaseAmount)} for purchase + ${ethers_1.ethers.formatEther(gasCost)} for gas), Available: ${ethers_1.ethers.formatEther(balance)} ETH`,
                balance: ethers_1.ethers.formatEther(balance),
                purchaseAmount: purchaseAmount > 0n ? ethers_1.ethers.formatEther(purchaseAmount) : '0',
                estimatedGas: ethers_1.ethers.formatEther(gasCost),
                totalRequired: ethers_1.ethers.formatEther(totalRequired),
                address: wallet.address,
                message: purchaseAmount > 0n
                    ? `Your embedded wallet address is ${wallet.address}. Please send ETH to this address to create tokens.`
                    : `Your embedded wallet address is ${wallet.address}. Please send ETH to this address to cover gas fees.`,
            });
        }
        let txHash;
        let receipt;
        console.log("Creating token with purchase amount:", purchaseAmount.toString(), "Factory:", factoryAddress);
        try {
            if (paymentToken === 'ETH' || !paymentToken) {
                // Get current nonce
                const nonce = await provider.getTransactionCount(wallet.address, 'pending');
                console.log('Transaction details:', {
                    from: wallet.address,
                    to: factoryAddress,
                    value: ethers_1.ethers.formatEther(purchaseAmount),
                    purchaseAmount: purchaseAmount.toString(),
                    nonce: nonce,
                });
                // Create token with ETH
                const tx = await factory.createToken(name, symbol, description, uri, 0n, // graduationEth = 0 uses default
                {
                    value: purchaseAmount,
                    gasLimit: 2000000n, // Set explicit gas limit
                });
                console.log('Transaction sent:', tx.hash);
                txHash = tx.hash;
                // Wait for confirmation with timeout
                receipt = await tx.wait();
            }
            else {
                // For token payments, we'd need to handle approval first
                // This is more complex and would require the token contract ABI
                return res.status(400).json({
                    error: 'Token payments not yet supported for embedded wallets. Please use ETH.'
                });
            }
            // Extract token address and reserves from event
            let tokenAddress;
            let virtualEthReserves;
            let virtualTokenReserves;
            let totalSupply;
            let graduationEth;
            for (const log of receipt.logs) {
                try {
                    const decoded = factory.interface.parseLog(log);
                    if (decoded && decoded.name === 'TokenCreated') {
                        // Try named access first (ethers.js v6), fall back to indexed access
                        if (decoded.args.tokenAddress) {
                            tokenAddress = decoded.args.tokenAddress;
                            virtualEthReserves = ethers_1.ethers.toBigInt(decoded.args.virtualEthReserves || decoded.args[7] || 0n);
                            virtualTokenReserves = ethers_1.ethers.toBigInt(decoded.args.virtualTokenReserves || decoded.args[8] || 0n);
                            totalSupply = ethers_1.ethers.toBigInt(decoded.args.totalSupply || decoded.args[6] || 0n);
                            graduationEth = ethers_1.ethers.toBigInt(decoded.args.graduationEth || decoded.args[9] || 0n);
                        }
                        else if (decoded.args[0]) {
                            // Fallback to indexed access
                            tokenAddress = decoded.args[0];
                            virtualEthReserves = ethers_1.ethers.toBigInt(decoded.args[7] || 0n);
                            virtualTokenReserves = ethers_1.ethers.toBigInt(decoded.args[8] || 0n);
                            totalSupply = ethers_1.ethers.toBigInt(decoded.args[6] || 0n);
                            graduationEth = ethers_1.ethers.toBigInt(decoded.args[9] || 0n);
                        }
                        break;
                    }
                }
                catch (e) {
                    // Not the event we're looking for
                }
            }
            if (!tokenAddress) {
                return res.status(500).json({
                    error: 'Token created but address could not be extracted',
                    txHash
                });
            }
            // Calculate initial price and market cap immediately
            let initialPrice = '0';
            let marketCap = '0';
            if (virtualEthReserves && virtualTokenReserves && virtualTokenReserves > 0n) {
                try {
                    // Calculate price: (virtualEthReserves * 1e18) / virtualTokenReserves
                    initialPrice = ethers_1.ethers.formatUnits((virtualEthReserves * 10n ** 18n) / virtualTokenReserves, 18);
                    // Calculate market cap if totalSupply is available
                    if (totalSupply && totalSupply > 0n && initialPrice !== '0') {
                        const priceInWei = ethers_1.ethers.parseUnits(initialPrice, 18);
                        marketCap = ((totalSupply * priceInWei) / (10n ** 18n)).toString();
                    }
                }
                catch (err) {
                    console.warn('⚠️ Could not calculate initial price/market cap:', err);
                }
            }
            // Update token in database with price and market cap immediately
            let token;
            try {
                token = await Token_1.default.findOne({
                    address: tokenAddress.toLowerCase(),
                    chainId: chainId
                });
                if (token) {
                    // Token exists - update it with price and market cap
                    token.currentPrice = initialPrice;
                    token.marketCap = marketCap;
                    if (totalSupply) {
                        token.totalSupply = totalSupply.toString();
                    }
                    if (graduationEth) {
                        token.graduationEth = graduationEth.toString();
                    }
                    await token.save();
                    console.log(`✅ Token price and market cap set immediately: ${tokenAddress}`);
                }
                else {
                    // Token doesn't exist yet - create it with price/market cap
                    token = await Token_1.default.create({
                        address: tokenAddress.toLowerCase(),
                        name: name,
                        symbol: symbol,
                        creatorAddress: wallet.address.toLowerCase(),
                        chainId: chainId,
                        logo: uri || '/chats/noimg.svg',
                        description: description || '',
                        totalSupply: totalSupply?.toString() || '0',
                        graduationEth: graduationEth?.toString() || '0',
                        graduationProgress: '0',
                        currentPrice: initialPrice,
                        marketCap: marketCap,
                        isActive: true,
                    });
                    console.log(`✅ Token created with price and market cap: ${tokenAddress}`);
                }
            }
            catch (dbError) {
                // Don't fail the request if DB update fails - WebSocket event will handle it
                console.warn('⚠️ Could not update token in database immediately:', dbError.message);
            }
            // ✅ CREATE HOLDER SYNCHRONOUSLY BEFORE SENDING RESPONSE
            // This ensures holder exists when frontend redirects
            if (token) {
                try {
                    const bondingCurveAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId)?.toLowerCase();
                    const tokenTotalSupply = token.totalSupply || '0';
                    if (bondingCurveAddress && tokenTotalSupply && tokenTotalSupply !== '0') {
                        // Check if holder already exists
                        const existingHolder = await TokenHolder_1.default.findOne({
                            tokenId: token._id,
                            holderAddress: bondingCurveAddress,
                            chainId: chainId
                        });
                        if (!existingHolder) {
                            await TokenHolder_1.default.create({
                                tokenId: token._id,
                                tokenAddress: tokenAddress.toLowerCase(),
                                holderAddress: bondingCurveAddress,
                                balance: tokenTotalSupply,
                                firstTransactionHash: '',
                                lastTransactionHash: '',
                                transactionCount: 0,
                                chainId: chainId
                            });
                            console.log(`✅ Initial bonding curve holder created via API: ${bondingCurveAddress}`);
                            // Recalculate percentages
                            await (0, handler_1.recalculatePercentages)(tokenAddress.toLowerCase(), tokenTotalSupply, chainId);
                        }
                    }
                }
                catch (holderError) {
                    // Log but don't fail - WebSocket event handler will create it as fallback
                    console.warn('⚠️ Could not create holder synchronously (will be created by event handler):', holderError.message);
                }
            }
            // NOW send response - all database updates are complete
            res.json({
                success: true,
                tokenAddress,
                txHash,
                creator: wallet.address,
                name,
                symbol,
            });
        }
        catch (error) {
            console.error('Error creating token:', error);
            // Provide more specific error messages
            let errorMessage = 'Failed to create token';
            let errorDetails = { message: error.message };
            if (error.code === -32603 || error.message?.includes('failed to send tx')) {
                errorMessage = 'Transaction was rejected by the network';
                errorDetails = {
                    message: 'The transaction could not be sent. Common causes:',
                    possibleCauses: [
                        'Insufficient balance in embedded wallet',
                        'Network congestion',
                        'Invalid transaction parameters',
                        'RPC provider issue'
                    ],
                    walletAddress: wallet.address,
                    balance: balance ? ethers_1.ethers.formatEther(balance) : 'unknown',
                    required: purchaseAmount > 0n ? ethers_1.ethers.formatEther(purchaseAmount + gasCost) : ethers_1.ethers.formatEther(gasCost),
                    suggestion: 'Please ensure your embedded wallet has sufficient ETH balance to cover the token purchase and gas fees.'
                };
            }
            else if (error.code === 'INSUFFICIENT_FUNDS' || error.message?.includes('insufficient funds')) {
                errorMessage = 'Insufficient balance';
                errorDetails = {
                    walletAddress: wallet.address,
                    balance: ethers_1.ethers.formatEther(balance),
                    required: purchaseAmount > 0n ? ethers_1.ethers.formatEther(purchaseAmount + gasCost) : ethers_1.ethers.formatEther(gasCost),
                };
            }
            else if (error.code === 'NONCE_EXPIRED' || error.message?.includes('nonce')) {
                errorMessage = 'Transaction nonce error';
                errorDetails = {
                    message: 'Please try again in a few seconds',
                };
            }
            return res.status(500).json({
                error: errorMessage,
                details: errorDetails,
                originalError: error.message,
            });
        }
    }
    catch (error) {
        console.error('Error in create-with-embedded-wallet:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
});
// Helper function to get chain name
function getChainName(chainId) {
    const names = {
        1: 'ETHEREUM',
        8453: 'BASE',
        42161: 'ARBITRUM',
        84532: 'BASE_SEPOLIA',
    };
    return names[chainId] || '';
}
// Helper function to get RPC URL for chain
function getRpcUrl(chainId) {
    const urls = {
        1: process.env.ETHEREUM_RPC_URL,
        8453: process.env.BASE_RPC_URL || process.env.BASE_SEPOLIA_RPC_URL,
        42161: process.env.ARBITRUM_RPC_URL,
        84532: process.env.BASE_SEPOLIA_RPC_URL,
    };
    const url = urls[chainId];
    // Return undefined if URL is empty or just whitespace
    return url?.trim() || undefined;
}
// Helper function to get environment variable key for RPC URL
function getRpcUrlEnvKey(chainId) {
    const keys = {
        1: 'ETHEREUM_RPC_URL',
        8453: 'BASE_RPC_URL or BASE_SEPOLIA_RPC_URL',
        42161: 'ARBITRUM_RPC_URL',
        84532: 'BASE_SEPOLIA_RPC_URL',
    };
    return keys[chainId] || 'RPC_URL';
}
/**
 * POST /api/tokens/buy-with-embedded-wallet
 * Buy tokens using the user's embedded wallet
 */
router.post('/buy-with-embedded-wallet', auth_1.authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { tokenAddress, ethAmount, chainId } = req.body;
        if (!tokenAddress || !ethAmount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields: tokenAddress, ethAmount, chainId' });
        }
        let purchaseAmount;
        try {
            purchaseAmount = BigInt(ethAmount);
            if (purchaseAmount <= 0n) {
                return res.status(400).json({ error: 'ETH amount must be greater than 0' });
            }
        }
        catch (error) {
            return res.status(400).json({ error: 'Invalid ETH amount format' });
        }
        // Find embedded wallet
        let embeddedWallet = user.walletAddresses.find((w) => w.isSmartWallet === true);
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (!embeddedWallet && primaryWalletAddress) {
            embeddedWallet = user.walletAddresses.find((w) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase());
            if (embeddedWallet && !embeddedWallet.isSmartWallet) {
                embeddedWallet.isSmartWallet = true;
                await user.save();
            }
        }
        if (!embeddedWallet) {
            return res.status(400).json({
                error: 'No embedded wallet found. Please connect a wallet to buy tokens.'
            });
        }
        // Get factory address and RPC URL
        const chainName = getChainName(chainId);
        const factoryAddress = process.env[`FACTORY_ADDRESS_${chainName}`] || process.env.TOKEN_FACTORY_ADDRESS;
        if (!factoryAddress) {
            return res.status(400).json({ error: `Factory address not configured for chain ${chainId}` });
        }
        const rpcUrl = getRpcUrl(chainId);
        if (!rpcUrl) {
            return res.status(400).json({ error: `RPC URL not configured for chain ${chainId}` });
        }
        // Generate wallet from user credentials
        const userId = user._id.toString();
        const userEmail = user.email.toLowerCase().trim();
        const jwtSecret = process.env.JWT_SECRET || 'default-secret';
        const seed = `${userId}-${userEmail}-${jwtSecret}`;
        const privateKey = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(seed));
        const wallet = new ethers_1.ethers.Wallet(privateKey);
        // Verify wallet address matches
        if (wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
            embeddedWallet.address = wallet.address.toLowerCase();
            await user.save();
        }
        // Connect to provider
        const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        const signer = wallet.connect(provider);
        // Load factory ABI
        const FactoryABI = require('../config/abi/TokenFactory.json');
        const factory = new ethers_1.ethers.Contract(factoryAddress, FactoryABI, signer);
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        const estimatedGasPrice = await provider.getFeeData();
        const gasPrice = estimatedGasPrice.gasPrice || 0n;
        const estimatedGasLimit = 300000n; // Estimated gas for buyTokens
        const gasCost = gasPrice * estimatedGasLimit;
        const totalRequired = purchaseAmount + gasCost;
        if (balance < totalRequired) {
            return res.status(400).json({
                error: `Insufficient balance. Required: ${ethers_1.ethers.formatEther(totalRequired)} ETH, Available: ${ethers_1.ethers.formatEther(balance)} ETH`,
                balance: ethers_1.ethers.formatEther(balance),
                required: ethers_1.ethers.formatEther(totalRequired),
                address: wallet.address,
            });
        }
        // Execute buy transaction
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        const tx = await factory.buyTokens(tokenAddress, {
            value: purchaseAmount,
            gasLimit: 300000n,
            nonce: nonce,
        });
        const receipt = await tx.wait();
        res.json({
            success: true,
            txHash: tx.hash,
            receipt: {
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
            },
        });
    }
    catch (error) {
        console.error('Error buying tokens with embedded wallet:', error);
        res.status(500).json({
            error: error.message || 'Failed to buy tokens',
            details: error.reason || error.code,
        });
    }
});
/**
 * POST /api/tokens/sell-with-embedded-wallet
 * Sell tokens using the user's embedded wallet
 */
router.post('/sell-with-embedded-wallet', auth_1.authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { tokenAddress, tokenAmount, chainId } = req.body;
        if (!tokenAddress || !tokenAmount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields: tokenAddress, tokenAmount, chainId' });
        }
        let sellAmount;
        try {
            sellAmount = BigInt(tokenAmount);
            if (sellAmount <= 0n) {
                return res.status(400).json({ error: 'Token amount must be greater than 0' });
            }
        }
        catch (error) {
            return res.status(400).json({ error: 'Invalid token amount format' });
        }
        // Find embedded wallet
        let embeddedWallet = user.walletAddresses.find((w) => w.isSmartWallet === true);
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (!embeddedWallet && primaryWalletAddress) {
            embeddedWallet = user.walletAddresses.find((w) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase());
            if (embeddedWallet && !embeddedWallet.isSmartWallet) {
                embeddedWallet.isSmartWallet = true;
                await user.save();
            }
        }
        if (!embeddedWallet) {
            return res.status(400).json({
                error: 'No embedded wallet found. Please connect a wallet to sell tokens.'
            });
        }
        // Get factory address and RPC URL
        const chainName = getChainName(chainId);
        const factoryAddress = process.env[`FACTORY_ADDRESS_${chainName}`] || process.env.TOKEN_FACTORY_ADDRESS;
        if (!factoryAddress) {
            return res.status(400).json({ error: `Factory address not configured for chain ${chainId}` });
        }
        const rpcUrl = getRpcUrl(chainId);
        if (!rpcUrl) {
            return res.status(400).json({ error: `RPC URL not configured for chain ${chainId}` });
        }
        // Generate wallet from user credentials
        const userId = user._id.toString();
        const userEmail = user.email.toLowerCase().trim();
        const jwtSecret = process.env.JWT_SECRET || 'default-secret';
        const seed = `${userId}-${userEmail}-${jwtSecret}`;
        const privateKey = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(seed));
        const wallet = new ethers_1.ethers.Wallet(privateKey);
        // Verify wallet address matches
        if (wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
            embeddedWallet.address = wallet.address.toLowerCase();
            await user.save();
        }
        // Connect to provider
        const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
        const signer = wallet.connect(provider);
        // Load factory and token ABIs
        const FactoryABI = require('../config/abi/TokenFactory.json');
        const TokenABI = require('../config/abi/Token.json');
        const factory = new ethers_1.ethers.Contract(factoryAddress, FactoryABI, signer);
        const token = new ethers_1.ethers.Contract(tokenAddress, TokenABI, signer);
        // Check token balance
        const tokenBalance = await token.balanceOf(wallet.address);
        if (tokenBalance < sellAmount) {
            return res.status(400).json({
                error: `Insufficient token balance. Required: ${ethers_1.ethers.formatEther(sellAmount)}, Available: ${ethers_1.ethers.formatEther(tokenBalance)}`,
                balance: ethers_1.ethers.formatEther(tokenBalance),
                required: ethers_1.ethers.formatEther(sellAmount),
            });
        }
        // Check allowance
        const allowance = await token.allowance(wallet.address, factoryAddress);
        if (allowance < sellAmount) {
            // Approve first
            const approveTx = await token.approve(factoryAddress, ethers_1.ethers.MaxUint256);
            await approveTx.wait();
        }
        // Execute sell transaction
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        const tx = await factory.sellTokens(tokenAddress, sellAmount, {
            gasLimit: 300000n,
            nonce: nonce,
        });
        const receipt = await tx.wait();
        res.json({
            success: true,
            txHash: tx.hash,
            receipt: {
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
            },
        });
    }
    catch (error) {
        console.error('Error selling tokens with embedded wallet:', error);
        res.status(500).json({
            error: error.message || 'Failed to sell tokens',
            details: error.reason || error.code,
        });
    }
});
exports.default = router;
//# sourceMappingURL=tokenCreation.js.map