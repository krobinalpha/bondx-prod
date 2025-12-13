import cron from 'node-cron';
import connectDB from '../config/database';
import { syncBlockRange } from './handler';
import { getConfiguredChains, getProvider } from '../config/blockchain';

// Main function to sync the trade events for all configured chains
const syncTrade = async (): Promise<void> => {
  const configuredChains = getConfiguredChains();
  
  if (configuredChains.length === 0) {
    console.warn('⚠️ No chains configured. Sync disabled.');
    return;
  }
  
  console.log(`🔄 Starting multi-chain sync for ${configuredChains.length} chain(s)...`);
  
  // Sync each configured chain independently
  for (const chainId of configuredChains) {
    const chainProvider = getProvider(chainId);
    let startBlock = Number(process.env.SYNC_START_BLOCK) || 0;
    const intervalSize = Number(process.env.SYNC_INTERVAL_SIZE) || 100;
    
    console.log(`📡 Starting sync for chain ${chainId} from block ${startBlock}`);
    
    const checkingCycle = cron.schedule('*/10 * * * * *', async () => {
      try {
        const latestBlock = await chainProvider.getBlockNumber();
        const endBlock = Math.min(startBlock + intervalSize, latestBlock);

        await syncBlockRange(startBlock, endBlock, chainId);

        // Move forward
        startBlock = endBlock + 1;

        // Stop if caught up
        if (startBlock >= latestBlock) {
          console.log(`✅ Sync complete for chain ${chainId} — reached latest block ${latestBlock}.`);
          checkingCycle.stop();
        }
      } catch (error) {
        console.error(`❌ Error during cron sync for chain ${chainId}:`, error);
      }
    });
  }
};

const startSync = async (): Promise<void> => {
  await connectDB();
  syncTrade();
};

startSync();

