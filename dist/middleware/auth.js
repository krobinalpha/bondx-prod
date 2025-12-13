"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.optionalAuth = exports.verifyWalletOwnership = exports.requireOwnershipOrAdmin = exports.requireModerator = exports.requireAdmin = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_1 = __importDefault(require("../models/User"));
// Middleware to authenticate JWT token
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
        if (!token) {
            res.status(401).json({ error: 'Access token required' });
            return;
        }
        // Verify token
        const jwtSecret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
        // Get user from database
        const userId = decoded.userId;
        if (!userId) {
            res.status(401).json({ error: 'Invalid token format' });
            return;
        }
        const user = await User_1.default.findById(userId);
        if (!user || !user.isActive) {
            res.status(401).json({ error: 'Invalid or inactive user' });
            return;
        }
        // Add user to request object
        req.user = user;
        next();
    }
    catch (error) {
        if (error.name === 'JsonWebTokenError') {
            res.status(401).json({ error: 'Invalid token' });
            return;
        }
        else if (error.name === 'TokenExpiredError') {
            res.status(401).json({ error: 'Token expired' });
            return;
        }
        else {
            console.error('Auth middleware error:', error);
            res.status(500).json({ error: 'Authentication failed' });
            return;
        }
    }
};
exports.authenticateToken = authenticateToken;
// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
};
exports.requireAdmin = requireAdmin;
// Middleware to check if user is moderator or admin
const requireModerator = (req, res, next) => {
    if (!req.user || (req.user.role !== 'moderator' && req.user.role !== 'admin')) {
        res.status(403).json({ error: 'Moderator access required' });
        return;
    }
    next();
};
exports.requireModerator = requireModerator;
// Middleware to check if user owns the resource or is admin
const requireOwnershipOrAdmin = (resourceField = 'creatorAddress') => {
    return (req, res, next) => {
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
        const resourceAddress = req.params[resourceField] || req.body[resourceField];
        if (!resourceAddress) {
            res.status(400).json({ error: 'Resource identifier required' });
            return;
        }
        const userHasWallet = req.user.walletAddresses.some(wallet => wallet.address.toLowerCase() === resourceAddress.toLowerCase());
        if (!userHasWallet) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        next();
    };
};
exports.requireOwnershipOrAdmin = requireOwnershipOrAdmin;
// Middleware to verify wallet ownership
const verifyWalletOwnership = async (req, res, next) => {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress) {
            res.status(400).json({ error: 'Wallet address required' });
            return;
        }
        // Check if user has this wallet address
        const userHasWallet = req.user.walletAddresses.some(wallet => wallet.address.toLowerCase() === walletAddress.toLowerCase());
        if (!userHasWallet) {
            res.status(403).json({ error: 'Wallet address not associated with your account' });
            return;
        }
        next();
    }
    catch (error) {
        console.error('Wallet ownership verification error:', error);
        res.status(500).json({ error: 'Wallet verification failed' });
    }
};
exports.verifyWalletOwnership = verifyWalletOwnership;
// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, _res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            const user = await User_1.default.findById(decoded.userId);
            if (user && user.isActive) {
                req.user = user;
            }
        }
        next();
    }
    catch (error) {
        // Continue without authentication if token is invalid
        next();
    }
};
exports.optionalAuth = optionalAuth;
//# sourceMappingURL=auth.js.map