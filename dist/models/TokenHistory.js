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
const historySchema = new mongoose_1.Schema({
    // Address information
    tokenAddress: {
        type: String,
        required: true,
        lowercase: true
    },
    tokenId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
const TokenHistory = mongoose_1.default.model('TokenHistory', historySchema);
exports.default = TokenHistory;
//# sourceMappingURL=TokenHistory.js.map