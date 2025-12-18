"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveGraduationEvent = exports.syncBlockRange = exports.saveCreatedEvent = exports.saveTradeEvent = exports.recalculatePercentages = void 0;
const ethers_1 = require("ethers");
const Transaction_1 = __importDefault(require("../models/Transaction"));
const TokenHistory_1 = __importDefault(require("../models/TokenHistory"));
const Token_1 = __importDefault(require("../models/Token"));
const TokenHolder_1 = __importDefault(require("../models/TokenHolder"));
const LiquidityEvent_1 = __importDefault(require("../models/LiquidityEvent"));
const blockchain_1 = require("../config/blockchain");
const updateEmitter_1 = require("../socket/updateEmitter");
// Helper function to validate and normalize price
const validatePrice = (price, context = '') => {
    if (!price)
        return '0';
    const priceStr = String(price);
    const priceValue = parseFloat(priceStr);
    // Validate price is reasonable (should be < 1000 ETH per token)
    if (!isFinite(priceValue) || priceValue < 0 || priceValue > 1000) {
        console.error(`❌ Invalid price detected ${context}:`, {
            price: priceStr,
            priceValue,
        });
        return '0';
    }
    return priceStr;
};
// Helper function to update or create a holder record
const updateOrCreateHolder = async (tokenId, tokenAddress, holderAddress, balance, txHash, chainId, isFirstTransaction) => {
    try {
        const existingHolder = await TokenHolder_1.default.findOne({
            tokenId: tokenId,
            holderAddress: holderAddress.toLowerCase(),
            chainId: chainId
        });
        if (existingHolder) {
            // Update existing holder
            existingHolder.balance = balance;
            existingHolder.lastTransactionHash = txHash.toLowerCase();
            existingHolder.transactionCount = (existingHolder.transactionCount || 0) + 1;
            if (isFirstTransaction && !existingHolder.firstTransactionHash) {
                existingHolder.firstTransactionHash = txHash.toLowerCase();
            }
            await existingHolder.save();
            console.log(`✅ Holder updated: ${holderAddress} balance: ${balance}`);
        }
        else {
            // Create new holder
            await TokenHolder_1.default.create({
                tokenId: tokenId,
                tokenAddress: tokenAddress.toLowerCase(),
                holderAddress: holderAddress.toLowerCase(),
                balance: balance,
                firstTransactionHash: txHash.toLowerCase(),
                lastTransactionHash: txHash.toLowerCase(),
                transactionCount: 1,
                chainId: chainId
            });
            console.log(`✅ Holder created: ${holderAddress} balance: ${balance}`);
        }
    }
    catch (error) {
        console.error(`❌ Error updating/creating holder ${holderAddress}:`, error.message);
        throw error;
    }
};
// Helper function to recalculate percentages for all holders of a token
const recalculatePercentages = async (tokenAddress, totalSupply, chainId) => {
    try {
        if (!totalSupply || totalSupply === '0') {
            console.warn(`⚠️ Cannot recalculate percentages: totalSupply is 0 for ${tokenAddress}`);
            return;
        }
        const holders = await TokenHolder_1.default.find({
            tokenAddress: tokenAddress.toLowerCase(),
            chainId: chainId
        });
        const totalSupplyBigInt = BigInt(totalSupply);
        for (const holder of holders) {
            const balanceBigInt = BigInt(holder.balance || '0');
            // Calculate percentage: (balance / totalSupply) * 100
            const percentage = totalSupplyBigInt > 0n
                ? Number((balanceBigInt * 10000n) / totalSupplyBigInt) / 100 // Multiply by 10000 for precision, then divide by 100
                : 0;
            holder.percentage = Math.min(100, Math.max(0, percentage));
            // Update balanceUSD if we have token price
            // This will be updated elsewhere if price is available
            await holder.save();
        }
        console.log(`✅ Percentages recalculated for ${holders.length} holders of ${tokenAddress}`);
    }
    catch (error) {
        console.error(`❌ Error recalculating percentages for ${tokenAddress}:`, error.message);
    }
};
exports.recalculatePercentages = recalculatePercentages;
// Define your callback function for handling the events
const saveTradeEvent = async (eventData, priceData) => {
    try {
        const chainId = eventData.chainId || priceData?.chainId || parseInt(process.env.CHAIN_ID || '1');
        // Validate required fields
        if (!eventData.txHash) {
            console.error('❌ saveTradeEvent: txHash is missing in eventData:', eventData);
            return;
        }
        if (!eventData.tokenAddress) {
            console.error('❌ saveTradeEvent: tokenAddress is missing in eventData:', eventData);
            return;
        }
        // Check if the transaction already exists in the database by txHash + chainId
        const existingTx = await Transaction_1.default.findOne({
            txHash: (eventData.txHash || '').toLowerCase(),
            chainId: chainId
        });
        // Lookup token to get tokenId
        const token = await Token_1.default.findOne({
            address: eventData.tokenAddress?.toLowerCase(),
            chainId: chainId
        });
        if (!token) {
            console.warn(`Token not found for transaction: ${eventData.tokenAddress} on chain ${chainId}`);
            return;
        }
        // Update graduation progress if newEthReserves is available
        if (eventData.newEthReserves !== undefined && token.graduationEth && token.graduationEth !== '0') {
            try {
                const newEthReserves = BigInt(eventData.newEthReserves.toString());
                const graduationEth = BigInt(token.graduationEth);
                // Calculate: (realEthReserves * 1e18) / graduationEth
                // This gives a ratio scaled by 1e18 (0 to 1e18 = 0% to 100%)
                const graduationProgress = (newEthReserves * (10n ** 18n)) / graduationEth;
                token.graduationProgress = graduationProgress.toString();
                await token.save();
                console.log(`✅ Graduation progress updated: ${token.graduationProgress} for token ${token.address}`);
                // Check if token is ready to graduate and call graduateTokenManually
                // Only check if token is still active (not already graduated)
                if (newEthReserves >= graduationEth && token.isActive) {
                    console.log(`🎓 Token ${token.address} reached graduation threshold on chain ${chainId}! Calling graduateTokenManually...`);
                    console.log(`   realEthReserves: ${ethers_1.ethers.formatEther(newEthReserves)} ETH`);
                    console.log(`   graduationEth: ${ethers_1.ethers.formatEther(graduationEth)} ETH`);
                    // Call graduateTokenManually asynchronously (don't block the event processing)
                    graduateTokenManually(token.address, chainId).catch((error) => {
                        console.error(`❌ Error calling graduateTokenManually for ${token.address} on chain ${chainId}:`, error.message);
                    });
                }
            }
            catch (error) {
                console.error(`❌ Error updating graduation progress:`, error.message);
            }
        }
        // Save transaction if it doesn't exist
        if (!existingTx) {
            const transactionData = {
                ...eventData,
                txHash: eventData.txHash?.toLowerCase() || '',
                tokenId: token._id,
                tokenAddress: eventData.tokenAddress?.toLowerCase() || '',
                chainId: chainId,
                blockTimestamp: eventData.blockTimestamp || new Date(),
                tokenPrice: priceData?.tokenPrice ? String(priceData.tokenPrice) : '0', // Include tokenPrice from priceData
            };
            await Transaction_1.default.create(transactionData);
            console.log(`✅ Transaction saved:`, transactionData.txHash);
        }
        else if (priceData?.tokenPrice && (!existingTx.tokenPrice || existingTx.tokenPrice === '0')) {
            // Update existing transaction with tokenPrice if it's missing or zero
            existingTx.tokenPrice = String(priceData.tokenPrice);
            await existingTx.save();
            console.log(`✅ Transaction tokenPrice updated:`, existingTx.txHash);
        }
        // Save price history if it doesn't exist
        if (priceData) {
            const existingPrice = await TokenHistory_1.default.findOne({
                tokenAddress: priceData.tokenAddress?.toLowerCase(),
                chainId: chainId,
                timestamp: priceData.timestamp
            });
            if (!existingPrice) {
                const historyData = {
                    ...priceData,
                    tokenId: token._id,
                    tokenAddress: priceData.tokenAddress?.toLowerCase(),
                    tokenPrice: String(priceData.tokenPrice || '0'),
                    priceUSD: String(priceData.priceUSD || '0'),
                    chainId: chainId,
                };
                await TokenHistory_1.default.create(historyData);
                console.log('✅ Price history saved', historyData.tokenAddress);
                // Update Token's currentPrice with the validated price
                const validatedPrice = validatePrice(priceData.tokenPrice, 'in saveTradeEvent (new history)');
                if (validatedPrice !== '0') {
                    token.currentPrice = validatedPrice;
                }
                // Calculate and update marketCap if totalSupply is available
                // currentPrice is stored as decimal string (e.g., "0.000008"), need to convert to wei first
                if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
                    try {
                        const supply = BigInt(token.totalSupply);
                        // Convert decimal price string to wei (BigInt)
                        const priceInWei = ethers_1.ethers.parseUnits(token.currentPrice, 18);
                        // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
                        const marketCap = (supply * priceInWei) / (10n ** 18n);
                        token.marketCap = marketCap.toString();
                        console.log('✅ Token marketCap updated:', token.marketCap);
                    }
                    catch (err) {
                        console.warn('⚠️ Could not calculate marketCap:', err);
                    }
                }
                await token.save();
                console.log('✅ Token currentPrice updated:', token.currentPrice);
            }
            else {
                // Even if price history exists, update Token's currentPrice if it's newer
                if (priceData.tokenPrice) {
                    const validatedPrice = validatePrice(priceData.tokenPrice, 'in saveTradeEvent (existing history - trade)');
                    if (validatedPrice !== '0') {
                        token.currentPrice = validatedPrice;
                    }
                    // Calculate and update marketCap if totalSupply is available
                    // currentPrice is stored as decimal string (e.g., "0.000008"), need to convert to wei first
                    if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
                        try {
                            const supply = BigInt(token.totalSupply);
                            // Convert decimal price string to wei (BigInt)
                            const priceInWei = ethers_1.ethers.parseUnits(token.currentPrice, 18);
                            // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
                            const marketCap = (supply * priceInWei) / (10n ** 18n);
                            token.marketCap = marketCap.toString();
                            console.log('✅ Token marketCap updated (from existing history):', token.marketCap);
                        }
                        catch (err) {
                            console.warn('⚠️ Could not calculate marketCap:', err);
                        }
                    }
                    await token.save();
                    console.log('✅ Token currentPrice updated (from existing history):', token.currentPrice);
                }
            }
        }
        // Update holders based on trade type (MOVED COMPLETELY OUTSIDE of if (priceData) - runs for EVERY trade)
        try {
            const tokenAddress = priceData?.tokenAddress?.toLowerCase() || eventData.tokenAddress?.toLowerCase();
            const bondingCurveAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId)?.toLowerCase();
            if (eventData.type === 'Bought') {
                // Buyer receives tokens, bonding curve loses tokens
                const buyerAddress = eventData.recipientAddress?.toLowerCase();
                const tokenAmount = eventData.tokenAmount?.toString() || '0';
                // Get current buyer balance
                const buyerHolder = await TokenHolder_1.default.findOne({
                    tokenId: token._id,
                    holderAddress: buyerAddress,
                    chainId: chainId
                });
                const buyerCurrentBalance = BigInt(buyerHolder?.balance || '0');
                const buyerNewBalance = (buyerCurrentBalance + BigInt(tokenAmount)).toString();
                // Update buyer holder
                await updateOrCreateHolder(token._id, tokenAddress, buyerAddress, buyerNewBalance, eventData.txHash, chainId, !buyerHolder);
                // Update bonding curve holder (decrease balance)
                if (bondingCurveAddress) {
                    const bondingCurveHolder = await TokenHolder_1.default.findOne({
                        tokenId: token._id,
                        holderAddress: bondingCurveAddress,
                        chainId: chainId
                    });
                    if (bondingCurveHolder) {
                        const bondingCurveCurrentBalance = BigInt(bondingCurveHolder.balance || '0');
                        const bondingCurveNewBalance = (bondingCurveCurrentBalance - BigInt(tokenAmount)).toString();
                        if (BigInt(bondingCurveNewBalance) >= 0n) {
                            await updateOrCreateHolder(token._id, tokenAddress, bondingCurveAddress, bondingCurveNewBalance, eventData.txHash, chainId, false);
                        }
                    }
                    else {
                        console.warn(`⚠️ Bonding curve holder not found for ${tokenAddress}, skipping update`);
                    }
                }
                console.log(`✅ Holders updated for TokenBought: buyer ${buyerAddress} +${tokenAmount}`);
            }
            else if (eventData.type === 'Sold') {
                // Seller loses tokens, bonding curve gains tokens
                const sellerAddress = eventData.senderAddress?.toLowerCase();
                const tokenAmount = eventData.tokenAmount?.toString() || '0';
                // Get current seller balance
                const sellerHolder = await TokenHolder_1.default.findOne({
                    tokenId: token._id,
                    holderAddress: sellerAddress,
                    chainId: chainId
                });
                const sellerCurrentBalance = BigInt(sellerHolder?.balance || '0');
                const sellerNewBalance = (sellerCurrentBalance - BigInt(tokenAmount)).toString();
                // Update seller holder (remove if balance becomes 0)
                if (sellerNewBalance !== '0' && BigInt(sellerNewBalance) >= 0n) {
                    await updateOrCreateHolder(token._id, tokenAddress, sellerAddress, sellerNewBalance, eventData.txHash, chainId, false);
                }
                else if (sellerHolder) {
                    // Remove holder if balance becomes 0
                    await TokenHolder_1.default.deleteOne({
                        tokenId: token._id,
                        holderAddress: sellerAddress,
                        chainId: chainId
                    });
                    console.log(`✅ Holder removed (balance = 0): ${sellerAddress}`);
                }
                // Update bonding curve holder (increase balance)
                if (bondingCurveAddress) {
                    const bondingCurveHolder = await TokenHolder_1.default.findOne({
                        tokenId: token._id,
                        holderAddress: bondingCurveAddress,
                        chainId: chainId
                    });
                    const bondingCurveCurrentBalance = BigInt(bondingCurveHolder?.balance || '0');
                    const bondingCurveNewBalance = (bondingCurveCurrentBalance + BigInt(tokenAmount)).toString();
                    await updateOrCreateHolder(token._id, tokenAddress, bondingCurveAddress, bondingCurveNewBalance, eventData.txHash, chainId, !bondingCurveHolder);
                }
                console.log(`✅ Holders updated for TokenSold: seller ${sellerAddress} -${tokenAmount}`);
            }
            // Recalculate percentages for all holders
            await (0, exports.recalculatePercentages)(tokenAddress, token.totalSupply || '0', chainId);
        }
        catch (holderError) {
            console.error('❌ Error updating holders:', holderError.message);
            // Don't throw - continue even if holder update fails
        }
        // Fetch updated holders for WebSocket emission (moved outside if (priceData))
        let holders = [];
        try {
            holders = await TokenHolder_1.default.find({
                tokenAddress: (priceData?.tokenAddress || eventData.tokenAddress)?.toLowerCase(),
                chainId: chainId
            })
                .select('holderAddress balance balanceUSD percentage')
                .sort({ balance: -1 })
                .lean();
        }
        catch (err) {
            console.warn('⚠️ Could not fetch holders for WebSocket emission:', err);
        }
        // Transform holders to match frontend format
        const formattedHolders = (holders || []).map((holder) => ({
            owner_address: holder.holderAddress,
            balance: holder.balance,
            balanceUSD: holder.balanceUSD || '0',
            percentage: holder.percentage || 0
        }));
        // Emit WebSocket events (always emit, even if priceData is missing)
        const tokenAddress = priceData?.tokenAddress?.toLowerCase() || eventData.tokenAddress?.toLowerCase() || '';
        const tokenPrice = priceData?.tokenPrice || token.currentPrice || '0';
        // Emit price update if priceData exists
        if (priceData && priceData.tokenPrice) {
            (0, updateEmitter_1.emitTokenPriceUpdate)(tokenAddress, {
                price: String(tokenPrice),
                timestamp: priceData.timestamp || new Date(),
                chainId: chainId,
            });
        }
        // Always emit comprehensive event with transaction, holder, and token data
        // Ensure we have valid txHash before emitting
        if (!eventData.txHash) {
            console.error('❌ Cannot emit WebSocket event: txHash is missing', {
                eventData,
                tokenAddress,
            });
            return;
        }
        if (eventData.type === 'Bought') {
            console.log('🔍 Emitting tokenBought event:', {
                tokenAddress,
                txHash: eventData.txHash,
                buyer: eventData.recipientAddress,
            });
            (0, updateEmitter_1.emitTokenBought)({
                tokenAddress: tokenAddress,
                buyer: eventData.recipientAddress?.toLowerCase() || '',
                ethAmount: eventData.ethAmount?.toString() || '0',
                tokenAmount: eventData.tokenAmount?.toString() || '0',
                txHash: eventData.txHash,
                blockNumber: eventData.blockNumber || 0,
                blockTimestamp: eventData.blockTimestamp || new Date(),
                chainId: chainId,
                tokenPrice: tokenPrice,
                marketCap: token.marketCap || '0',
                graduationProgress: token.graduationProgress || '0',
                holders: formattedHolders,
            });
        }
        else if (eventData.type === 'Sold') {
            console.log('🔍 Emitting tokenSold event:', {
                tokenAddress,
                txHash: eventData.txHash,
                seller: eventData.senderAddress,
            });
            (0, updateEmitter_1.emitTokenSold)({
                tokenAddress: tokenAddress,
                seller: eventData.senderAddress?.toLowerCase() || '',
                ethAmount: eventData.ethAmount?.toString() || '0',
                tokenAmount: eventData.tokenAmount?.toString() || '0',
                txHash: eventData.txHash,
                blockNumber: eventData.blockNumber || 0,
                blockTimestamp: eventData.blockTimestamp || new Date(),
                chainId: chainId,
                tokenPrice: tokenPrice,
                marketCap: token.marketCap || '0',
                graduationProgress: token.graduationProgress || '0',
                holders: formattedHolders,
            });
        }
    }
    catch (error) {
        console.error('Error saving transaction:', error);
    }
};
exports.saveTradeEvent = saveTradeEvent;
// Define your callback function for handling the events
const saveCreatedEvent = async (eventData, priceData) => {
    try {
        const chainId = eventData?.chainId || priceData?.chainId || parseInt(process.env.CHAIN_ID || '1');
        // Check if the token already exists in the database (using address + chainId)
        const existingToken = await Token_1.default.findOne({
            address: eventData?.address?.toLowerCase(),
            chainId: chainId
        });
        let token;
        if (!existingToken) {
            // Ensure chainId is included (default to env CHAIN_ID or 1)
            const tokenData = {
                ...eventData,
                address: eventData?.address?.toLowerCase(),
                creatorAddress: eventData?.creatorAddress?.toLowerCase(),
                totalSupply: eventData?.totalSupply || '0', // Save totalSupply from event
                graduationEth: eventData?.graduationEth || '0', // Save graduationEth from event
                graduationProgress: '0', // Initial progress is 0 (no ETH reserves yet)
                chainId: chainId,
                logo: eventData?.logo || '/chats/noimg.svg',
                description: eventData?.description || '',
                isActive: true,
            };
            token = await Token_1.default.create(tokenData);
            console.log(`✅ Token saved from event:`, tokenData.address, `on chain ${chainId}`);
        }
        else {
            token = existingToken;
            // Update totalSupply if it's not set
            if (!token.totalSupply && eventData?.totalSupply) {
                token.totalSupply = eventData.totalSupply;
            }
            // Update graduationEth if it's not set
            if (!token.graduationEth && eventData?.graduationEth) {
                token.graduationEth = eventData.graduationEth;
            }
            // Update graduationProgress if it's not set (initial value is 0)
            if (!token.graduationProgress) {
                token.graduationProgress = '0';
            }
            if (token.isModified()) {
                await token.save();
            }
            console.log(`ℹ️ Token already exists:`, eventData?.address?.toLowerCase(), `on chain ${chainId}`);
        }
        // Update Token's currentPrice and marketCap (for display) but DON'T save to TokenHistory
        // Price history should only be saved on buy/sell events, not on token creation
        if (priceData && token) {
            // Validate price before updating token
            const tokenPrice = String(priceData.tokenPrice || '0');
            const validatedPrice = validatePrice(tokenPrice, 'in saveCreatedEvent (initial price)');
            if (validatedPrice !== '0') {
                token.currentPrice = validatedPrice;
                // Calculate and update marketCap if totalSupply is available
                if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
                    try {
                        const supply = BigInt(token.totalSupply);
                        // Convert decimal price string to wei (BigInt)
                        const priceInWei = ethers_1.ethers.parseUnits(token.currentPrice, 18);
                        // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
                        const marketCap = (supply * priceInWei) / (10n ** 18n);
                        token.marketCap = marketCap.toString();
                        console.log('✅ Token marketCap set on creation:', token.marketCap);
                    }
                    catch (err) {
                        console.warn('⚠️ Could not calculate marketCap on creation:', err);
                    }
                }
                await token.save();
                console.log('✅ Token currentPrice set on creation (no history saved):', token.currentPrice);
            }
            // Create initial holder record for bonding curve contract
            try {
                const tokenAddress = priceData.tokenAddress?.toLowerCase();
                const chainId = priceData.chainId || parseInt(process.env.CHAIN_ID || '1');
                const bondingCurveAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId)?.toLowerCase();
                const totalSupply = token.totalSupply || '0';
                if (bondingCurveAddress && totalSupply && totalSupply !== '0') {
                    // Check if holder already exists (might exist from previous sync)
                    const existingBondingCurveHolder = await TokenHolder_1.default.findOne({
                        tokenId: token._id,
                        holderAddress: bondingCurveAddress,
                        chainId: chainId
                    });
                    if (!existingBondingCurveHolder) {
                        // Create holder record for bonding curve with totalSupply
                        await TokenHolder_1.default.create({
                            tokenId: token._id,
                            tokenAddress: tokenAddress,
                            holderAddress: bondingCurveAddress,
                            balance: totalSupply,
                            firstTransactionHash: '', // Will be set on first trade
                            lastTransactionHash: '',
                            transactionCount: 0,
                            chainId: chainId
                        });
                        console.log(`✅ Initial bonding curve holder created: ${bondingCurveAddress} balance: ${totalSupply}`);
                    }
                    else {
                        // Update existing holder with totalSupply if it's higher
                        const existingBalance = BigInt(existingBondingCurveHolder.balance || '0');
                        const newBalance = BigInt(totalSupply);
                        if (newBalance > existingBalance) {
                            existingBondingCurveHolder.balance = totalSupply;
                            await existingBondingCurveHolder.save();
                            console.log(`✅ Bonding curve holder updated: ${bondingCurveAddress} balance: ${totalSupply}`);
                        }
                    }
                    // Recalculate percentages
                    await (0, exports.recalculatePercentages)(tokenAddress, totalSupply, chainId);
                }
            }
            catch (holderError) {
                console.error('❌ Error creating initial holder:', holderError.message);
                // Don't throw - continue with WebSocket emission even if holder creation fails
            }
            // Fetch holders for WebSocket emission
            let holders = [];
            try {
                holders = await TokenHolder_1.default.find({
                    tokenAddress: priceData.tokenAddress?.toLowerCase(),
                    chainId: chainId
                })
                    .select('holderAddress balance balanceUSD percentage')
                    .sort({ balance: -1 })
                    .lean();
            }
            catch (err) {
                console.warn('⚠️ Could not fetch holders for WebSocket emission:', err);
            }
            // Transform holders to match frontend format
            const formattedHolders = (holders || []).map((holder) => ({
                owner_address: holder.holderAddress,
                balance: holder.balance,
                balanceUSD: holder.balanceUSD || '0',
                percentage: holder.percentage || 0
            }));
            // Emit comprehensive tokenCreated event with token and holder data
            // NOTE: We don't emit priceUpdate here since no price history is saved on creation
            (0, updateEmitter_1.emitTokenCreated)({
                tokenAddress: priceData.tokenAddress?.toLowerCase() || '',
                creatorAddress: eventData?.creatorAddress?.toLowerCase() || '',
                name: eventData?.name || '',
                symbol: eventData?.symbol || '',
                description: eventData?.description || '',
                logo: eventData?.logo || '/chats/noimg.svg',
                totalSupply: token.totalSupply || '0',
                chainId: chainId,
                tokenPrice: validatedPrice || priceData.tokenPrice || '0',
                marketCap: token.marketCap || '0',
                holders: formattedHolders,
                timestamp: priceData.timestamp || new Date(),
            });
        }
    }
    catch (error) {
        console.error('Error saving token creation event:', error);
        // Don't throw - we want the system to continue even if one event fails
    }
};
exports.saveCreatedEvent = saveCreatedEvent;
const syncBlockRange = async (start, end, chainId) => {
    try {
        // Get chain-specific contract and provider
        const chainContract = (0, blockchain_1.getContract)(chainId);
        const chainProvider = (0, blockchain_1.getProvider)(chainId);
        const chainContractAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId);
        console.log(`🔄 Syncing blocks ${start} → ${end} for chain ${chainId}`);
        const createdEvents = await chainContract.queryFilter(chainContract.filters.TokenCreated(), start, end);
        const boughtEvents = await chainContract.queryFilter(chainContract.filters.TokenBought(), start, end);
        const soldEvents = await chainContract.queryFilter(chainContract.filters.TokenSold(), start, end);
        // Handle Created events
        if (createdEvents?.length > 0) {
            // Use the chainId parameter - we know it because we queried from that chain's contract
            for (const event of createdEvents) {
                // Type assertion: events from queryFilter have args property
                const decodedEvent = event;
                if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
                    console.warn('Event args not available, skipping');
                    continue;
                }
                const eventData = {
                    address: decodedEvent.args[0],
                    creatorAddress: decodedEvent.args[1],
                    name: decodedEvent.args[2],
                    symbol: decodedEvent.args[3],
                    description: decodedEvent.args[4] || '',
                    logo: decodedEvent.args[5] || '/chats/noimg.svg',
                    totalSupply: decodedEvent.args[6]?.toString() || '0', // args[6] = totalSupply
                    chainId: chainId,
                };
                const block = await chainProvider.getBlock(decodedEvent.blockNumber);
                const blockNumber = block?.number;
                const timestamp = block?.timestamp;
                // Fix: Use correct args indices for price calculation
                // args[7] = virtualEthReserves, args[8] = virtualTokenReserves
                const virtualEthReserves = ethers_1.ethers.toBigInt(decodedEvent.args[7]);
                const virtualTokenReserves = ethers_1.ethers.toBigInt(decodedEvent.args[8]);
                const priceData = {
                    tokenAddress: decodedEvent.args[0],
                    tokenPrice: virtualTokenReserves > 0n
                        ? ethers_1.ethers.formatUnits((virtualEthReserves * 10n ** 18n) / virtualTokenReserves, 18)
                        : '0',
                    blockNumber: blockNumber,
                    timestamp: timestamp ? new Date(Number(timestamp) * 1000) : new Date(),
                    chainId: chainId,
                };
                await (0, exports.saveCreatedEvent)(eventData, priceData);
            }
        }
        else {
            handleNoEventsFound(start, end);
        }
        // Handle Bought events
        if (boughtEvents.length > 0) {
            // Use the chainId parameter - we know it because we queried from that chain's contract
            for (const event of boughtEvents) {
                // Type assertion: events from queryFilter have args property
                const decodedEvent = event;
                if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
                    console.warn('Event args not available, skipping');
                    continue;
                }
                const block = await chainProvider.getBlock(decodedEvent.blockNumber);
                const blockNumber = block?.number;
                const timestamp = block?.timestamp ? new Date(Number(block.timestamp) * 1000) : new Date();
                // Calculate price: (newVirtualEthReserves * 1e18) / newVirtualTokenReserves
                // args[6] = newVirtualEthReserves, args[7] = newVirtualTokenReserves
                const virtualEthReserves = ethers_1.ethers.toBigInt(decodedEvent.args[6]);
                const virtualTokenReserves = ethers_1.ethers.toBigInt(decodedEvent.args[7]);
                let tokenPrice = '0';
                if (virtualTokenReserves > 0n && virtualEthReserves > 0n) {
                    const priceInWei = (virtualEthReserves * 10n ** 18n) / virtualTokenReserves;
                    tokenPrice = ethers_1.ethers.formatUnits(priceInWei, 18);
                    // Validate price is reasonable (should be < 1000 ETH per token)
                    const priceValue = parseFloat(tokenPrice);
                    if (!isFinite(priceValue) || priceValue < 0 || priceValue > 1000) {
                        console.error('❌ Invalid price calculated in syncBlockRange (Bought):', {
                            price: tokenPrice,
                            priceValue,
                            virtualEthReserves: virtualEthReserves.toString(),
                            virtualTokenReserves: virtualTokenReserves.toString(),
                            tokenAddress: decodedEvent.args[0],
                        });
                        tokenPrice = '0'; // Skip invalid price
                    }
                }
                const eventData = {
                    txHash: decodedEvent.transactionHash,
                    tokenAddress: decodedEvent.args[0],
                    senderAddress: chainContractAddress,
                    recipientAddress: decodedEvent.args[1],
                    ethAmount: decodedEvent.args[2]?.toString() || '0',
                    tokenAmount: decodedEvent.args[3]?.toString() || '0',
                    blockNumber: decodedEvent.blockNumber,
                    blockTimestamp: timestamp,
                    type: 'Bought',
                    chainId: chainId,
                };
                const priceData = {
                    tokenAddress: decodedEvent.args[0],
                    tokenPrice: tokenPrice,
                    priceUSD: '0', // Will be calculated later if needed
                    blockNumber: blockNumber,
                    timestamp: timestamp,
                    chainId: chainId,
                };
                await (0, exports.saveTradeEvent)(eventData, priceData);
            }
        }
        else {
            handleNoEventsFound(start, end);
        }
        // Handle Sold events
        if (soldEvents.length > 0) {
            // Use the chainId parameter - we know it because we queried from that chain's contract
            for (const event of soldEvents) {
                // Type assertion: events from queryFilter have args property
                const decodedEvent = event;
                if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
                    console.warn('Event args not available, skipping');
                    continue;
                }
                const block = await chainProvider.getBlock(decodedEvent.blockNumber);
                const blockNumber = block?.number;
                const timestamp = block?.timestamp ? new Date(Number(block.timestamp) * 1000) : new Date();
                // Calculate price: (newVirtualEthReserves * 1e18) / newVirtualTokenReserves
                // args[6] = newVirtualEthReserves, args[7] = newVirtualTokenReserves
                const virtualEthReserves = ethers_1.ethers.toBigInt(decodedEvent.args[6]);
                const virtualTokenReserves = ethers_1.ethers.toBigInt(decodedEvent.args[7]);
                let tokenPrice = '0';
                if (virtualTokenReserves > 0n && virtualEthReserves > 0n) {
                    const priceInWei = (virtualEthReserves * 10n ** 18n) / virtualTokenReserves;
                    tokenPrice = ethers_1.ethers.formatUnits(priceInWei, 18);
                    // Validate price is reasonable (should be < 1000 ETH per token)
                    const priceValue = parseFloat(tokenPrice);
                    if (!isFinite(priceValue) || priceValue < 0 || priceValue > 1000) {
                        console.error('❌ Invalid price calculated in syncBlockRange (Sold):', {
                            price: tokenPrice,
                            priceValue,
                            virtualEthReserves: virtualEthReserves.toString(),
                            virtualTokenReserves: virtualTokenReserves.toString(),
                            tokenAddress: decodedEvent.args[0],
                        });
                        tokenPrice = '0'; // Skip invalid price
                    }
                }
                const eventData = {
                    txHash: decodedEvent.transactionHash,
                    tokenAddress: decodedEvent.args[0],
                    senderAddress: decodedEvent.args[1],
                    recipientAddress: chainContractAddress,
                    ethAmount: decodedEvent.args[3]?.toString() || '0',
                    tokenAmount: decodedEvent.args[2]?.toString() || '0',
                    blockNumber: decodedEvent.blockNumber,
                    blockTimestamp: timestamp,
                    type: 'Sold',
                    chainId: chainId,
                };
                const priceData = {
                    tokenAddress: decodedEvent.args[0],
                    tokenPrice: tokenPrice,
                    priceUSD: '0', // Will be calculated later if needed
                    blockNumber: blockNumber,
                    timestamp: timestamp,
                    chainId: chainId,
                };
                await (0, exports.saveTradeEvent)(eventData, priceData);
            }
        }
        else {
            handleNoEventsFound(start, end);
        }
    }
    catch (err) {
        console.error('Error during sync cycle:', err);
    }
};
exports.syncBlockRange = syncBlockRange;
// Define a callback for when no events are found
const handleNoEventsFound = (startBlock, endBlock) => {
    console.log(`No events found in blocks ${startBlock} to ${endBlock}`);
};
/**
 * Call graduateTokenManually on the contract for a specific chain
 * This is called automatically when a token reaches the graduation threshold
 */
