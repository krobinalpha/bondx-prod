"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const database_1 = __importDefault(require("../config/database"));
const handler_1 = require("./handler");
const blockchain_1 = require("../config/blockchain");
// Main function to sync the trade events for all configured chains
const syncTrade = async () => {
    const configuredChains = (0, blockchain_1.getConfiguredChains)();
    if (configuredChains.length === 0) {
        return;
    }
    // Sync each configured chain independently
    for (const chainId of configuredChains) {
        const chainProvider = (0, blockchain_1.getProvider)(chainId);
        let startBlock = Number(process.env.SYNC_START_BLOCK) || 0;
        const intervalSize = Number(process.env.SYNC_INTERVAL_SIZE) || 100;
        const checkingCycle = node_cron_1.default.schedule('*/10 * * * * *', async () => {
            try {
                const latestBlock = await chainProvider.getBlockNumber();
                const endBlock = Math.min(startBlock + intervalSize, latestBlock);
                await (0, handler_1.syncBlockRange)(startBlock, endBlock, chainId);
                // Move forward
                startBlock = endBlock + 1;
                // Stop if caught up
                if (startBlock >= latestBlock) {
                    checkingCycle.stop();
                }
            }
            catch (error) {
                console.error(`❌ Error during cron sync for chain ${chainId}:`, error);
            }
        });
    }
};
const startSync = async () => {
    await (0, database_1.default)();
    syncTrade();
};
startSync();
//# sourceMappingURL=token.js.map