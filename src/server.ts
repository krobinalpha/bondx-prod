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
import { ErrorHandler, AuthRequest } from './types';
import { optionalAuth } from './middleware/auth';

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
import tokenCreationRoutes from './routes/tokenCreation';
import liquidityEventRoutes from './routes/liquidityEvents';
import walletRoutes from './routes/wallet';
import activitiesRoutes from './routes/activities';

// Import sync job
import { trackTrading } from './sync/track';
import { startActivityMonitoring, stopActivityMonitoring } from './services/activityMonitor';

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

// Optional authentication - tries to authenticate but doesn't fail if no token
// This allows rate limiting to differentiate between authenticated and anonymous users
// Must run before rate limiting so req.user is available
app.use('/api/', optionalAuth);

// Rate limiting - tiered system for better scalability (1-10k users)
// Authenticated users: 200 requests/10min (higher limit, tracked by user ID)
// Anonymous users: 50 requests/10min (lower limit to prevent abuse, tracked by IP)
const authenticatedLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '600000'), // 10 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_AUTH || '200'), // 200 requests per 10 minutes for authenticated users
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Skip rate limiting for health checks and static assets
  skip: (req) => {
    return req.path === '/health' || req.path.startsWith('/static/');
  },
  // Use user ID for authenticated users to avoid shared IP issues
  keyGenerator: (req) => {
    const authReq = req as AuthRequest;
    if (authReq.user?._id) {
      return `user:${authReq.user._id.toString()}`;
    }
    // Fallback to IP if user ID not available (shouldn't happen with this limiter)
    return req.ip || 'unknown';
  },
});

const anonymousLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '600000'), // 10 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_ANON || '50'), // 50 requests per 10 minutes for anonymous users
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks and static assets
  skip: (req) => {
    return req.path === '/health' || req.path.startsWith('/static/');
  },
  // Use IP address for anonymous users
  keyGenerator: (req) => {
    return req.ip || 'unknown';
  },
});

// Apply rate limiting with authentication check
// Routes that use authenticateToken or optionalAuth will have req.user set
// Authenticated users get higher limits, anonymous users get lower limits
app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  // Check if user is authenticated (has user object from authenticateToken or optionalAuth middleware)
  if (authReq.user?._id) {
    // User is authenticated - use higher limit (tracked by user ID)
    authenticatedLimiter(req, res, next);
  } else {
    // User is anonymous - use lower limit (tracked by IP)
    anonymousLimiter(req, res, next);
  }
});

// Request timeout middleware - prevents hanging requests from consuming resources
// Set timeout for all requests (60 seconds)
app.use((req: Request, res: Response, next: NextFunction) => {
  // Set timeout for request (60 seconds)
  req.setTimeout(60000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  
  // Set timeout for response (60 seconds)
  res.setTimeout(60000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Response timeout' });
    }
  });
  
  next();
});

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
  setHeaders: (res: Response, filePath: string) => {
    // Set correct MIME types for JavaScript modules (critical for module scripts)
    if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    }
    
    // Add cache headers for different file types
    if (filePath.endsWith('.html')) {
      // HTML files should not be cached (for SPA routing)
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.match(/\.(js|mjs|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json|map)$/)) {
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
app.use('/api/activities', activitiesRoutes);

// Serve frontend for all non-API routes (SPA routing)
app.get('*', (req: Request, res: Response): Response | void => {
  // Don't serve frontend for API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  // Don't serve index.html for static assets - return 404 instead
  // This prevents MIME type errors when JS/CSS files are missing or not found
  // The express.static middleware should handle these, but if a file doesn't exist,
  // we don't want to return HTML (which causes "Expected a JavaScript module" error)
  if (req.path.match(/\.(js|mjs|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json|map|webp|avif)$/)) {
    return res.status(404).json({ 
      error: 'Static file not found', 
      path: req.path,
      message: 'The requested static file does not exist. Make sure the frontend is built correctly.'
    });
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
  
  // Serve index.html for SPA routing (only for non-static file requests)
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
  // Connection limits for scalability (1-10k users)
  maxHttpBufferSize: 1e6,     // Maximum message size: 1MB (prevents memory exhaustion)
  // Note: Socket.io doesn't have a built-in max connections limit
  // For production with 10k+ concurrent users, consider using Redis adapter for horizontal scaling
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
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
    // Start multi-chain tracking (will track all configured chains)
    // trackTrading() will automatically detect and track all chains with WebSocket URLs configured
    trackTrading();
    
    // Start activity monitoring for embedded wallets (deposit/withdraw tracking)
    startActivityMonitoring().catch((error) => {
      console.error('Error starting activity monitoring:', error);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
const shutdown = (): void => {
  // Stop activity monitoring
  try {
    stopActivityMonitoring();
  } catch (err) {
    console.error('Error stopping activity monitoring:', err);
  }
  
  // Clean up auth store intervals
  try {
    const { cleanupAuthStores } = require('./routes/auth');
    cleanupAuthStores();
  } catch (err) {
    // Ignore if module not loaded
  }
  
  if (mongoose.connection.readyState === 1) {
    mongoose.connection.close(false).then(() => {
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

