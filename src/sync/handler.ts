import { ethers } from 'ethers';
import Transaction from '../models/Transaction';
import TokenHistory from '../models/TokenHistory';
import Token from '../models/Token';
import TokenHolder from '../models/TokenHolder';
import LiquidityEvent from '../models/LiquidityEvent';
import { getContract, getProvider, getFactoryAddressForChain, getContractWithSigner } from '../config/blockchain';
import { emitTokenPriceUpdate, emitTokenBought, emitTokenSold, emitTokenCreated } from '../socket/updateEmitter';
import { getEthPriceUSD } from '../services/ethPriceService';

// Helper function to validate and normalize price
const validatePrice = (price: string | number | undefined, context: string = ''): string => {
  if (!price) return '0';
  
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
const updateOrCreateHolder = async (
  tokenId: any,
  tokenAddress: string,
  holderAddress: string,
  balance: string,
  txHash: string,
  chainId: number,
  isFirstTransaction: boolean
): Promise<void> => {
  try {
    const existingHolder = await TokenHolder.findOne({
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
    } else {
      // Create new holder
      await TokenHolder.create({
        tokenId: tokenId,
        tokenAddress: tokenAddress.toLowerCase(),
        holderAddress: holderAddress.toLowerCase(),
        balance: balance,
        firstTransactionHash: txHash.toLowerCase(),
        lastTransactionHash: txHash.toLowerCase(),
        transactionCount: 1,
        chainId: chainId
      });
    }
  } catch (error: any) {
    console.error(`❌ Error updating/creating holder ${holderAddress}:`, error.message);
    throw error;
  }
};

// Helper function to recalculate percentages for all holders of a token
export const recalculatePercentages = async (
  tokenAddress: string,
  totalSupply: string,
  chainId: number
): Promise<void> => {
  try {
    if (!totalSupply || totalSupply === '0') {
      return;
    }

    const holders = await TokenHolder.find({
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
    
  } catch (error: any) {
    console.error(`❌ Error recalculating percentages for ${tokenAddress}:`, error.message);
  }
};

// Define your callback function for handling the events
export const saveTradeEvent = async (eventData: any, priceData: any): Promise<void> => {
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
    const existingTx = await Transaction.findOne({ 
      txHash: (eventData.txHash || '').toLowerCase(),
      chainId: chainId
    });
    
    // Lookup token to get tokenId
    const token = await Token.findOne({ 
      address: eventData.tokenAddress?.toLowerCase(),
      chainId: chainId
    });
    
    if (!token) {
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
        
        // Check if token is ready to graduate and call graduateTokenManually
        // Only check if token is still active (not already graduated)
        if (newEthReserves >= graduationEth && token.isActive) {
          
          // Call graduateTokenManually asynchronously (don't block the event processing)
          graduateTokenManually(token.address, chainId).catch((error: any) => {
            console.error(`❌ Error calling graduateTokenManually for ${token.address} on chain ${chainId}:`, error.message);
          });
        }
      } catch (error: any) {
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
      await Transaction.create(transactionData);
    } else if (priceData?.tokenPrice && (!existingTx.tokenPrice || existingTx.tokenPrice === '0')) {
      // Update existing transaction with tokenPrice if it's missing or zero
      existingTx.tokenPrice = String(priceData.tokenPrice);
      await existingTx.save();
    }
    
    // Save price history if it doesn't exist
    if (priceData) {
      // Fetch ETH price for USD calculations
      let ethPriceUSD = '0';
      try {
        ethPriceUSD = await getEthPriceUSD();
      } catch (error: any) {
        console.error('❌ Error fetching ETH price in saveTradeEvent:', error.message);
        // Continue with ETH-only values if USD calculation fails
      }

      const existingPrice = await TokenHistory.findOne({
        tokenAddress: priceData.tokenAddress?.toLowerCase(),
        chainId: chainId,
        timestamp: priceData.timestamp
      });
      
    if (!existingPrice) {
        // Calculate USD values for TokenHistory
        const tokenPrice = String(priceData.tokenPrice || '0');
        let priceUSD = '0';
        let marketCapUSD = '0';
        
        if (tokenPrice !== '0' && ethPriceUSD !== '0') {
          try {
            const ethPrice = parseFloat(ethPriceUSD);
            // tokenPrice is in ETH (decimal string), convert to USD
            priceUSD = (parseFloat(tokenPrice) * ethPrice).toString();
          } catch (err) {
          }
        }

        // Calculate marketCap in ETH first, then convert to USD
        let marketCap = '0';
        if (token.totalSupply && tokenPrice !== '0') {
          try {
            const supply = BigInt(token.totalSupply);
            const priceInWei = ethers.parseUnits(tokenPrice, 18);
            marketCap = ((supply * priceInWei) / (10n ** 18n)).toString();
            
            if (marketCap !== '0' && ethPriceUSD !== '0') {
              const ethPrice = parseFloat(ethPriceUSD);
              // marketCap is in wei, convert to ETH first, then to USD
              const marketCapInEth = Number(marketCap) / 1e18;
              marketCapUSD = (marketCapInEth * ethPrice).toString();
            }
          } catch (err) {
          }
        }

        const historyData = {
          ...priceData,
          tokenId: token._id,
          tokenAddress: priceData.tokenAddress?.toLowerCase(),
          tokenPrice: tokenPrice,
          priceUSD: priceUSD,
          marketCap: marketCap,
          marketCapUSD: marketCapUSD,
          chainId: chainId,
        };
        await TokenHistory.create(historyData);
        
        // Update Token's currentPrice with the validated price
        const validatedPrice = validatePrice(priceData.tokenPrice, 'in saveTradeEvent (new history)');
        if (validatedPrice !== '0') {
          token.currentPrice = validatedPrice;
          
          // Calculate USD price
          try {
            const ethPrice = parseFloat(ethPriceUSD);
            if (ethPrice > 0) {
              token.currentPriceUSD = (parseFloat(validatedPrice) * ethPrice).toString();
            }
          } catch (err) {
            token.currentPriceUSD = '0';
          }
        }
        
        // Calculate and update marketCap if totalSupply is available
        // currentPrice is stored as decimal string (e.g., "0.000008"), need to convert to wei first
        if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
          try {
            const supply = BigInt(token.totalSupply);
            // Convert decimal price string to wei (BigInt)
            const priceInWei = ethers.parseUnits(token.currentPrice, 18);
            // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
            const marketCap = (supply * priceInWei) / (10n ** 18n);
            token.marketCap = marketCap.toString();
            
            // Calculate USD market cap
            if (ethPriceUSD !== '0') {
              try {
                const ethPrice = parseFloat(ethPriceUSD);
                if (ethPrice > 0) {
                  const marketCapInEth = Number(marketCap) / 1e18;
                  token.marketCapUSD = (marketCapInEth * ethPrice).toString();
                }
              } catch (err) {
                token.marketCapUSD = '0';
              }
            }
          } catch (err: any) {
            console.error('❌ Error calculating market cap:', {
              tokenAddress: token.address,
              chainId: chainId,
              error: err?.message || 'Unknown error',
              totalSupply: token.totalSupply,
              currentPrice: token.currentPrice
            });
          }
        }
        
        await token.save();
      } else {
        // Even if price history exists, update Token's currentPrice if it's newer
        if (priceData.tokenPrice) {
          const validatedPrice = validatePrice(priceData.tokenPrice, 'in saveTradeEvent (existing history - trade)');
          if (validatedPrice !== '0') {
            token.currentPrice = validatedPrice;
            
            // Calculate USD price
            try {
              const ethPrice = parseFloat(ethPriceUSD);
              if (ethPrice > 0) {
                token.currentPriceUSD = (parseFloat(validatedPrice) * ethPrice).toString();
              }
            } catch (err) {
              token.currentPriceUSD = '0';
            }
          }
          
          // Calculate and update marketCap if totalSupply is available
          // currentPrice is stored as decimal string (e.g., "0.000008"), need to convert to wei first
          if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
            try {
              const supply = BigInt(token.totalSupply);
              // Convert decimal price string to wei (BigInt)
              const priceInWei = ethers.parseUnits(token.currentPrice, 18);
              // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
              const marketCap = (supply * priceInWei) / (10n ** 18n);
              token.marketCap = marketCap.toString();
              
              // Calculate USD market cap
              if (ethPriceUSD !== '0') {
                try {
                  const ethPrice = parseFloat(ethPriceUSD);
                  if (ethPrice > 0) {
                    const marketCapInEth = Number(marketCap) / 1e18;
                    token.marketCapUSD = (marketCapInEth * ethPrice).toString();
                  }
                } catch (err) {
                  token.marketCapUSD = '0';
                }
              }
            } catch (err) {
            }
          }
          
          await token.save();
        }
      }
    }
    
    // Update holders based on trade type (MOVED COMPLETELY OUTSIDE of if (priceData) - runs for EVERY trade)
    try {
      const tokenAddress = priceData?.tokenAddress?.toLowerCase() || eventData.tokenAddress?.toLowerCase();
      const bondingCurveAddress = getFactoryAddressForChain(chainId)?.toLowerCase();
      
      if (eventData.type === 'Bought') {
        // Buyer receives tokens, bonding curve loses tokens
        const buyerAddress = eventData.recipientAddress?.toLowerCase();
        const tokenAmount = eventData.tokenAmount?.toString() || '0';
        
        // Get current buyer balance
        const buyerHolder = await TokenHolder.findOne({
          tokenId: token._id,
          holderAddress: buyerAddress,
          chainId: chainId
        });
        const buyerCurrentBalance = BigInt(buyerHolder?.balance || '0');
        const buyerNewBalance = (buyerCurrentBalance + BigInt(tokenAmount)).toString();
        
        // Update buyer holder
        await updateOrCreateHolder(
          token._id,
          tokenAddress,
          buyerAddress,
          buyerNewBalance,
          eventData.txHash,
          chainId,
          !buyerHolder
        );
        
        // Update bonding curve holder (decrease balance)
        if (bondingCurveAddress) {
          const bondingCurveHolder = await TokenHolder.findOne({
            tokenId: token._id,
            holderAddress: bondingCurveAddress,
            chainId: chainId
          });
          if (bondingCurveHolder) {
            const bondingCurveCurrentBalance = BigInt(bondingCurveHolder.balance || '0');
            const bondingCurveNewBalance = (bondingCurveCurrentBalance - BigInt(tokenAmount)).toString();
            if (BigInt(bondingCurveNewBalance) >= 0n) {
              await updateOrCreateHolder(
                token._id,
                tokenAddress,
                bondingCurveAddress,
                bondingCurveNewBalance,
                eventData.txHash,
                chainId,
                false
              );
            }
          } else {
          }
        }
        
      } else if (eventData.type === 'Sold') {
        // Seller loses tokens, bonding curve gains tokens
        const sellerAddress = eventData.senderAddress?.toLowerCase();
        const tokenAmount = eventData.tokenAmount?.toString() || '0';
        
        // Get current seller balance
        const sellerHolder = await TokenHolder.findOne({
          tokenId: token._id,
          holderAddress: sellerAddress,
          chainId: chainId
        });
        const sellerCurrentBalance = BigInt(sellerHolder?.balance || '0');
        const sellerNewBalance = (sellerCurrentBalance - BigInt(tokenAmount)).toString();
        
        // Update seller holder (remove if balance becomes 0)
        if (sellerNewBalance !== '0' && BigInt(sellerNewBalance) >= 0n) {
          await updateOrCreateHolder(
            token._id,
            tokenAddress,
            sellerAddress,
            sellerNewBalance,
            eventData.txHash,
            chainId,
            false
          );
        } else if (sellerHolder) {
          // Remove holder if balance becomes 0
          await TokenHolder.deleteOne({
            tokenId: token._id,
            holderAddress: sellerAddress,
            chainId: chainId
          });
        }
        
        // Update bonding curve holder (increase balance)
        if (bondingCurveAddress) {
          const bondingCurveHolder = await TokenHolder.findOne({
            tokenId: token._id,
            holderAddress: bondingCurveAddress,
            chainId: chainId
          });
          const bondingCurveCurrentBalance = BigInt(bondingCurveHolder?.balance || '0');
          const bondingCurveNewBalance = (bondingCurveCurrentBalance + BigInt(tokenAmount)).toString();
          
          await updateOrCreateHolder(
            token._id,
            tokenAddress,
            bondingCurveAddress,
            bondingCurveNewBalance,
            eventData.txHash,
            chainId,
            !bondingCurveHolder
          );
        }
        
      }
      
      // Recalculate percentages for all holders
      await recalculatePercentages(tokenAddress, token.totalSupply || '0', chainId);
    } catch (holderError: any) {
      console.error('❌ Error updating holders:', holderError.message);
      // Don't throw - continue even if holder update fails
    }
    
    // Fetch updated holders for WebSocket emission (moved outside if (priceData))
    let holders: any[] = [];
    try {
      holders = await TokenHolder.find({
        tokenAddress: (priceData?.tokenAddress || eventData.tokenAddress)?.toLowerCase(),
        chainId: chainId
      })
      .select('holderAddress balance balanceUSD percentage')
      .sort({ balance: -1 })
      .lean();
    } catch (err) {
    }

    // Transform holders to match frontend format
    const formattedHolders = (holders || []).map((holder: any) => ({
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
      emitTokenPriceUpdate(tokenAddress, {
        price: String(tokenPrice),
        priceUSD: token.currentPriceUSD || '0', // Include USD price for real-time updates
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
      emitTokenBought({
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
    } else if (eventData.type === 'Sold') {
      emitTokenSold({
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
  } catch (error) {
    console.error('Error saving transaction:', error);
  }
};

// Define your callback function for handling the events
export const saveCreatedEvent = async (eventData: any, priceData: any): Promise<void> => {
  try {
    const chainId = eventData?.chainId || priceData?.chainId || parseInt(process.env.CHAIN_ID || '1');
    
    // Check if the token already exists in the database (using address + chainId)
    const existingToken = await Token.findOne({ 
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
      
      token = await Token.create(tokenData);
    } else {
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
    }
    
    // Update Token's currentPrice and marketCap (for display) but DON'T save to TokenHistory
    // Price history should only be saved on buy/sell events, not on token creation
    if (priceData && token) {
      // Fetch ETH price for USD calculations
      let ethPriceUSD = '0';
      try {
        ethPriceUSD = await getEthPriceUSD();
      } catch (error: any) {
        console.error('❌ Error fetching ETH price in saveCreatedEvent:', error.message);
        // Continue with ETH-only values if USD calculation fails
      }

      // Validate price before updating token
      const tokenPrice = String(priceData.tokenPrice || '0');
      const validatedPrice = validatePrice(tokenPrice, 'in saveCreatedEvent (initial price)');
      
      if (validatedPrice !== '0') {
        token.currentPrice = validatedPrice;
        
        // Calculate USD price
        try {
          const ethPrice = parseFloat(ethPriceUSD);
          if (ethPrice > 0) {
            token.currentPriceUSD = (parseFloat(validatedPrice) * ethPrice).toString();
          } else {
            token.currentPriceUSD = '0';
          }
        } catch (err) {
          token.currentPriceUSD = '0';
        }
        
        // Calculate and update marketCap if totalSupply is available
        if (token.totalSupply && token.currentPrice && token.currentPrice !== '0') {
          try {
            const supply = BigInt(token.totalSupply);
            // Convert decimal price string to wei (BigInt)
            const priceInWei = ethers.parseUnits(token.currentPrice, 18);
            // marketCap = totalSupply * priceInWei / 10^18 (to get result in wei)
            const marketCap = (supply * priceInWei) / (10n ** 18n);
            token.marketCap = marketCap.toString();
            
            // Calculate USD market cap
            if (ethPriceUSD !== '0') {
              try {
                const ethPrice = parseFloat(ethPriceUSD);
                if (ethPrice > 0) {
                  const marketCapInEth = Number(marketCap) / 1e18;
                  token.marketCapUSD = (marketCapInEth * ethPrice).toString();
                } else {
                  token.marketCapUSD = '0';
                }
              } catch (err) {
                token.marketCapUSD = '0';
              }
            } else {
              token.marketCapUSD = '0';
            }
          } catch (err) {
          }
        }
        
        await token.save();
      }
      
      // Create initial holder record for bonding curve contract
      try {
        const tokenAddress = priceData.tokenAddress?.toLowerCase();
        const chainId = priceData.chainId || parseInt(process.env.CHAIN_ID || '1');
        const bondingCurveAddress = getFactoryAddressForChain(chainId)?.toLowerCase();
        const totalSupply = token.totalSupply || '0';
        
        if (bondingCurveAddress && totalSupply && totalSupply !== '0') {
          // Check if holder already exists (might exist from previous sync)
          const existingBondingCurveHolder = await TokenHolder.findOne({
            tokenId: token._id,
            holderAddress: bondingCurveAddress,
            chainId: chainId
          });
          
          if (!existingBondingCurveHolder) {
            // Create holder record for bonding curve with totalSupply
            await TokenHolder.create({
              tokenId: token._id,
              tokenAddress: tokenAddress,
              holderAddress: bondingCurveAddress,
              balance: totalSupply,
              firstTransactionHash: '', // Will be set on first trade
              lastTransactionHash: '',
              transactionCount: 0,
              chainId: chainId
            });
          } else {
            // Update existing holder with totalSupply if it's higher
            const existingBalance = BigInt(existingBondingCurveHolder.balance || '0');
            const newBalance = BigInt(totalSupply);
            if (newBalance > existingBalance) {
              existingBondingCurveHolder.balance = totalSupply;
              await existingBondingCurveHolder.save();
            }
          }
          
          // Recalculate percentages
          await recalculatePercentages(tokenAddress, totalSupply, chainId);
        }
      } catch (holderError: any) {
        console.error('❌ Error creating initial holder:', holderError.message);
        // Don't throw - continue with WebSocket emission even if holder creation fails
      }
      
      // Fetch holders for WebSocket emission
      let holders: any[] = [];
      try {
        holders = await TokenHolder.find({
          tokenAddress: priceData.tokenAddress?.toLowerCase(),
          chainId: chainId
        })
        .select('holderAddress balance balanceUSD percentage')
        .sort({ balance: -1 })
        .lean();
      } catch (err) {
      }

      // Transform holders to match frontend format
      const formattedHolders = (holders || []).map((holder: any) => ({
        owner_address: holder.holderAddress,
        balance: holder.balance,
        balanceUSD: holder.balanceUSD || '0',
        percentage: holder.percentage || 0
      }));

      // Emit comprehensive tokenCreated event with token and holder data
      // NOTE: We don't emit priceUpdate here since no price history is saved on creation
      emitTokenCreated({
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
  } catch (error: any) {
    console.error('Error saving token creation event:', error);
    // Don't throw - we want the system to continue even if one event fails
  }
};

export const syncBlockRange = async (start: number, end: number, chainId: number): Promise<void> => {
  try {
    // Get chain-specific contract and provider
    const chainContract = getContract(chainId);
    const chainProvider = getProvider(chainId);
    const chainContractAddress = getFactoryAddressForChain(chainId);
    

    const createdEvents = await chainContract.queryFilter(
      chainContract.filters.TokenCreated(),
      start,
      end
    );

    const boughtEvents = await chainContract.queryFilter(
      chainContract.filters.TokenBought(),
      start,
      end
    );

    const soldEvents = await chainContract.queryFilter(
      chainContract.filters.TokenSold(),
      start,
      end
    );

    // Handle Created events
    if (createdEvents?.length > 0) {
      // Use the chainId parameter - we know it because we queried from that chain's contract

      for (const event of createdEvents) {
        // Type assertion: events from queryFilter have args property
        const decodedEvent = event as any;
        if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
          continue;
        }

        // Validate array has enough elements (need at least 9 elements: 0-8)
        if (decodedEvent.args.length < 9) {
          console.error('❌ Invalid event args length in TokenCreated event:', {
            chainId,
            argsLength: decodedEvent.args.length,
            expected: 9,
            txHash: decodedEvent.transactionHash
          });
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
        // Validate values exist before BigInt conversion
        if (decodedEvent.args[7] === undefined || decodedEvent.args[7] === null ||
            decodedEvent.args[8] === undefined || decodedEvent.args[8] === null) {
          console.error('❌ Missing virtual reserves in TokenCreated event:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            args7: decodedEvent.args[7],
            args8: decodedEvent.args[8]
          });
          continue;
        }

        let virtualEthReserves: bigint;
        let virtualTokenReserves: bigint;
        try {
          virtualEthReserves = ethers.toBigInt(decodedEvent.args[7]);
          virtualTokenReserves = ethers.toBigInt(decodedEvent.args[8]);
        } catch (error: any) {
          console.error('❌ Error converting virtual reserves to BigInt:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            error: error.message,
            args7: decodedEvent.args[7],
            args8: decodedEvent.args[8]
          });
          continue;
        }
        
        const priceData = {
          tokenAddress: decodedEvent.args[0],
          tokenPrice: virtualTokenReserves > 0n
            ? ethers.formatUnits((virtualEthReserves * 10n ** 18n) / virtualTokenReserves, 18)
            : '0',
          blockNumber: blockNumber,
          timestamp: timestamp ? new Date(Number(timestamp) * 1000) : new Date(),
          chainId: chainId,
        };
        await saveCreatedEvent(eventData, priceData);
      }
    } else {
      handleNoEventsFound(start, end);
    }

    // Handle Bought events
    if (boughtEvents.length > 0) {
      // Use the chainId parameter - we know it because we queried from that chain's contract

      for (const event of boughtEvents) {
        // Type assertion: events from queryFilter have args property
        const decodedEvent = event as any;
        if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
          continue;
        }

        // Validate array has enough elements (need at least 8 elements: 0-7)
        if (decodedEvent.args.length < 8) {
          console.error('❌ Invalid event args length in TokenBought event:', {
            chainId,
            argsLength: decodedEvent.args.length,
            expected: 8,
            txHash: decodedEvent.transactionHash
          });
          continue;
        }

        const block = await chainProvider.getBlock(decodedEvent.blockNumber);
        const blockNumber = block?.number;
        const timestamp = block?.timestamp ? new Date(Number(block.timestamp) * 1000) : new Date();
        
        // Calculate price: (newVirtualEthReserves * 1e18) / newVirtualTokenReserves
        // args[6] = newVirtualEthReserves, args[7] = newVirtualTokenReserves
        // Validate values exist before BigInt conversion
        if (decodedEvent.args[6] === undefined || decodedEvent.args[6] === null ||
            decodedEvent.args[7] === undefined || decodedEvent.args[7] === null) {
          console.error('❌ Missing virtual reserves in TokenBought event:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            args6: decodedEvent.args[6],
            args7: decodedEvent.args[7]
          });
          continue;
        }

        let virtualEthReserves: bigint;
        let virtualTokenReserves: bigint;
        try {
          virtualEthReserves = ethers.toBigInt(decodedEvent.args[6]);
          virtualTokenReserves = ethers.toBigInt(decodedEvent.args[7]);
        } catch (error: any) {
          console.error('❌ Error converting virtual reserves to BigInt:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            error: error.message,
            args6: decodedEvent.args[6],
            args7: decodedEvent.args[7]
          });
          continue;
        }
        
        let tokenPrice = '0';
        if (virtualTokenReserves > 0n && virtualEthReserves > 0n) {
          const priceInWei = (virtualEthReserves * 10n ** 18n) / virtualTokenReserves;
          tokenPrice = ethers.formatUnits(priceInWei, 18);
          
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
        
        await saveTradeEvent(eventData, priceData);
      }
    } else {
      handleNoEventsFound(start, end);
    }

    // Handle Sold events
    if (soldEvents.length > 0) {
      // Use the chainId parameter - we know it because we queried from that chain's contract

      for (const event of soldEvents) {
        // Type assertion: events from queryFilter have args property
        const decodedEvent = event as any;
        if (!decodedEvent.args || !Array.isArray(decodedEvent.args)) {
          continue;
        }

        // Validate array has enough elements (need at least 8 elements: 0-7)
        if (decodedEvent.args.length < 8) {
          console.error('❌ Invalid event args length in TokenSold event:', {
            chainId,
            argsLength: decodedEvent.args.length,
            expected: 8,
            txHash: decodedEvent.transactionHash
          });
          continue;
        }

        const block = await chainProvider.getBlock(decodedEvent.blockNumber);
        const blockNumber = block?.number;
        const timestamp = block?.timestamp ? new Date(Number(block.timestamp) * 1000) : new Date();
        
        // Calculate price: (newVirtualEthReserves * 1e18) / newVirtualTokenReserves
        // args[6] = newVirtualEthReserves, args[7] = newVirtualTokenReserves
        // Validate values exist before BigInt conversion
        if (decodedEvent.args[6] === undefined || decodedEvent.args[6] === null ||
            decodedEvent.args[7] === undefined || decodedEvent.args[7] === null) {
          console.error('❌ Missing virtual reserves in TokenSold event:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            args6: decodedEvent.args[6],
            args7: decodedEvent.args[7]
          });
          continue;
        }

        let virtualEthReserves: bigint;
        let virtualTokenReserves: bigint;
        try {
          virtualEthReserves = ethers.toBigInt(decodedEvent.args[6]);
          virtualTokenReserves = ethers.toBigInt(decodedEvent.args[7]);
        } catch (error: any) {
          console.error('❌ Error converting virtual reserves to BigInt:', {
            chainId,
            txHash: decodedEvent.transactionHash,
            error: error.message,
            args6: decodedEvent.args[6],
            args7: decodedEvent.args[7]
          });
          continue;
        }
        
        let tokenPrice = '0';
        if (virtualTokenReserves > 0n && virtualEthReserves > 0n) {
          const priceInWei = (virtualEthReserves * 10n ** 18n) / virtualTokenReserves;
          tokenPrice = ethers.formatUnits(priceInWei, 18);
          
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
        
        await saveTradeEvent(eventData, priceData);
      }
    } else {
      handleNoEventsFound(start, end);
    }
  } catch (err) {
    console.error('Error during sync cycle:', err);
  }
};

// Define a callback for when no events are found
const handleNoEventsFound = (_startBlock: number, _endBlock: number): void => {
};

/**
 * Call graduateTokenManually on the contract for a specific chain
 * This is called automatically when a token reaches the graduation threshold
 */
async function graduateTokenManually(tokenAddress: string, chainId: number): Promise<void> {
  try {
    const contractWithSigner = getContractWithSigner(chainId);
    const provider = getProvider(chainId);
    
    // Estimate gas first
    let gasEstimate: bigint;
    try {
      gasEstimate = await contractWithSigner.graduateTokenManually.estimateGas(tokenAddress);
    } catch (error: any) {
      // If estimation fails, it might be because token is already graduated or not eligible
      if (error.message?.includes('already liquidityAdded') || 
          error.message?.includes('threshold not met') ||
          error.message?.includes('not eligible')) {
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
    
    
    // Wait for transaction receipt asynchronously (don't block)
    tx.wait().then((receipt: ethers.TransactionReceipt | null) => {
      if (receipt) {
      }
    }).catch((error: any) => {
      console.error(`❌ Error waiting for graduation transaction ${tx.hash} on chain ${chainId}:`, error.message);
    });
  } catch (error: any) {
    // Check if it's already graduated or not eligible (these are expected cases)
    if (error.message?.includes('already liquidityAdded') || 
        error.message?.includes('threshold not met') ||
        error.message?.includes('not eligible')) {
    } else {
      // Re-throw unexpected errors
      throw error;
    }
  }
}

/**
 * Save TokenGraduated event as a LiquidityEvent record
 */
export const saveGraduationEvent = async (eventData: any): Promise<void> => {
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
    const existingEvent = await LiquidityEvent.findOne({ 
      txHash: eventData.txHash.toLowerCase(),
      chainId: chainId
    });
    
    if (existingEvent) {
      return;
    }

    // Lookup token to get tokenId
    const token = await Token.findOne({ 
      address: eventData.tokenAddress?.toLowerCase(),
      chainId: chainId
    });
    
    if (!token) {
      return;
    }

    // Get Uniswap router address from environment or use factory address as fallback
    const factoryAddress = getFactoryAddressForChain(chainId);
    const uniswapRouter = process.env.UNISWAP_ROUTER_ADDRESS || factoryAddress || '0x0000000000000000000000000000000000000000';
    
    // Calculate graduation price from event data
    let graduationPrice = '0';
    if (eventData.graduationPrice) {
      try {
        graduationPrice = ethers.formatUnits(BigInt(eventData.graduationPrice.toString()), 18);
      } catch (err) {
      }
    }

    // Create LiquidityEvent record
    await LiquidityEvent.create({
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

    
    // Update token's isActive status to false (token is no longer active on bonding curve)
    token.isActive = false;
    await token.save();
    
  } catch (error: any) {
    console.error('❌ Error saving graduation event:', error.message);
    console.error('   Full error:', error);
  }
};

