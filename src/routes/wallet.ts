import express, { Response } from 'express';
import { ethers } from 'ethers';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

// Helper functions (same as tokenCreation.ts)
function getRpcUrl(chainId: number): string | null {
  const envKey = getRpcUrlEnvKey(chainId);
  return process.env[envKey] || process.env.RPC_URL || null;
}

function getRpcUrlEnvKey(chainId: number): string {
  const keys: Record<number, string> = {
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
router.post('/withdraw', authenticateToken, async (req: AuthRequest, res: Response): Promise<Response | void> => {
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
    if (!ethers.isAddress(toAddress)) {
      return res.status(400).json({ error: 'Invalid recipient address format' });
    }

    let withdrawAmount: bigint;
    try {
      withdrawAmount = BigInt(amount);
      if (withdrawAmount <= 0n) {
        return res.status(400).json({ error: 'Amount must be greater than 0' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Invalid amount format' });
    }

    // Find embedded wallet
    let embeddedWallet = user.walletAddresses.find((w: any) => w.isSmartWallet === true);
    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    if (!embeddedWallet && primaryWalletAddress) {
      embeddedWallet = user.walletAddresses.find(
        (w: any) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase()
      );
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

    // Get RPC URL
    const rpcUrl = getRpcUrl(chainId);
    if (!rpcUrl) {
      return res.status(400).json({ error: `RPC URL not configured for chain ${chainId}` });
    }

    // Generate wallet from user credentials
    const userId = user._id.toString();
    const userEmail = user.email.toLowerCase().trim();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    const seed = `${userId}-${userEmail}-${jwtSecret}`;
    const privateKey = ethers.keccak256(ethers.toUtf8Bytes(seed));
    const wallet = new ethers.Wallet(privateKey);

    // Verify wallet address matches
    if (wallet.address.toLowerCase() !== embeddedWallet.address.toLowerCase()) {
      embeddedWallet.address = wallet.address.toLowerCase();
      await user.save();
    }

    // Connect to provider
    const provider = new ethers.JsonRpcProvider(rpcUrl);
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
        error: `Insufficient balance. Required: ${ethers.formatEther(totalRequired)} ETH, Available: ${ethers.formatEther(balance)} ETH`,
        balance: ethers.formatEther(balance),
        required: ethers.formatEther(totalRequired),
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
      amount: ethers.formatEther(withdrawAmount),
    });
  } catch (error: any) {
    console.error('Error withdrawing funds:', error);
    res.status(500).json({ 
      error: 'Failed to withdraw funds',
      message: error.message || 'Unknown error',
      details: error.reason || error.code,
    });
  }
});

export default router;