async function graduateTokenManually(tokenAddress, chainId) {
    try {
        const contractWithSigner = (0, blockchain_1.getContractWithSigner)(chainId);
        const provider = (0, blockchain_1.getProvider)(chainId);
        // Estimate gas first
        let gasEstimate;
        try {
            gasEstimate = await contractWithSigner.graduateTokenManually.estimateGas(tokenAddress);
        }
        catch (error) {
            // If estimation fails, it might be because token is already graduated or not eligible
            if (error.message?.includes('already liquidityAdded') ||
                error.message?.includes('threshold not met') ||
                error.message?.includes('not eligible')) {
                console.log(`ℹ️ Token ${tokenAddress} on chain ${chainId} not eligible for graduation:`, error.message);
                return;
            }
            throw error;
        }
        const feeData = await provider.getFeeData();
        // Call graduateTokenManually with proper gas settings
        const tx = await contractWithSigner.graduateTokenManually(tokenAddress, {
            gasLimit: gasEstimate * 120n / 100n, // Add 20% buffer for safety
            maxFeePerGas: feeData.maxFeePerGas || undefined,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || undefined,
        });
        console.log(`✅ Graduation transaction sent for token ${tokenAddress} on chain ${chainId}`);
        console.log(`   TX Hash: ${tx.hash}`);
        // Wait for transaction receipt asynchronously (don't block)
        tx.wait().then((receipt) => {
            if (receipt) {
                console.log(`✅ Token ${tokenAddress} on chain ${chainId} graduated successfully. TX: ${tx.hash}`);
            }
        }).catch((error) => {
            console.error(`❌ Error waiting for graduation transaction ${tx.hash} on chain ${chainId}:`, error.message);
        });
    }
    catch (error) {
        // Check if it's already graduated or not eligible (these are expected cases)
        if (error.message?.includes('already liquidityAdded') ||
            error.message?.includes('threshold not met') ||
            error.message?.includes('not eligible')) {
            console.log(`ℹ️ Token ${tokenAddress} on chain ${chainId} not eligible for graduation:`, error.message);
        }
        else {
            // Re-throw unexpected errors
            throw error;
        }
    }
}
/**
 * Save TokenGraduated event as a LiquidityEvent record
 */
