import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import connectDB from './config/database';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import http from 'http';
import { ErrorHandler } from './types';

// Import routes
import tokenRoutes from './routes/tokens';
import holderRoutes from './routes/holders';
import historyRoutes from './routes/histories';
import transactionRoutes from './routes/transactions';
import userRoutes from './routes/users';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import analyticsRoutes from './routes/analytics';
import chatRoutes from './routes/chat';
// Debug/test routes - only in development
let testSendGridRoutes: express.Router | null = null;
let debugAuthRoutes: express.Router | null = null;

if (process.env.NODE_ENV !== 'production') {
  testSendGridRoutes = require('./routes/test-sendgrid').default;
  debugAuthRoutes = require('./routes/debug-auth').default;
}
import tokenCreationRoutes from './routes/tokenCreation';
import liquidityEventRoutes from './routes/liquidityEvents';
import walletRoutes from './routes/wallet';

// Import sync job
import { trackTrading } from './sync/track';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy - required when behind reverse proxy (nginx, load balancer, etc.)
// This tells Express to trust the X-Forwarded-* headers from the proxy
// This is necessary for express-rate-limit to correctly identify client IPs
app.set('trust proxy', 1);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for some libraries
        "'unsafe-eval'", // Required for some Web3 libraries
        "https://*.walletconnect.org",
        "https://*.walletconnect.com",
        "https://*.web3modal.org",
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for inline styles
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:", // Allow all HTTPS images (Cloudinary, etc.)
        "blob:",
      ],
      connectSrc: [
        "'self'",
        "https://*.walletconnect.org",
        "https://*.walletconnect.com",
        "https://*.web3modal.org",
        "https://pulse.walletconnect.org",
        "https://api.web3modal.org",
        "wss://*.walletconnect.org",
        "wss://*.walletconnect.com",
        "https://*.coinbase.com", // Base Account SDK / Coinbase Cloud Account
        "https://cca-lite.coinbase.com", // Base Account SDK analytics and AMP
      ],
      fontSrc: [
        "'self'",
        "data:",
        "https:",
      ],
      frameSrc: [
        "'self'",
        "https://*.walletconnect.org",
        "https://*.walletconnect.com",
      ],
    },
  },
  crossOriginOpenerPolicy: {
    policy: "unsafe-none", // Required for Base Account SDK
  },
}));

// Compression middleware - compress all responses
// Level 6 is a good balance between compression ratio and CPU usage
// @ts-ignore - Type conflict between compression and express types
app.use(compression({ level: 6 }));

app.use(morgan('combined'));

// Handle preflight OPTIONS requests FIRST - before CORS middleware
app.options('*', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(204).end(); // 204 No Content for OPTIONS
});

// Add header to allow private network access for ALL requests (including preflight)
app.use((_req: Request, res: Response, next: NextFunction) => {
  // Allow private network access for browsers that support it
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// CORS configuration - must come AFTER manual OPTIONS handler
// Note: Cannot use '*' with credentials: true, so we'll handle origin dynamically
const corsOptions: cors.CorsOptions = {
  origin: (_origin, callback) => {
    // Allow all origins (including null for same-origin requests)
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  // Don't handle OPTIONS here since we handle it manually above
  preflightContinue: false,
};
app.use(cors(corsOptions));

// Rate limiting - reasonable defaults for production
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '600000'), // 10 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000000'), // 100 requests per 10 minutes (much more reasonable)
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Disable trust proxy validation to avoid ERR_ERL_PERMISSIVE_TRUST_PROXY
  validate: {
    trustProxy: false,
  },
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from frontend build
// Resolve path relative to project root (works in both dev and production)
const projectRoot = path.resolve(__dirname, '../..');
const buildPath = path.join(projectRoot, 'backend', 'src', 'build');

// Fallback: if build doesn't exist, try dist/build (for compiled backend)
const actualBuildPath = fs.existsSync(buildPath) 
  ? buildPath 
  : path.join(__dirname, 'build');

// Serve static files with caching headers
app.use(express.static(actualBuildPath, {
  maxAge: '1y', // Cache for 1 year
  etag: true, // Enable ETag for cache validation
  lastModified: true, // Enable Last-Modified header
  immutable: true, // Mark as immutable (won't change)
  setHeaders: (res: Response, path: string) => {
    // Add cache headers for different file types
    if (path.endsWith('.html')) {
      // HTML files should not be cached (for SPA routing)
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
      // Static assets can be cached for 1 year
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// Health check endpoint
app.get('/health', (_req: Request, res: Response): void => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use('/api/tokens', tokenRoutes);
app.use('/api/tokens', tokenCreationRoutes);
app.use('/api/holders', holderRoutes);
app.use('/api/histories', historyRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/liquidity-events', liquidityEventRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/wallet', walletRoutes);
// Debug/test routes - only in development
if (process.env.NODE_ENV !== 'production') {
  if (testSendGridRoutes) {
    app.use('/api/test', testSendGridRoutes);
  }
  if (debugAuthRoutes) {
    app.use('/api/debug', debugAuthRoutes);
  }
}

// Serve frontend for all non-API routes (SPA routing)
app.get('*', (req: Request, res: Response): Response | void => {
  // Don't serve frontend for API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  // Check if index.html exists
  const indexPath = path.join(actualBuildPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ index.html not found at: ${indexPath}`);
    return res.status(500).json({ 
      error: 'Frontend build not found. Please build the frontend first.',
      path: indexPath 
    });
  }
  
  // Serve index.html for SPA routing
  res.sendFile(indexPath);
});

// Global error handler
app.use((err: ErrorHandler, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('Global error:', err);
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Create HTTP server and attach Socket.io
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  // Increase timeouts for better reliability
  connectTimeout: 60000,      // Increased from 45000
  pingTimeout: 120000,         // Increased from 60000 (2 minutes)
  pingInterval: 25000,         // Keep at 25 seconds
  allowEIO3: true,
  path: '/socket.io/',
  // Add these for better connection handling
  allowUpgrades: true,
  perMessageDeflate: false,   // Disable compression to reduce overhead
});

// Initialize Socket logic
import socketInit from './socket';
socketInit(io);

// Global error handlers
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('   Reason:', reason);
  // Don't exit in production - just log (could send to error tracking service)
  if (process.env.NODE_ENV === 'development') {
    console.error('   Stack:', reason?.stack);
  }
});

process.on('uncaughtException', (error: Error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('   Stack:', error.stack);
  // Exit in production for safety (prevent undefined behavior)
  process.exit(1);
});

// Connect to MongoDB and start server
const startServer = async (): Promise<void> => {
  try {
    await connectDB();

    // Start server
    server.listen(PORT, () => {
      console.log(`🚀 BondX Backend Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });
    
    // Start multi-chain tracking (will track all configured chains)
    // trackTrading() will automatically detect and track all chains with WebSocket URLs configured
    trackTrading();
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
const shutdown = (): void => {
  console.log('Shutting down gracefully...');
  
  // Clean up auth store intervals
  try {
    const { cleanupAuthStores } = require('./routes/auth');
    cleanupAuthStores();
  } catch (err) {
    // Ignore if module not loaded
  }
  
  if (mongoose.connection.readyState === 1) {
    mongoose.connection.close(false).then(() => {
      console.log('MongoDB connection closed');
      process.exit(0);
    }).catch((err) => {
      console.error('Error closing MongoDB connection:', err);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;

