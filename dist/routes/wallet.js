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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ethers_1 = require("ethers");
const auth_1 = require("../middleware/auth");
const activityService_1 = require("../services/activityService");
const blockchain_1 = require("../config/blockchain");
const router = express_1.default.Router();
// Helper functions (same as tokenCreation.ts)
// @ts-expect-error - Function is intentionally unused but kept for future use
function _getRpcUrl(chainId) {
    const envKey = getRpcUrlEnvKey(chainId);
    return process.env[envKey] || process.env.RPC_URL || null;
}
function getRpcUrlEnvKey(chainId) {
    const keys = {
        1: 'MAINNET_RPC_URL',
        8453: 'BASE_RPC_URL',
        42161: 'ARBITRUM_RPC_URL',
        84532: 'BASE_SEPOLIA_RPC_URL',
    };
    return keys[chainId] || 'RPC_URL';
}
/**
 * POST /api/wallet/withdraw
 * Send ETH from embedded wallet to another address
 */
router.post('/withdraw', auth_1.authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user || !user._id) {
            return res.status(401).json({ error: 'Unauthorized - User not found' });
        }
        const { toAddress, amount, chainId } = req.body;
        if (!toAddress || !amount || !chainId) {
            return res.status(400).json({ error: 'Missing required fields: toAddress, amount, chainId' });
        }
        // Validate address format
        if (!ethers_1.ethers.isAddress(toAddress)) {
            return res.status(400).json({ error: 'Invalid recipient address format' });
        }
        let withdrawAmount;
        try {
            withdrawAmount = BigInt(amount);
            if (withdrawAmount <= 0n) {
                return res.status(400).json({ error: 'Amount must be greater than 0' });
            }
        }
        catch (error) {
            return res.status(400).json({ error: 'Invalid amount format' });
        }
        // Find embedded wallet
        let embeddedWallet = user.walletAddresses.find((w) => w.isSmartWallet === true);
        const primaryWalletAddress = user.walletAddresses.find((w) => w.isPrimary)?.address;
        if (!embeddedWallet && primaryWalletAddress) {
            embeddedWallet = user.walletAddresses.find((w) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase());
            if (embeddedWallet && !embeddedWallet.isSmartWallet) {
                embeddedWallet.isSmartWallet = true;
                await user.save();
            }
        }
        if (!embeddedWallet) {
            return res.status(400).json({
                error: 'No embedded wallet found. Please connect a wallet to withdraw funds.'
            });
        }
        // Generate wallet from user credentials
        const userId = user._id.toString();
        const userEmail = user.email.toLowerCase().trim();
        const jwtSecret = process.env.JWT_SECRET || 'default-secret';
        const seed = `${userId}-${userEmail}-${jwtSecret}`;
        const privateKey = ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(seed));
        const wallet = new ethers_1.ethers.Wallet(privateKey);
        // Verify wallet address matches
        if (wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
            embeddedWallet.address = wallet.address.toLowerCase();
            await user.save();
        }
        // Connect to provider (using getProvider to ensure staticNetwork option is set)
        const provider = (0, blockchain_1.getProvider)(chainId);
        const signer = wallet.connect(provider);
        // Check balance
        const balance = await provider.getBalance(wallet.address);
        const estimatedGasPrice = await provider.getFeeData();
        const gasPrice = estimatedGasPrice.gasPrice || 0n;
        const estimatedGasLimit = 21000n; // Standard ETH transfer gas limit
        const gasCost = gasPrice * estimatedGasLimit;
        const totalRequired = withdrawAmount + gasCost;
        if (balance < totalRequired) {
            return res.status(400).json({
                error: `Insufficient balance. Required: ${ethers_1.ethers.formatEther(totalRequired)} ETH, Available: ${ethers_1.ethers.formatEther(balance)} ETH`,
                balance: ethers_1.ethers.formatEther(balance),
                required: ethers_1.ethers.formatEther(totalRequired),
                address: wallet.address,
            });
        }
        // Prevent sending to self
        if (wallet.address.toLowerCase() === toAddress.toLowerCase()) {
            return res.status(400).json({ error: 'Cannot send ETH to your own address' });
        }
        // Execute transfer transaction
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');
        const tx = await signer.sendTransaction({
            to: toAddress,
            value: withdrawAmount,
            gasLimit: estimatedGasLimit,
            nonce: nonce,
        });
        const receipt = await tx.wait();
        // Get block timestamp
        let blockTimestamp = new Date();
        if (receipt?.blockNumber) {
            try {
                const block = await provider.getBlock(receipt.blockNumber);
                if (block?.timestamp) {
                    blockTimestamp = new Date(block.timestamp * 1000);
                }
            }
            catch (error) {
                console.error('Error getting block timestamp:', error);
                // Use current time as fallback
            }
        }
        // Calculate actual gas cost from receipt
        const gasUsed = receipt?.gasUsed?.toString() || '0';
        const actualGasCost = receipt ? (receipt.gasUsed * receipt.gasPrice).toString() : '0';
        // Save withdrawal activity
        try {
            await (0, activityService_1.saveActivity)({
                type: 'withdraw',
                walletAddress: wallet.address,
                fromAddress: wallet.address,
                toAddress: toAddress,
                amount: withdrawAmount.toString(),
                txHash: tx.hash,
                blockNumber: receipt?.blockNumber || 0,
                blockTimestamp: blockTimestamp,
                chainId: chainId,
                status: 'confirmed',
                gasUsed: gasUsed,
                gasCost: actualGasCost,
                userId: user._id.toString()
            });
            // Emit WebSocket events for real-time updates
            try {
                const { emitWithdrawDetected, emitBalanceUpdate } = await Promise.resolve().then(() => __importStar(require('../socket/updateEmitter')));
                // Emit withdraw detected event
                emitWithdrawDetected({
                    walletAddress: wallet.address,
                    toAddress: toAddress,
                    amount: withdrawAmount.toString(),
                    amountFormatted: ethers_1.ethers.formatEther(withdrawAmount),
                    txHash: tx.hash,
                    blockNumber: receipt?.blockNumber || 0,
                    blockTimestamp: blockTimestamp,
                    chainId: chainId,
                    userId: user._id.toString()
                });
                // Fetch fresh balance and emit balance update (Binance-like approach)
                try {
                    const freshBalance = await provider.getBalance(wallet.address);
                    const balanceFormatted = ethers_1.ethers.formatEther(freshBalance);
                    emitBalanceUpdate({
                        walletAddress: wallet.address,
                        balance: freshBalance.toString(),
                        balanceFormatted: balanceFormatted,
                        chainId: chainId,
                        userId: user._id.toString(),
                    });
                    console.log(`✅ Balance update sent to user ${user._id} after withdrawal`, {
                        walletAddress: wallet.address,
                        balance: balanceFormatted,
                        chainId
                    });
                }
                catch (balanceError) {
                    // Don't fail withdrawal if balance fetch fails
                    console.warn(`Failed to fetch/emit balance update after withdrawal`, {
                        error: balanceError.message,
                        walletAddress: wallet.address,
                        chainId
                    });
                }
            }
            catch (wsError) {
                // Log error but don't fail the withdrawal
                console.error('Error emitting WebSocket events for withdrawal:', wsError);
            }
        }
        catch (activityError) {
            // Log error but don't fail the withdrawal
            console.error('Error saving withdrawal activity:', activityError);
        }
        res.json({
            success: true,
            txHash: tx.hash,
            receipt: {
                blockNumber: receipt?.blockNumber,
                blockHash: receipt?.blockHash,
                transactionHash: receipt?.hash,
            },
            from: wallet.address,
            to: toAddress,
            amount: ethers_1.ethers.formatEther(withdrawAmount),
        });
    }
    catch (error) {
        console.error('Error withdrawing funds:', error);
        res.status(500).json({
            error: 'Failed to withdraw funds',
            message: error.message || 'Unknown error',
            details: error.reason || error.code,
        });
    }
});
exports.default = router;
//# sourceMappingURL=wallet.js.map