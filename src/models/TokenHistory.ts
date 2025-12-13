import mongoose, { Schema, Model } from 'mongoose';
import { ITokenHistory } from '../types';

const historySchema = new Schema({
  // Address information
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true
  },
  tokenId: {
    type: Schema.Types.ObjectId,
    ref: 'Token',
    required: true
  },
  // Price information
  tokenPrice: {
    type: String,
    required: true,
    default: '0'
  },
  priceUSD: {
    type: String,
    default: '0'
  },
  marketCap: {
    type: String,
    default: '0'
  },
  marketCapUSD: {
    type: String,
    default: '0'
  },
  volume24h: {
    type: String,
    default: '0'
  },
  volume24hUSD: {
    type: String,
    default: '0'
  },
  totalLiquidity: {
    type: String,
    default: '0'
  },
  totalLiquidityUSD: {
    type: String,
    default: '0'
  },
  holdersCount: {
    type: Number,
    default: 0
  },
  transactionsCount: {
    type: Number,
    default: 0
  },
  // Timestamps
  blockNumber: {
    type: Number,
    default: 0
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  chainId: {
    type: Number,
    required: true,
    enum: [1, 8453, 42161, 84532], // Ethereum, Base, Arbitrum, Base Sepolia
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound unique index to prevent duplicate snapshots
historySchema.index({ tokenAddress: 1, chainId: 1, timestamp: 1 }, { unique: true });
historySchema.index({ tokenId: 1, timestamp: -1 });
historySchema.index({ tokenAddress: 1, chainId: 1, timestamp: -1 });
historySchema.index({ timestamp: -1 });
historySchema.index({ chainId: 1 });

const TokenHistory: Model<ITokenHistory> = mongoose.model<ITokenHistory>('TokenHistory', historySchema);

export default TokenHistory;

