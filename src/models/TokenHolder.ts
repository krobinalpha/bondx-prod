import mongoose, { Schema, Model } from 'mongoose';
import { ITokenHolder } from '../types';

const tokenHolderSchema = new Schema({
  // Token reference
  tokenId: {
    type: Schema.Types.ObjectId,
    ref: 'Token',
    required: true
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid token address format'
    }
  },

  // Holder address
  holderAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid holder address format'
    }
  },

  // Balance information
  balance: {
    type: String,
    required: true,
    default: '0'
  },
  balanceUSD: {
    type: String,
    default: '0'
  },

  // Percentage of total supply
  percentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Transaction information
  firstTransactionHash: {
    type: String,
    default: ''
  },
  lastTransactionHash: {
    type: String,
    default: ''
  },
  transactionCount: {
    type: Number,
    default: 0
  },

  // Chain information
  chainId: {
    type: Number,
    required: true,
    enum: [1, 8453, 42161, 84532], // Ethereum, Base, Arbitrum, Base Sepolia
    default: 1
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

// Compound index for unique token-holder-chain combination
tokenHolderSchema.index({ tokenId: 1, holderAddress: 1, chainId: 1 }, { unique: true });
tokenHolderSchema.index({ tokenAddress: 1, holderAddress: 1, chainId: 1 });
tokenHolderSchema.index({ tokenAddress: 1, chainId: 1, balance: -1 });
tokenHolderSchema.index({ holderAddress: 1, chainId: 1 });
tokenHolderSchema.index({ balance: -1 });
tokenHolderSchema.index({ balanceUSD: -1 });
tokenHolderSchema.index({ percentage: -1 });
tokenHolderSchema.index({ createdAt: -1 });
tokenHolderSchema.index({ chainId: 1 });

// Pre-save middleware to update the updatedAt field
tokenHolderSchema.pre('save', function(this: any, next) {
  this.updatedAt = new Date();
  next();
});

// Static method to find holders by token
tokenHolderSchema.statics.findByToken = function(tokenAddress: string, limit: number = 100) {
  return this.find({ tokenAddress: tokenAddress.toLowerCase() })
    .sort({ balance: -1 })
    .limit(limit);
};

// Static method to find holders by address
tokenHolderSchema.statics.findByAddress = function(holderAddress: string, limit: number = 100) {
  return this.find({ holderAddress: holderAddress.toLowerCase() })
    .sort({ balanceUSD: -1 })
    .limit(limit);
};

// Static method to find top holders
tokenHolderSchema.statics.findTopHolders = function(tokenAddress: string, limit: number = 10) {
  return this.find({ tokenAddress: tokenAddress.toLowerCase() })
    .sort({ balance: -1 })
    .limit(limit);
};

const TokenHolder: Model<ITokenHolder> = mongoose.model<ITokenHolder>('TokenHolder', tokenHolderSchema);

export default TokenHolder;

