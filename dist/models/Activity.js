"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const activitySchema = new mongoose_1.Schema({
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
            validator: function (v) {
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
            validator: function (v) {
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
            validator: function (v) {
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
            validator: function (v) {
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
        type: mongoose_1.Schema.Types.ObjectId,
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
activitySchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});
const Activity = mongoose_1.default.model('Activity', activitySchema);
exports.default = Activity;
//# sourceMappingURL=Activity.js.map