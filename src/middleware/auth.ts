import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { AuthRequest, JWTPayload } from '../types';

// Middleware to authenticate JWT token
export const authenticateToken = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ error: 'Access token required' });
      return;
    }

    // Verify token
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const decoded = jwt.verify(token, jwtSecret) as any;
    
    // Get user from database
    const userId = decoded.userId;
    if (!userId) {
      res.status(401).json({ error: 'Invalid token format' });
      return;
    }
    
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Invalid or inactive user' });
      return;
    }

    // Add user to request object
    req.user = user;
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({ error: 'Invalid token' });
      return;
    } else if (error.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired' });
      return;
    } else {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Authentication failed' });
      return;
    }
  }
};

// Middleware to check if user is admin
export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
};

// Middleware to check if user is moderator or admin
export const requireModerator = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || (req.user.role !== 'moderator' && req.user.role !== 'admin')) {
    res.status(403).json({ error: 'Moderator access required' });
    return;
  }
  next();
};

// Middleware to check if user owns the resource or is admin
export const requireOwnershipOrAdmin = (resourceField: string = 'creatorAddress') => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Admin can access everything
    if (req.user.role === 'admin') {
      next();
      return;
    }

    // Check if user owns the resource
    const resourceAddress = (req.params as any)[resourceField] || req.body[resourceField];
    if (!resourceAddress) {
      res.status(400).json({ error: 'Resource identifier required' });
      return;
    }

    const userHasWallet = req.user.walletAddresses.some(
      wallet => wallet.address.toLowerCase() === resourceAddress.toLowerCase()
    );

    if (!userHasWallet) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    next();
  };
};

// Middleware to verify wallet ownership
export const verifyWalletOwnership = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      res.status(400).json({ error: 'Wallet address required' });
      return;
    }

    // Check if user has this wallet address
    const userHasWallet = req.user!.walletAddresses.some(
      wallet => wallet.address.toLowerCase() === walletAddress.toLowerCase()
    );

    if (!userHasWallet) {
      res.status(403).json({ error: 'Wallet address not associated with your account' });
      return;
    }

    next();
  } catch (error) {
    console.error('Wallet ownership verification error:', error);
    res.status(500).json({ error: 'Wallet verification failed' });
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JWTPayload;
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

