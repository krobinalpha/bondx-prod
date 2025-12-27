import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import { SiweMessage } from 'siwe';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User';
import crypto from 'crypto';
import { sendEmail, generateVerificationEmail, generateVerificationEmailText } from '../services/emailService';
import { authenticateToken } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = express.Router();

// Initialize Google OAuth2 Client
const googleOAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.DOMAIN || 'http://localhost:5000'}/api/auth/social/google/callback`
);

// In-memory store for nonces and email codes (use Redis in production)
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();
const emailCodeStore = new Map<string, { code: string; expiresAt: number; attempts: number }>();

// Make emailCodeStore available globally for debug endpoint (development only)
if (process.env.NODE_ENV !== 'production') {
  (global as any).emailCodeStore = emailCodeStore;
}

// Clean up expired entries every 5 minutes
// Store interval ID for cleanup on server shutdown
let cleanupInterval: NodeJS.Timeout | null = null;

const startCleanupInterval = (): void => {
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of nonceStore.entries()) {
      if (value.expiresAt < now) {
        nonceStore.delete(key);
      }
    }
    for (const [key, value] of emailCodeStore.entries()) {
      if (value.expiresAt < now) {
        emailCodeStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
};

// Export cleanup function for server shutdown
export const cleanupAuthStores = (): void => {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
};

// Start the cleanup interval
startCleanupInterval();

// Generate JWT token
const generateToken = (userId: string, address?: string, email?: string): string => {
  return jwt.sign(
    { userId, address, email },
    process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    { expiresIn: '30d' }
  );
};

// Helper function to generate random username
// Format: bondx_{7 hex digits} - 268.4 million combinations
const generateRandomUsername = async (): Promise<string> => {
  const maxAttempts = 20;
  let attempts = 0;
  let username: string;
  let exists: boolean | null = true;
  
  // Generate random 7-digit hex number (268.4 million combinations)
  while (exists && attempts < maxAttempts) {
    // Generate random number and convert to hex (7 digits = 28 bits)
    const randomNum = Math.floor(Math.random() * 0xFFFFFFF); // 28-bit = 7 hex digits max
    const hexString = randomNum.toString(16).padStart(7, '0'); // Ensure 7 digits
    username = `bondx_${hexString}`;
    
    exists = await User.findOne({ username });
    attempts++;
    
    if (!exists) {
      return username;
    }
  }
  
  // Fallback: Use timestamp + random hex (guaranteed unique)
  const timestamp = Date.now().toString(16).slice(-5); // Last 5 hex digits of timestamp
  const random = Math.floor(Math.random() * 0xFFF).toString(16).padStart(2, '0'); // 2 hex digits
  username = `bondx_${timestamp}${random}`;
  
  // Final check
  exists = await User.findOne({ username });
  if (exists) {
    // Last resort: timestamp + more random
    username = `bondx_${Date.now().toString(16).slice(-4)}${Math.floor(Math.random() * 0xFFF).toString(16).padStart(3, '0')}`;
  }
  
  return username;
};

// POST /api/auth/nonce - Generate nonce for wallet authentication
router.post('/nonce', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { address } = req.body;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    nonceStore.set(address.toLowerCase(), { nonce, expiresAt });

    res.json({ nonce });
  } catch (error) {
    console.error('Error generating nonce:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/verify-wallet - Verify wallet signature (SIWE)
router.post('/verify-wallet', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { message, signature, address } = req.body;

    if (!message || !signature || !address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate signature format (EIP-191: 0x + 130 hex characters = 132 total)
    if (!signature.startsWith('0x') || signature.length !== 132) {
      console.error('Invalid signature format received:', {
        length: signature?.length,
        startsWith0x: signature?.startsWith('0x'),
        preview: signature?.substring(0, 50),
        address: address
      });
      return res.status(400).json({ 
        error: 'Invalid signature format',
        details: process.env.NODE_ENV === 'development' 
          ? `Expected 132 characters (0x + 130 hex), got ${signature?.length || 0}. The wallet may not support message signing correctly.` 
          : undefined
      });
    }

    // Verify signature using SIWE
    try {
      // Parse the SIWE message
      const siweMessage = new SiweMessage(message);
      
      // Get the expected domain - be more flexible with localhost
      const requestHost = req.get('host') || '';
      const expectedDomain = process.env.DOMAIN || requestHost;
      
      // For localhost, don't enforce strict domain matching
      const isLocalhost = expectedDomain.includes('localhost') || 
                         expectedDomain.includes('127.0.0.1') ||
                         expectedDomain.includes('::1');
      
      // Verify the message and signature
      // Don't pass domain for localhost to avoid strict matching issues
      const verifyParams: any = {
        signature: signature,
      };
      
      // Only verify domain if not localhost (or if explicitly set in production)
      if (!isLocalhost && expectedDomain) {
        verifyParams.domain = expectedDomain;
      }
      
      const result = await siweMessage.verify(verifyParams);
      
      // Check if verification was successful
      if (!result.success) {
        console.error('SIWE verification failed:', {
          error: result.error?.type,
          expected: result.error?.expected,
          received: result.error?.received,
          address: address,
          messageDomain: siweMessage.domain,
          expectedDomain: expectedDomain,
          isLocalhost: isLocalhost
        });
        return res.status(401).json({ 
          error: 'Signature verification failed',
          details: process.env.NODE_ENV === 'development' ? result.error?.type : undefined
        });
      }
      
      // Check if the recovered address matches the provided address
      if (result.data.address.toLowerCase() !== address.toLowerCase()) {
        console.error('Address mismatch:', {
          recovered: result.data.address,
          provided: address
        });
        return res.status(401).json({ error: 'Invalid signature: address mismatch' });
      }
      
    } catch (error: any) {
      // Better error logging - handle different error types
      const errorDetails: any = {
        errorType: error?.constructor?.name || typeof error,
        messagePreview: typeof message === 'string' ? message.substring(0, 200) : 'Not a string'
      };
      
      // Try to extract error information from different possible formats
      if (error?.message) errorDetails.message = error.message;
      if (error?.stack) errorDetails.stack = error.stack;
      if (error?.toString) errorDetails.toString = error.toString();
      if (error?.type) errorDetails.type = error.type;
      if (error?.code) errorDetails.code = error.code;
      
      // Log the full error object for debugging
      console.error('SIWE verification error:', errorDetails);
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      return res.status(401).json({ 
        error: 'Signature verification failed',
        details: process.env.NODE_ENV === 'development' 
          ? (errorDetails.message || errorDetails.toString || errorDetails.type || 'Unknown error') 
          : undefined
      });
    }

    // Find or create user
    let user = await User.findByWalletAddress(address);

    if (!user) {
      // Create new user with wallet
      const username = await generateRandomUsername();
      user = new User({
        username,
        email: `${address.toLowerCase()}@wallet.local`, // Placeholder email
        password: crypto.randomBytes(32).toString('hex'), // Random password for wallet users
        walletAddresses: [{
          address: address.toLowerCase(),
          isPrimary: true,
          verifiedAt: new Date(),
        }],
      });
      await user.save();
    } else {
      // Add wallet if not exists
      const walletExists = user.walletAddresses.some(
        w => w.address.toLowerCase() === address.toLowerCase()
      );
      if (!walletExists) {
        await user.addWalletAddress(address);
        await user.verifyWallet(address);
      }
    }

    // Generate token
    const token = generateToken(user._id.toString(), address);

    res.json({
      token,
      user: {
        id: user._id,
        address,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Error verifying wallet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/send-email-code - Send verification code to email
router.post('/send-email-code', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { email } = req.body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Generate 6-digit code (ensure it's always a string with no extra characters)
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store code with normalized email (ensure code is clean - only digits)
    const cleanCode = code.replace(/\D/g, '').trim();
    emailCodeStore.set(normalizedEmail, { code: cleanCode, expiresAt, attempts: 0 });
    

    // Send email with verification code
    try {
      await sendEmail({
        to: email,
        subject: 'Your BondX Verification Code',
        html: generateVerificationEmail(code),
        text: generateVerificationEmailText(code),
      });
    } catch (emailError: any) {
      // If SendGrid is not configured, fall back to console log for development
      if (!process.env.SENDGRID_API_KEY || process.env.NODE_ENV === 'development') {
      } else {
        // In production, if email fails, we should still return success to prevent email enumeration
        // but log the error for monitoring
        console.error('Failed to send verification email:', emailError.message);
        // Don't throw - we don't want to reveal if an email exists or not
      }
    }

    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/verify-email-code - Verify email code and sign in
router.post('/verify-email-code', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize email: lowercase and trim
    const normalizedEmail = email.toLowerCase().trim();
    
    // Normalize code: remove all non-digit characters (spaces, dashes, etc.) and ensure it's a string
    const normalizedCode = String(code).replace(/\D/g, '').trim();

    // Validate code format (should be exactly 6 digits)
    if (!normalizedCode || normalizedCode.length !== 6 || !/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ 
        error: 'Invalid code format', 
        details: 'Code must be exactly 6 digits' 
      });
    }

    const stored = emailCodeStore.get(normalizedEmail);

    if (!stored) {
      return res.status(400).json({ 
        error: 'Code expired or not found',
        details: 'Please request a new verification code'
      });
    }

    if (stored.expiresAt < Date.now()) {
      emailCodeStore.delete(normalizedEmail);
      return res.status(400).json({ 
        error: 'Code expired',
        details: 'Verification codes expire after 10 minutes. Please request a new code.'
      });
    }

    if (stored.attempts >= 5) {
      emailCodeStore.delete(normalizedEmail);
      return res.status(429).json({ 
        error: 'Too many attempts. Please request a new code.',
        details: 'For security, you can only attempt verification 5 times per code.'
      });
    }

    stored.attempts++;

    // Normalize stored code (remove any non-digit characters, just in case)
    const storedCodeStr = String(stored.code).replace(/\D/g, '').trim();
    
    // Compare codes (both should be normalized 6-digit strings now)
    if (storedCodeStr !== normalizedCode) {
      return res.status(401).json({ 
        error: 'Invalid verification code',
        details: `Code does not match. Attempts remaining: ${5 - stored.attempts}`,
        attemptsRemaining: 5 - stored.attempts,
      });
    }

    // Code verified successfully

    // Code verified, find or create user
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Create new user with email
      const username = await generateRandomUsername();
      const tempPassword = crypto.randomBytes(32).toString('hex');
      
      user = new User({
        username,
        email: email.toLowerCase(),
        password: tempPassword,
      });
      await user.save();
    }

    // Create or get embedded wallet for email user
    let embeddedWalletAddress: string | undefined;
    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    if (!primaryWalletAddress) {
      // Generate deterministic private key from email + userId
      // This creates a predictable private key that can be used for embedded wallet
      // IMPORTANT: This must match the logic in tokenCreation.ts exactly
      const userId = user._id.toString();
      const normalizedEmail = email.toLowerCase().trim();
      const jwtSecret = process.env.JWT_SECRET || 'default-secret';
      
      // Generate seed string
      const seed = `${userId}-${normalizedEmail}-${jwtSecret}`;
      
      // Generate private key using keccak256 (same as ethers.js)
      const privateKey = ethers.keccak256(ethers.toUtf8Bytes(seed));
      
      // Create wallet from private key to get the address
      const wallet = new ethers.Wallet(privateKey);
      embeddedWalletAddress = wallet.address;
      
      // Add wallet to user (mark as smart wallet)
      await user.addWalletAddress(embeddedWalletAddress, true);
      await user.verifyWallet(embeddedWalletAddress);
      await user.setPrimaryWallet(embeddedWalletAddress);
      
      // Add wallet to activity monitoring on all configured chains
      const { addWalletToMonitoring } = await import('../services/activityMonitor');
      const { getConfiguredChains } = await import('../config/blockchain');
      const chains = getConfiguredChains();
      
      for (const chainId of chains) {
        await addWalletToMonitoring(embeddedWalletAddress, chainId, user._id.toString()).catch(error => {
          console.error(`Error adding wallet to monitoring on chain ${chainId}:`, error);
          // Don't fail the request if monitoring fails
        });
      }
    } else {
      embeddedWalletAddress = primaryWalletAddress;
      
      // If user already has a primary wallet but it's not marked as smart wallet,
      // mark it now (for users who logged in before we added this field)
      const primaryWalletObj = user.walletAddresses.find(
        (w: any) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase()
      );
      if (primaryWalletObj && !primaryWalletObj.isSmartWallet) {
        primaryWalletObj.isSmartWallet = true;
        await user.save();
      }
      
      // Ensure wallet is being monitored (might have been created before monitoring started)
      const { addWalletToMonitoring } = await import('../services/activityMonitor');
      const { getConfiguredChains } = await import('../config/blockchain');
      const chains = getConfiguredChains();
      
      for (const chainId of chains) {
        await addWalletToMonitoring(embeddedWalletAddress, chainId, user._id.toString()).catch(error => {
          // Ignore errors (wallet might already be monitored)
          if (!error.message?.includes('already being monitored')) {
            console.error(`Error ensuring wallet monitoring on chain ${chainId}:`, error);
          }
        });
      }
    }

    // Generate token
    const token = generateToken(user._id.toString(), embeddedWalletAddress, email);

    // Clean up code
    emailCodeStore.delete(normalizedEmail);

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        address: embeddedWalletAddress,
        embeddedWallet: true, // Flag to indicate this is an embedded wallet
      },
    });
  } catch (error) {
    console.error('Error verifying email code:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    ) as { userId: string; address?: string; email?: string };

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Ensure username exists (generate if missing for edge cases)
    if (!user.username || user.username.trim() === '') {
      user.username = await generateRandomUsername();
      await user.save();
    }

    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      address: primaryWalletAddress,
      avatar: user.avatar,
      walletAddresses: user.walletAddresses,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// POST /api/auth/smart-wallet - Create or get smart wallet for user
router.post('/smart-wallet', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your-secret-key-change-in-production'
    ) as { userId: string; address?: string; email?: string };

    const { chainId } = req.body;
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get or create embedded wallet
    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    let walletAddress = primaryWalletAddress;
    
    if (!walletAddress && decoded.email) {
      // Generate deterministic private key
      // IMPORTANT: This must match the logic in verify-email-code and tokenCreation.ts exactly
      const userId = user._id.toString();
      const normalizedEmail = decoded.email.toLowerCase().trim();
      const jwtSecret = process.env.JWT_SECRET || 'default-secret';
      
      // Generate seed string
      const seed = `${userId}-${normalizedEmail}-${jwtSecret}`;
      
      // Generate private key using keccak256 (same as ethers.js)
      const privateKey = ethers.keccak256(ethers.toUtf8Bytes(seed));
      
      // Create wallet from private key to get the address
      const wallet = new ethers.Wallet(privateKey);
      walletAddress = wallet.address;
      
      // Add wallet to user (mark as smart wallet)
      await user.addWalletAddress(walletAddress, true);
      await user.verifyWallet(walletAddress);
      await user.setPrimaryWallet(walletAddress);
      
      // Add wallet to activity monitoring on all configured chains
      const { addWalletToMonitoring } = await import('../services/activityMonitor');
      const { getConfiguredChains } = await import('../config/blockchain');
      const chains = getConfiguredChains();
      
      for (const chainId of chains) {
        await addWalletToMonitoring(walletAddress, chainId, user._id.toString()).catch(error => {
          console.error(`Error adding wallet to monitoring on chain ${chainId}:`, error);
          // Don't fail the request if monitoring fails
        });
      }
    }

    res.json({
      address: walletAddress,
      chainId: chainId || parseInt(process.env.CHAIN_ID || '8453'),
    });
  } catch (error) {
    console.error('Error creating/getting smart wallet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/embedded-wallet-address - Get the embedded wallet address for the authenticated user
router.get('/embedded-wallet-address', authenticateToken, async (req: AuthRequest, res: Response): Promise<Response | void> => {
  try {
    const user = req.user;
    if (!user || !user._id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Find embedded wallet
    let embeddedWallet = user.walletAddresses.find((w: any) => w.isSmartWallet === true);
    const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
    
    if (!embeddedWallet && primaryWalletAddress) {
      embeddedWallet = user.walletAddresses.find(
        (w: any) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase()
      );
    }

    if (!embeddedWallet) {
      return res.status(404).json({ 
        error: 'No embedded wallet found',
        message: 'Please log in with email to create an embedded wallet'
      });
    }

    // Generate the address using the same logic as token creation
    const userId = user._id.toString();
    const userEmail = (user.email || '').toLowerCase().trim();
    const jwtSecret = process.env.JWT_SECRET || 'default-secret';
    
    const seed = `${userId}-${userEmail}-${jwtSecret}`;
    const privateKey = ethers.keccak256(ethers.toUtf8Bytes(seed));
    const wallet = new ethers.Wallet(privateKey);
    const generatedAddress = wallet.address;

    // Get chain ID from request or default
    const chainId = parseInt(req.query.chainId as string) || parseInt(process.env.CHAIN_ID || '84532');

    res.json({
      address: generatedAddress,
      storedAddress: embeddedWallet.address,
      matches: generatedAddress.toLowerCase() === embeddedWallet.address.toLowerCase(),
      chainId: chainId,
      message: `Your embedded wallet address is ${generatedAddress}. Send ETH to this address to create tokens.`,
      explorerUrl: `https://sepolia.basescan.org/address/${generatedAddress}`,
    });
  } catch (error) {
    console.error('Error getting embedded wallet address:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/social/:provider - Initiate social OAuth flow
router.post('/social/:provider', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { provider } = req.params;
    const { redirectUri } = req.body;

    const validProviders = ['google', 'apple'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    if (provider === 'google') {
      // Check if Google OAuth is configured
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.' 
        });
      }

      // Generate OAuth URL
      const frontendRedirectUri = redirectUri || process.env.DOMAIN || 'http://localhost:3000';
      const scopes = ['profile', 'email'];
      const authUrl = googleOAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        state: Buffer.from(JSON.stringify({ redirectUri: frontendRedirectUri })).toString('base64'),
        prompt: 'consent',
      });

      return res.json({
        redirectUrl: authUrl,
      });
    }

    // For other providers (Apple, etc.) - return not implemented
    res.json({
      message: `Social login with ${provider} is not yet implemented. Please use email authentication for now.`,
    });
  } catch (error) {
    console.error('Error initiating social login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/social/:provider/callback - Handle OAuth callback
router.get('/social/:provider/callback', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { provider } = req.params;
    const { code, state } = req.query;

    if (provider === 'google') {
      if (!code) {
        return res.status(400).json({ error: 'Authorization code not provided' });
      }

      // Check if Google OAuth is configured
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ 
          error: 'Google OAuth is not configured' 
        });
      }

      // Exchange code for tokens
      const { tokens } = await googleOAuth2Client.getToken(code as string);
      googleOAuth2Client.setCredentials(tokens);

      // Get user info from Google
      const ticket = await googleOAuth2Client.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      if (!payload) {
        return res.status(400).json({ error: 'Failed to get user info from Google' });
      }

      const googleEmail = payload.email;
      const googlePicture = payload.picture || '';

      if (!googleEmail) {
        return res.status(400).json({ error: 'Email not provided by Google' });
      }

      // Find or create user
      let user = await User.findOne({ email: googleEmail.toLowerCase() });

      if (!user) {
        // Create new user with Google account
        const username = await generateRandomUsername();
        const tempPassword = crypto.randomBytes(32).toString('hex');

        user = new User({
          username,
          email: googleEmail.toLowerCase(),
          password: tempPassword,
          avatar: googlePicture,
        });
        await user.save();
      } else {
        // Update avatar if user exists and doesn't have one
        if (!user.avatar && googlePicture) {
          user.avatar = googlePicture;
          await user.save();
        }
      }

      // Create or get embedded wallet for Google user
      let embeddedWalletAddress: string | undefined;
      const primaryWalletAddress = user.walletAddresses.find((w: any) => w.isPrimary)?.address;
      
      if (!primaryWalletAddress) {
        // Generate deterministic private key from email + userId
        const userId = user._id.toString();
        const normalizedEmail = googleEmail.toLowerCase().trim();
        const jwtSecret = process.env.JWT_SECRET || 'default-secret';
        
        // Generate seed string
        const seed = `${userId}-${normalizedEmail}-${jwtSecret}`;
        
        // Generate private key using keccak256
        const privateKey = ethers.keccak256(ethers.toUtf8Bytes(seed));
        
        // Create wallet from private key to get the address
        const wallet = new ethers.Wallet(privateKey);
        embeddedWalletAddress = wallet.address;
        
        // Add wallet to user (mark as smart wallet)
        await user.addWalletAddress(embeddedWalletAddress, true);
        await user.verifyWallet(embeddedWalletAddress);
        await user.setPrimaryWallet(embeddedWalletAddress);
        
        // Add wallet to activity monitoring on all configured chains
        const { addWalletToMonitoring } = await import('../services/activityMonitor');
        const { getConfiguredChains } = await import('../config/blockchain');
        const chains = getConfiguredChains();
        
        for (const chainId of chains) {
          await addWalletToMonitoring(embeddedWalletAddress, chainId, user._id.toString()).catch(error => {
            console.error(`Error adding wallet to monitoring on chain ${chainId}:`, error);
            // Don't fail the request if monitoring fails
          });
        }
      } else {
        embeddedWalletAddress = primaryWalletAddress;
        
        // If user already has a primary wallet but it's not marked as smart wallet, mark it now
        const primaryWalletObj = user.walletAddresses.find(
          (w: any) => w.address.toLowerCase() === primaryWalletAddress.toLowerCase()
        );
        if (primaryWalletObj && !primaryWalletObj.isSmartWallet) {
          primaryWalletObj.isSmartWallet = true;
          await user.save();
        }
        
        // Ensure wallet is being monitored (might have been created before monitoring started)
        const { addWalletToMonitoring } = await import('../services/activityMonitor');
        const { getConfiguredChains } = await import('../config/blockchain');
        const chains = getConfiguredChains();
        
        for (const chainId of chains) {
          await addWalletToMonitoring(embeddedWalletAddress, chainId, user._id.toString()).catch(error => {
            // Ignore errors (wallet might already be monitored)
            if (!error.message?.includes('already being monitored')) {
              console.error(`Error ensuring wallet monitoring on chain ${chainId}:`, error);
            }
          });
        }
      }

      // Generate JWT token
      const token = generateToken(user._id.toString(), embeddedWalletAddress, googleEmail);

      // Parse state to get frontend redirect URI
      let frontendRedirectUri = process.env.DOMAIN || 'http://localhost:3000';
      try {
        if (state) {
          const decodedState = JSON.parse(Buffer.from(state as string, 'base64').toString());
          frontendRedirectUri = decodedState.redirectUri || frontendRedirectUri;
        }
      } catch (e) {
        // Use default if state parsing fails
      }

      // Redirect to frontend with token
      const redirectUrl = new URL(frontendRedirectUri);
      redirectUrl.searchParams.set('token', token);
      redirectUrl.searchParams.set('email', googleEmail);
      redirectUrl.searchParams.set('provider', 'google');

      return res.redirect(redirectUrl.toString());
    }

    // For other providers - return not implemented
    res.json({
      message: `OAuth callback for ${provider} is not yet implemented.`,
    });
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
