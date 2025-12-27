import mongoose, { Schema, Model } from 'mongoose';
import { IActivity } from '../types';

const activitySchema = new Schema<IActivity>({
  // Activity type
  type: {
    type: String,
    required: true,
    enum: ['deposit', 'withdraw'],
    index: true
  },
  
  // Wallet address (embedded wallet)
  walletAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid wallet address format'
    },
    index: true
  },
  
  // Addresses
  fromAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid from address format'
    }
  },
  toAddress: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{40}$/.test(v);
      },
      message: 'Invalid to address format'
    }
  },
  
  // Amounts
  amount: {
    type: String,
    required: true,
    default: '0'
  },
  amountUSD: {
    type: String,
    default: '0'
  },
  
  // Transaction information
  txHash: {
    type: String,
    required: true,
    lowercase: true,
    validate: {
      validator: function(v: string) {
        return /^0x[a-fA-F0-9]{64}$/.test(v);
      },
      message: 'Invalid transaction hash format'
    },
    index: true
  },
  blockNumber: {
    type: Number,
    required: true
  },
  blockTimestamp: {
    type: Date,
    required: true,
    index: true
  },
  
  // Chain information
  chainId: {
    type: Number,
    required: true,
    enum: [1, 8453, 42161, 84532], // Ethereum, Base, Arbitrum, Base Sepolia
    default: 1,
    index: true
  },
  
  // Status
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'failed'],
    default: 'confirmed'
  },
  
  // Gas information (optional)
  gasUsed: {
    type: String,
    default: '0'
  },
  gasCost: {
    type: String,
    default: '0'
  },
  
  // User reference (optional, for tracking)
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
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

// Compound indexes for better query performance
// Unique index to prevent duplicate activities (same txHash on same chain)
activitySchema.index({ txHash: 1, chainId: 1 }, { unique: true });

// Index for querying by wallet address and chain
activitySchema.index({ walletAddress: 1, chainId: 1 });

// Index for sorting by timestamp
activitySchema.index({ blockTimestamp: -1 });

// Pre-save middleware to update the updatedAt field
activitySchema.pre('save', function(this: any, next) {
  this.updatedAt = new Date();
  next();
});

const Activity: Model<IActivity> = mongoose.model<IActivity>('Activity', activitySchema);

export default Activity;

