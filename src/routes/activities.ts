import express, { Request, Response } from 'express';
import { query, param, validationResult } from 'express-validator';
import { validateAddress } from '../middleware/validation';
import { getActivitiesByWallet } from '../services/activityService';
import {
  getMonitoringDiagnostics,
  getWalletMonitoringStatus,
  triggerDepositCheck,
} from '../services/activityMonitor';

const router = express.Router();

// GET /api/activities/:walletAddress - Get activities for a wallet address
router.get('/:walletAddress', [
  param('walletAddress').custom(validateAddress).withMessage('Invalid wallet address'),
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('Page size must be between 1 and 100'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
  query('type').optional().isIn(['deposit', 'withdraw']).withMessage('Type must be either deposit or withdraw')
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { walletAddress } = req.params;
    const { page = 1, pageSize = 10, chainId, type } = req.query;

    const result = await getActivitiesByWallet(
      walletAddress,
      chainId ? parseInt(chainId as string) : undefined,
      parseInt(page as string),
      parseInt(pageSize as string),
      type as 'deposit' | 'withdraw' | undefined
    );

    res.json({
      activities: result.activities,
      data: result.activities,
      totalCount: result.totalCount,
      currentPage: result.currentPage,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({ error: 'Failed to fetch activities' });
  }
});

// GET /api/activities/diagnostics/monitoring - Get monitoring diagnostics
router.get('/diagnostics/monitoring', async (_req: Request, res: Response): Promise<Response | void> => {
  try {
    const diagnostics = getMonitoringDiagnostics();
    res.json({
      success: true,
      diagnostics,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching monitoring diagnostics:', error);
    res.status(500).json({ error: 'Failed to fetch monitoring diagnostics' });
  }
});

// GET /api/activities/diagnostics/wallet/:walletAddress - Get wallet monitoring status
router.get('/diagnostics/wallet/:walletAddress', [
  param('walletAddress').custom(validateAddress).withMessage('Invalid wallet address'),
  query('chainId').optional().isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { walletAddress } = req.params;
    const chainId = req.query.chainId ? parseInt(req.query.chainId as string) : undefined;

    if (chainId) {
      const status = getWalletMonitoringStatus(walletAddress, chainId);
      res.json({
        success: true,
        walletAddress,
        ...status,
        chainId, // Add chainId after spread to ensure it's included
      });
    } else {
      // Check all configured chains
      const { getConfiguredChains } = await import('../config/blockchain');
      const chains = getConfiguredChains();
      const statuses = chains.map(chainId => 
        getWalletMonitoringStatus(walletAddress, chainId) // Already includes chainId property
      );

      res.json({
        success: true,
        walletAddress,
        statuses,
      });
    }
  } catch (error: any) {
    console.error('Error fetching wallet monitoring status:', error);
    res.status(500).json({ error: 'Failed to fetch wallet monitoring status' });
  }
});

// POST /api/activities/diagnostics/trigger-check - Manually trigger deposit check
router.post('/diagnostics/trigger-check', [
  query('chainId').isInt({ min: 1 }).withMessage('Invalid chain ID'),
], async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const chainId = parseInt(req.query.chainId as string);
    const result = await triggerDepositCheck(chainId);

    if (result.success) {
      res.json({
        ...result, // Spread first to include all properties
        success: true, // Override success if result already has it
      });
    } else {
      res.status(400).json({
        ...result, // Spread first to include all properties
        success: false, // Override success if result already has it
      });
    }
  } catch (error: any) {
    console.error('Error triggering deposit check:', error);
    res.status(500).json({ error: 'Failed to trigger deposit check' });
  }
});

// GET /api/activities/health - Health check endpoint
router.get('/health', async (_req: Request, res: Response): Promise<Response | void> => {
  try {
    const diagnostics = getMonitoringDiagnostics();
    const totalWallets = Object.values(diagnostics.monitoredWallets).reduce(
      (sum, wallets) => sum + wallets.length,
      0
    );
    const totalChains = Object.keys(diagnostics.monitoredWallets).length;
    const activeCircuitBreakers = Object.values(diagnostics.circuitBreakers).filter(
      (breaker: any) => breaker.enabled && breaker.until > Date.now()
    ).length;

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
          walletCount: (diagnostics.monitoredWallets[chainId as keyof typeof diagnostics.monitoredWallets] || []).length,
          lastCheckedBlock: diagnostics.lastCheckedBlocks[chainId as keyof typeof diagnostics.lastCheckedBlocks] || null,
          lastKnownBlock: diagnostics.lastKnownBlocks[chainId as keyof typeof diagnostics.lastKnownBlocks] || null,
          hasActiveCheck: diagnostics.activeChecks[chainId as keyof typeof diagnostics.activeChecks] || false,
          circuitBreakerActive: diagnostics.circuitBreakers[chainId as keyof typeof diagnostics.circuitBreakers]?.enabled || false,
          rateLimitCount: diagnostics.rateLimitCounts[chainId as keyof typeof diagnostics.rateLimitCounts] || 0,
          websocketConnected: diagnostics.websocketStatus[chainId as keyof typeof diagnostics.websocketStatus] || false,
          blocksSinceLastCheck: diagnostics.blocksSinceLastCheck[chainId as keyof typeof diagnostics.blocksSinceLastCheck] || 0,
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
  } catch (error: any) {
    console.error('Error in health check:', error);
    res.status(500).json({
      status: 'error',
      error: 'Failed to perform health check',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;