const saveGraduationEvent = async (eventData) => {
    try {
        const chainId = eventData.chainId || parseInt(process.env.CHAIN_ID || '1');
        // Validate required fields
        if (!eventData.txHash) {
            console.error('❌ saveGraduationEvent: txHash is missing in eventData:', eventData);
            return;
        }
        if (!eventData.tokenAddress) {
            console.error('❌ saveGraduationEvent: tokenAddress is missing in eventData:', eventData);
            return;
        }
        // Check if the liquidity event already exists
        const existingEvent = await LiquidityEvent_1.default.findOne({
            txHash: eventData.txHash.toLowerCase(),
            chainId: chainId
        });
        if (existingEvent) {
            console.log(`⚠️ LiquidityEvent already exists for txHash: ${eventData.txHash}`);
            return;
        }
        // Lookup token to get tokenId
        const token = await Token_1.default.findOne({
            address: eventData.tokenAddress?.toLowerCase(),
            chainId: chainId
        });
        if (!token) {
            console.warn(`⚠️ Token not found for graduation event: ${eventData.tokenAddress} on chain ${chainId}`);
            return;
        }
        // Get Uniswap router address from environment or use factory address as fallback
        const factoryAddress = (0, blockchain_1.getFactoryAddressForChain)(chainId);
        const uniswapRouter = process.env.UNISWAP_ROUTER_ADDRESS || factoryAddress || '0x0000000000000000000000000000000000000000';
        // Calculate graduation price from event data
        let graduationPrice = '0';
        if (eventData.graduationPrice) {
            try {
                graduationPrice = ethers_1.ethers.formatUnits(BigInt(eventData.graduationPrice.toString()), 18);
            }
            catch (err) {
                console.warn('⚠️ Could not format graduation price:', err);
            }
        }
        // Create LiquidityEvent record
        await LiquidityEvent_1.default.create({
            tokenId: token._id,
            tokenAddress: eventData.tokenAddress.toLowerCase(),
            type: 'add', // Graduation always adds liquidity
            providerAddress: uniswapRouter.toLowerCase(),
            ethAmount: eventData.ethAmount?.toString() || '0',
            tokenAmount: eventData.tokenAmount?.toString() || '0',
            tokenPrice: graduationPrice,
            tokenPriceUSD: '0', // Can be calculated later if needed
            liquidityPoolAddress: uniswapRouter.toLowerCase(),
            txHash: eventData.txHash.toLowerCase(),
            blockNumber: eventData.blockNumber || 0,
            blockTimestamp: eventData.blockTimestamp || new Date(),
            chainId: chainId,
            status: 'confirmed',
            methodName: 'TokenGraduated',
        });
        console.log(`✅ LiquidityEvent created for graduated token: ${eventData.tokenAddress}`);
        // Update token's isActive status to false (token is no longer active on bonding curve)
        token.isActive = false;
        await token.save();
        console.log(`✅ Token ${eventData.tokenAddress} marked as inactive (graduated)`);
    }
    catch (error) {
        console.error('❌ Error saving graduation event:', error.message);
        console.error('   Full error:', error);
    }
};
exports.saveGraduationEvent = saveGraduationEvent;
//# sourceMappingURL=handler.js.map