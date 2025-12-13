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
const tokenHolderSchema = new mongoose_1.Schema({
    // Token reference
    tokenId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Token',
        required: true
    },
    tokenAddress: {
        type: String,
        required: true,
        lowercase: true,
        validate: {
            validator: function (v) {
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
            validator: function (v) {
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
tokenHolderSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});
// Static method to find holders by token
tokenHolderSchema.statics.findByToken = function (tokenAddress, limit = 100) {
    return this.find({ tokenAddress: tokenAddress.toLowerCase() })
        .sort({ balance: -1 })
        .limit(limit);
};
// Static method to find holders by address
tokenHolderSchema.statics.findByAddress = function (holderAddress, limit = 100) {
    return this.find({ holderAddress: holderAddress.toLowerCase() })
        .sort({ balanceUSD: -1 })
        .limit(limit);
};
// Static method to find top holders
tokenHolderSchema.statics.findTopHolders = function (tokenAddress, limit = 10) {
    return this.find({ tokenAddress: tokenAddress.toLowerCase() })
        .sort({ balance: -1 })
        .limit(limit);
};
const TokenHolder = mongoose_1.default.model('TokenHolder', tokenHolderSchema);
exports.default = TokenHolder;
//# sourceMappingURL=TokenHolder.js.map