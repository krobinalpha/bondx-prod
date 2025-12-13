"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const User_1 = __importDefault(require("../models/User"));
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
// Helper function to generate random username (same as in auth.ts)
// Format: bondx_{7 hex digits} - 268.4 million combinations
const generateRandomUsername = async () => {
    const maxAttempts = 20;
    let attempts = 0;
    let username;
    let exists = true;
    // Generate random 7-digit hex number (268.4 million combinations)
    while (exists && attempts < maxAttempts) {
        // Generate random number and convert to hex (7 digits = 28 bits)
        const randomNum = Math.floor(Math.random() * 0xFFFFFFF); // 28-bit = 7 hex digits max
        const hexString = randomNum.toString(16).padStart(7, '0'); // Ensure 7 digits
        username = `bondx_${hexString}`;
        exists = await User_1.default.findOne({ username });
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
    exists = await User_1.default.findOne({ username });
    if (exists) {
        // Last resort: timestamp + more random
        username = `bondx_${Date.now().toString(16).slice(-4)}${Math.floor(Math.random() * 0xFFF).toString(16).padStart(3, '0')}`;
    }
    return username;
};
// GET /api/users/:address - Get user by wallet address
router.get('/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
            return res.status(400).json({ error: 'Invalid wallet address' });
        }
        const user = await User_1.default.findByWalletAddress(address);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Ensure username exists (generate if missing for edge cases)
        if (!user.username || user.username.trim() === '') {
            user.username = await generateRandomUsername();
            await user.save();
            console.log(`✅ Generated random username for user ${user._id}: ${user.username}`);
        }
        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            bio: user.bio,
            avatar: user.avatar,
            address: user.walletAddresses.find((w) => w.isPrimary)?.address,
            walletAddresses: user.walletAddresses,
            website: user.website,
            twitter: user.twitter,
            telegram: user.telegram,
            discord: user.discord,
            github: user.github,
            tokensCreated: user.tokensCreated,
            totalVolume: user.totalVolume,
            totalVolumeUSD: user.totalVolumeUSD,
            isVerified: user.isVerified,
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});
// PATCH /api/users/profile - Update user profile
router.patch('/profile', auth_1.authenticateToken, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { username, bio, avatar, website, twitter, telegram, discord, github } = req.body;
        const user = await User_1.default.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Update fields if provided
        if (username !== undefined) {
            // Check if username is already taken by another user
            const existingUser = await User_1.default.findOne({
                username: username.trim(),
                _id: { $ne: userId }
            });
            if (existingUser) {
                return res.status(400).json({ error: 'Username already taken' });
            }
            user.username = username.trim();
        }
        if (bio !== undefined) {
            user.bio = bio.substring(0, 500); // Enforce max length
        }
        if (avatar !== undefined) {
            user.avatar = avatar;
        }
        if (website !== undefined) {
            user.website = website;
        }
        if (twitter !== undefined) {
            user.twitter = twitter;
        }
        if (telegram !== undefined) {
            user.telegram = telegram;
        }
        if (discord !== undefined) {
            user.discord = discord;
        }
        if (github !== undefined) {
            user.github = github;
        }
        await user.save();
        res.json({
            id: user._id,
            username: user.username,
            email: user.email,
            bio: user.bio,
            avatar: user.avatar,
            address: user.walletAddresses.find((w) => w.isPrimary)?.address,
            website: user.website,
            twitter: user.twitter,
            telegram: user.telegram,
            discord: user.discord,
            github: user.github,
        });
    }
    catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ error: 'Username already taken' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map