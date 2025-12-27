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
const express_validator_1 = require("express-validator");
const validation_1 = require("../middleware/validation");
const activityService_1 = require("../services/activityService");
const activityMonitor_1 = require("../services/activityMonitor");
const router = express_1.default.Router();
// GET /api/activities/:walletAddress - Get activities for a wallet address
router.get('/:walletAddress', [
    (0, express_validator_1.param)('walletAddress').custom(validation_1.validateAddress).withMessage('Invalid wallet address'),
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    (0, express_validator_1.query)('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
    (0, express_validator_1.query)('type').optional().isIn(['deposit', 'withdraw']).withMessage('Type must be either deposit or withdraw')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { walletAddress } = req.params;
        const { page = 1, pageSize = 10, chainId, type } = req.query;
        const result = await (0, activityService_1.getActivitiesByWallet)(walletAddress, chainId ? parseInt(chainId) : undefined, parseInt(page), parseInt(pageSize), type);
        res.json({
            activities: result.activities,
            data: result.activities,
            totalCount: result.totalCount,
            currentPage: result.currentPage,
            totalPages: result.totalPages,
            hasNextPage: result.hasNextPage,
            hasPrevPage: result.hasPrevPage
        });
    }
    catch (error) {
        console.error('Error fetching activities:', error);
        res.status(500).json({ error: 'Failed to fetch activities' });
    }
});
// GET /api/activities/diagnostics/monitoring - Get monitoring diagnostics
router.get('/diagnostics/monitoring', async (_req, res) => {
    try {
        const diagnostics = (0, activityMonitor_1.getMonitoringDiagnostics)();
        res.json({
            success: true,
            diagnostics,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        console.error('Error fetching monitoring diagnostics:', error);
        res.status(500).json({ error: 'Failed to fetch monitoring diagnostics' });
    }
});
// GET /api/activities/diagnostics/wallet/:walletAddress - Get wallet monitoring status
router.get('/diagnostics/wallet/:walletAddress', [
    (0, express_validator_1.param)('walletAddress').custom(validation_1.validateAddress).withMessage('Invalid wallet address'),
    (0, express_validator_1.query)('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { walletAddress } = req.params;
        const chainId = req.query.chainId ? parseInt(req.query.chainId) : undefined;
        if (chainId) {
            const status = (0, activityMonitor_1.getWalletMonitoringStatus)(walletAddress, chainId);
            res.json({
                success: true,
                walletAddress,
                ...status,
                chainId, // Add chainId after spread to ensure it's included
            });
        }
        else {
            // Check all configured chains
            const { getConfiguredChains } = await Promise.resolve().then(() => __importStar(require('../config/blockchain')));
            const chains = getConfiguredChains();
            const statuses = chains.map(chainId => (0, activityMonitor_1.getWalletMonitoringStatus)(walletAddress, chainId) // Already includes chainId property
            );
            res.json({
                success: true,
                walletAddress,
                statuses,
            });
        }
    }
    catch (error) {
        console.error('Error fetching wallet monitoring status:', error);
        res.status(500).json({ error: 'Failed to fetch wallet monitoring status' });
    }
});
// POST /api/activities/diagnostics/trigger-check - Manually trigger deposit check
router.post('/diagnostics/trigger-check', [
    (0, express_validator_1.query)('chainId').isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const chainId = parseInt(req.query.chainId);
        const result = await (0, activityMonitor_1.triggerDepositCheck)(chainId);
        if (result.success) {
            res.json({
                ...result, // Spread first to include all properties
                success: true, // Override success if result already has it
            });
        }
        else {
            res.status(400).json({
                ...result, // Spread first to include all properties
                success: false, // Override success if result already has it
            });
        }
    }
    catch (error) {
        console.error('Error triggering deposit check:', error);
        res.status(500).json({ error: 'Failed to trigger deposit check' });
    }
});
// GET /api/activities/health - Health check endpoint
router.get('/health', async (_req, res) => {
    try {
        const diagnostics = (0, activityMonitor_1.getMonitoringDiagnostics)();
        const totalWallets = Object.values(diagnostics.monitoredWallets).reduce((sum, wallets) => sum + wallets.length, 0);
        const totalChains = Object.keys(diagnostics.monitoredWallets).length;
        const activeCircuitBreakers = Object.values(diagnostics.circuitBreakers).filter((breaker) => breaker.enabled && breaker.until > Date.now()).length;
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            summary: {
                totalWallets,
                totalChains,
                activeCircuitBreakers,
                websocketChains: Object.keys(diagnostics.websocketStatus).length,
            },
            chains: Object.keys(diagnostics.monitoredWallets).map(chainIdStr => {
                const chainId = parseInt(chainIdStr);
                return {
                    chainId,
                    walletCount: (diagnostics.monitoredWallets[chainId] || []).length,
                    lastCheckedBlock: diagnostics.lastCheckedBlocks[chainId] || null,
                    lastKnownBlock: diagnostics.lastKnownBlocks[chainId] || null,
                    hasActiveCheck: diagnostics.activeChecks[chainId] || false,
                    circuitBreakerActive: diagnostics.circuitBreakers[chainId]?.enabled || false,
                    rateLimitCount: diagnostics.rateLimitCounts[chainId] || 0,
                    websocketConnected: diagnostics.websocketStatus[chainId] || false,
                    blocksSinceLastCheck: diagnostics.blocksSinceLastCheck[chainId] || 0,
                };
            }),
        };
        // Determine overall health status
        if (activeCircuitBreakers > 0) {
            health.status = 'degraded';
        }
        if (totalWallets === 0) {
            health.status = 'no_wallets';
        }
        res.json(health);
    }
    catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to perform health check',
            timestamp: new Date().toISOString(),
        });
    }
});
exports.default = router;
//# sourceMappingURL=activities.js.map