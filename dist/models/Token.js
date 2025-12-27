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
require("./LiquidityEvent");
require("./TokenHolder");
require("./Transaction");
const tokenSchema = new mongoose_1.Schema({
    // Basic token information
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 10
    },
    symbol: {
        type: String,
        required: true,
        trim: true,
        maxlength: 7,
        uppercase: true
    },
    address: {
        type: String,
        required: true,
        lowercase: true,
        validate: {
            validator: function (v) {
                return /^0x[a-fA-F0-9]{40}$/.test(v);
            },
            message: 'Invalid Ethereum address format'
        }
    },
    chainId: {
        type: Number,
        required: true,
        enum: [1, 8453, 42161, 84532], // Ethereum, Base, Arbitrum, Base Sepolia
        default: 1 // Ethereum mainnet
    },
    // Creator information
    creatorAddress: {
        type: String,
        required: true,
        lowercase: true,
        validate: {
            validator: function (v) {
                return /^0x[a-fA-F0-9]{40}$/.test(v);
            },
            message: 'Invalid creator address format'
        }
    },
    // Token metadata
    logo: {
        type: String,
        default: '/chats/noimg.svg'
    },
    description: {
        type: String,
        maxlength: 200,
        default: ''
    },
    // Social links
    website: {
        type: String,
        default: ''
    },
    youtube: {
        type: String,
        default: ''
    },
    discord: {
        type: String,
        default: ''
    },
    twitter: {
        type: String,
        default: ''
    },
    telegram: {
        type: String,
        default: ''
    },
    // Token economics
    totalSupply: {
        type: String,
        default: '0'
    },
    circulatingSupply: {
        type: String,
        default: '0'
    },
    // Price and market data
    currentPrice: {
        type: String,
        default: '0'
    },
    currentPriceUSD: {
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
    // Liquidity information
    totalLiquidity: {
        type: String,
        default: '0'
    },
    totalLiquidityUSD: {
        type: String,
        default: '0'
    },
    // Graduation information
    graduationEth: {
        type: String,
        default: '0'
    },
    graduationProgress: {
        type: String,
        default: '0'
    },
    // Trading statistics
    volume24h: {
        type: String,
        default: '0'
    },
    volume24hUSD: {
        type: String,
        default: '0'
    },
    priceChange24h: {
        type: String,
        default: '0'
    },
    priceChange24hPercent: {
        type: String,
        default: '0'
    },
    // Status and verification
    isVerified: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isHoneypot: {
        type: Boolean,
        default: false
    },
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    latestTransactionTimestamp: {
        type: Date,
        default: Date.now
    },
    // Contract deployment info
    deploymentTxHash: {
        type: String,
        default: ''
    },
    deploymentBlock: {
        type: Number,
        default: 0
    },
    // Tags and categories
    tags: [{
            type: String,
            trim: true
        }],
    // Audit information
    auditScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    riskLevel: {
        type: String,
        enum: ['low', 'medium', 'high', 'extreme'],
        default: 'medium'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});
// Indexes for better query performance
// Compound unique index for address + chainId (same address can exist on different chains)
tokenSchema.index({ address: 1, chainId: 1 }, { unique: true });
tokenSchema.index({ creatorAddress: 1, chainId: 1 });
tokenSchema.index({ chainId: 1 });
tokenSchema.index({ createdAt: -1 });
tokenSchema.index({ currentPriceUSD: -1 });
tokenSchema.index({ marketCapUSD: -1 });
tokenSchema.index({ volume24hUSD: -1 });
tokenSchema.index({ isVerified: 1 }, { sparse: true });
tokenSchema.index({ isActive: 1 });
// Virtual for liquidity events count
tokenSchema.virtual('liquidityEventsCount', {
    ref: 'LiquidityEvent',
    localField: '_id',
    foreignField: 'tokenId',
    count: true
});
// Virtual for transactions count
tokenSchema.virtual('transactionsCount', {
    ref: 'Transaction',
    localField: '_id',
    foreignField: 'tokenId',
    count: true
});
// Virtual for holders count
tokenSchema.virtual('holdersCount', {
    ref: 'TokenHolder',
    localField: '_id',
    foreignField: 'tokenId',
    count: true
});
// Pre-save middleware to update the updatedAt field
tokenSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});
// Static method to find tokens by creator
tokenSchema.statics.findByCreator = function (creatorAddress) {
    return this.find({ creatorAddress: creatorAddress.toLowerCase() });
};
// Static method to find trending tokens
tokenSchema.statics.findTrending = function (limit = 10) {
    return this.find({ isActive: true })
        .sort({ volume24hUSD: -1, priceChange24hPercent: -1 })
        .limit(limit);
};
// Instance method to update price data
tokenSchema.methods.updatePriceData = function (priceData) {
    this.currentPrice = priceData.price;
    this.currentPriceUSD = priceData.priceUSD;
    this.marketCap = priceData.marketCap;
    this.marketCapUSD = priceData.marketCapUSD;
    this.volume24h = priceData.volume24h;
    this.volume24hUSD = priceData.volume24hUSD;
    this.priceChange24h = priceData.priceChange24h;
    this.priceChange24hPercent = priceData.priceChange24hPercent;
    this.updatedAt = new Date();
    return this.save();
};
const Token = mongoose_1.default.model('Token', tokenSchema);
exports.default = Token;
//# sourceMappingURL=Token.js.map