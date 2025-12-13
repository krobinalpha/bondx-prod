import mongoose, { Schema, Model } from 'mongoose';
import { ITransaction } from '../types';

const transactionSchema = new Schema({
  // Transaction identification
  txHash: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{64}$/.test(v);
      },
      message: 'Invalid transaction hash format'
    }
  },
  
  // Token reference
  tokenId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Token'
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  
  // Transaction details
  type: {
    type: String,
    required: true,
    enum: ['Bought', 'Sold', 'Add_liquidity', 'Remove_liquidity', 'Transfer', 'Mint', 'Burn'],
    default: 'Bought'
  },
  
  // Addresses
  senderAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid sender address format'
    }
  },
  recipientAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid recipient address format'
    }
  },
  
  // Amounts
  ethAmount: {
    type: String,
    required: true,
    default: '0'
  },
  tokenAmount: {
    type: String,
    required: true,
    default: '0'
  },
  
  // Price information
  tokenPrice: {
    type: String,
    required: true,
    default: '0'
  },
  tokenPriceUSD: {
    type: String,
    default: '0'
  },
  
  // Gas information
  gasUsed: {
    type: String,
    default: '0'
  },
  gasPrice: {
    type: String,
    default: '0'
  },
  gasCost: {
    type: String,
    default: '0'
  },
  gasCostUSD: {
    type: String,
    default: '0'
  },
  
  // Block information
  blockNumber: {
    type: Number,
    required: true
  },
  blockTimestamp: {
    type: Date
  },
  
  // Chain information
  chainId: {
    type: Number,
    required: true,
    enum: [1, 8453, 42161, 84532], // Ethereum, Base, Arbitrum, Base Sepolia
    default: 1
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'failed'],
    default: 'confirmed'
  },
  
  // Additional metadata
  methodName: {
    type: String,
    default: ''
  },
  inputData: {
    type: String,
    default: ''
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
// Compound unique index for txHash + chainId (same hash can exist on different chains)
transactionSchema.index({ txHash: 1, chainId: 1 }, { unique: true });
transactionSchema.index({ tokenId: 1 });
transactionSchema.index({ tokenAddress: 1, chainId: 1 });
transactionSchema.index({ senderAddress: 1, chainId: 1 });
transactionSchema.index({ recipientAddress: 1, chainId: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ blockNumber: -1 });
transactionSchema.index({ blockTimestamp: -1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ chainId: 1 });

// Virtual for transaction value in USD
transactionSchema.virtual('valueUSD').get(function(this: any) {
  if (this.tokenPriceUSD && this.tokenAmount) {
    const price = parseFloat(this.tokenPriceUSD);
    const amount = parseFloat(this.tokenAmount);
    return (price * amount).toString();
  }
  return '0';
});

// Pre-save middleware to update the updatedAt field
transactionSchema.pre('save', function(this: any, next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find transactions by address
transactionSchema.statics.findByAddress = function(address: string) {
  return this.find({
    $or: [
      { senderAddress: address.toLowerCase() },
      { recipientAddress: address.toLowerCase() }
    ]
  }).sort({ blockTimestamp: -1 });
};

// Static method to find transactions by token
transactionSchema.statics.findByToken = function(tokenAddress: string, limit: number = 100) {
  return this.find({ tokenAddress: tokenAddress.toLowerCase() })
    .sort({ blockTimestamp: -1 })
    .limit(limit);
};

// Static method to find recent transactions
transactionSchema.statics.findRecent = function(limit: number = 50) {
  return this.find({ status: 'confirmed' })
    .sort({ blockTimestamp: -1 })
    .limit(limit);
};

// Instance method to calculate gas cost in USD
transactionSchema.methods.calculateGasCostUSD = async function(ethPriceUSD: string): Promise<ITransaction> {
  if (this.gasUsed && this.gasPrice && ethPriceUSD) {
    const gasUsed = parseFloat(this.gasUsed);
    const gasPrice = parseFloat(this.gasPrice);
    const ethPrice = parseFloat(ethPriceUSD);
    
    // Convert gas price from wei to ETH
    const gasPriceInEth = gasPrice / Math.pow(10, 18);
    
    // Calculate total gas cost in ETH
    const totalGasEth = gasUsed * gasPriceInEth;
    
    // Convert to USD
    const gasCostUSD = totalGasEth * ethPrice;
    
    this.gasCost = (totalGasEth * Math.pow(10, 18)).toString();
    this.gasCostUSD = gasCostUSD.toString();
    
    const saved = await this.save();
    return saved as ITransaction;
  }
  return this as ITransaction;
};

const Transaction: Model<ITransaction> = mongoose.model<ITransaction>('Transaction', transactionSchema);

export default Transaction;

