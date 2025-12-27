"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const compression_1 = __importDefault(require("compression"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = __importDefault(require("./config/database"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const socket_io_1 = require("socket.io");
const http_1 = __importDefault(require("http"));
const auth_1 = require("./middleware/auth");
// Import routes
const tokens_1 = __importDefault(require("./routes/tokens"));
const holders_1 = __importDefault(require("./routes/holders"));
const histories_1 = __importDefault(require("./routes/histories"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const users_1 = __importDefault(require("./routes/users"));
const auth_2 = __importDefault(require("./routes/auth"));
const upload_1 = __importDefault(require("./routes/upload"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const chat_1 = __importDefault(require("./routes/chat"));
const tokenCreation_1 = __importDefault(require("./routes/tokenCreation"));
const liquidityEvents_1 = __importDefault(require("./routes/liquidityEvents"));
const wallet_1 = __importDefault(require("./routes/wallet"));
const activities_1 = __importDefault(require("./routes/activities"));
// Import sync job
const track_1 = require("./sync/track");
const activityMonitor_1 = require("./services/activityMonitor");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
// Trust proxy - required when behind reverse proxy (nginx, load balancer, etc.)
// This tells Express to trust the X-Forwarded-* headers from the proxy
// This is necessary for express-rate-limit to correctly identify client IPs
app.set('trust proxy', 1);
// Middleware
app.use((0, helmet_1.default)({
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
app.use((0, compression_1.default)({ level: 6 }));
app.use((0, morgan_1.default)('combined'));
// Handle preflight OPTIONS requests FIRST - before CORS middleware
app.options('*', (_req, res) => {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    res.status(204).end(); // 204 No Content for OPTIONS
});
// Add header to allow private network access for ALL requests (including preflight)
app.use((_req, res, next) => {
    // Allow private network access for browsers that support it
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
});
// CORS configuration - must come AFTER manual OPTIONS handler
// Note: Cannot use '*' with credentials: true, so we'll handle origin dynamically
const corsOptions = {
    origin: (_origin, callback) => {
        // Allow all origins (including null for same-origin requests)
        callback(null, true);
    },
    credentials: true,
    optionsSuccessStatus: 200,
    // Don't handle OPTIONS here since we handle it manually above
    preflightContinue: false,
};
app.use((0, cors_1.default)(corsOptions));
// Optional authentication - tries to authenticate but doesn't fail if no token
// This allows rate limiting to differentiate between authenticated and anonymous users
// Must run before rate limiting so req.user is available
app.use('/api/', auth_1.optionalAuth);
// Rate limiting - tiered system for better scalability (1-10k users)
// Authenticated users: 200 requests/10min (higher limit, tracked by user ID)
// Anonymous users: 50 requests/10min (lower limit to prevent abuse, tracked by IP)
const authenticatedLimiter = (0, express_rate_limit_1.default)({
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
        const authReq = req;
        if (authReq.user?._id) {
            return `user:${authReq.user._id.toString()}`;
        }
        // Fallback to IP if user ID not available (shouldn't happen with this limiter)
        return req.ip || 'unknown';
    },
});
const anonymousLimiter = (0, express_rate_limit_1.default)({
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
app.use('/api/', (req, res, next) => {
    const authReq = req;
    // Check if user is authenticated (has user object from authenticateToken or optionalAuth middleware)
    if (authReq.user?._id) {
        // User is authenticated - use higher limit (tracked by user ID)
        authenticatedLimiter(req, res, next);
    }
    else {
        // User is anonymous - use lower limit (tracked by IP)
        anonymousLimiter(req, res, next);
    }
});
// Request timeout middleware - prevents hanging requests from consuming resources
// Set timeout for all requests (60 seconds)
app.use((req, res, next) => {
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
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Serve static files from frontend build
// Resolve path relative to project root (works in both dev and production)
const projectRoot = path_1.default.resolve(__dirname, '../..');
const buildPath = path_1.default.join(projectRoot, 'backend', 'src', 'build');
// Fallback: if build doesn't exist, try dist/build (for compiled backend)
const actualBuildPath = fs_1.default.existsSync(buildPath)
    ? buildPath
    : path_1.default.join(__dirname, 'build');
// Serve static files with caching headers
app.use(express_1.default.static(actualBuildPath, {
    maxAge: '1y', // Cache for 1 year
    etag: true, // Enable ETag for cache validation
    lastModified: true, // Enable Last-Modified header
    immutable: true, // Mark as immutable (won't change)
    setHeaders: (res, filePath) => {
        // Set correct MIME types for JavaScript modules (critical for module scripts)
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
        // Add cache headers for different file types
        if (filePath.endsWith('.html')) {
            // HTML files should not be cached (for SPA routing)
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
        else if (filePath.match(/\.(js|mjs|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json|map)$/)) {
            // Static assets can be cached for 1 year
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    },
}));
// Health check endpoint
app.get('/health', (_req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});
// API routes
app.use('/api/tokens', tokens_1.default);
app.use('/api/tokens', tokenCreation_1.default);
app.use('/api/holders', holders_1.default);
app.use('/api/histories', histories_1.default);
app.use('/api/transactions', transactions_1.default);
app.use('/api/liquidity-events', liquidityEvents_1.default);
app.use('/api/users', users_1.default);
app.use('/api/auth', auth_2.default);
app.use('/api/upload', upload_1.default);
app.use('/api/analytics', analytics_1.default);
app.use('/api/chat', chat_1.default);
app.use('/api/wallet', wallet_1.default);
app.use('/api/activities', activities_1.default);
// Serve frontend for all non-API routes (SPA routing)
app.get('*', (req, res) => {
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
    const indexPath = path_1.default.join(actualBuildPath, 'index.html');
    if (!fs_1.default.existsSync(indexPath)) {
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
app.use((err, _req, res, _next) => {
    console.error('Global error:', err);
    res.status(err.status || err.statusCode || 500).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});
// Create HTTP server and attach Socket.io
const server = http_1.default.createServer(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
    // Increase timeouts for better reliability
    connectTimeout: 60000, // Increased from 45000
    pingTimeout: 120000, // Increased from 60000 (2 minutes)
    pingInterval: 25000, // Keep at 25 seconds
    allowEIO3: true,
    path: '/socket.io/',
    // Add these for better connection handling
    allowUpgrades: true,
    perMessageDeflate: false, // Disable compression to reduce overhead
    // Connection limits for scalability (1-10k users)
    maxHttpBufferSize: 1e6, // Maximum message size: 1MB (prevents memory exhaustion)
    // Note: Socket.io doesn't have a built-in max connections limit
    // For production with 10k+ concurrent users, consider using Redis adapter for horizontal scaling
});
// Initialize Socket logic
const socket_1 = __importDefault(require("./socket"));
(0, socket_1.default)(io);
// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise);
    console.error('   Reason:', reason);
    // Don't exit in production - just log (could send to error tracking service)
    if (process.env.NODE_ENV === 'development') {
        console.error('   Stack:', reason?.stack);
    }
});
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.error('   Stack:', error.stack);
    // Exit in production for safety (prevent undefined behavior)
    process.exit(1);
});
// Connect to MongoDB and start server
const startServer = async () => {
    try {
        await (0, database_1.default)();
        // Start server
        server.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
        });
        // Start multi-chain tracking (will track all configured chains)
        // trackTrading() will automatically detect and track all chains with WebSocket URLs configured
        (0, track_1.trackTrading)();
        // Start activity monitoring for embedded wallets (deposit/withdraw tracking)
        (0, activityMonitor_1.startActivityMonitoring)().catch((error) => {
            console.error('Error starting activity monitoring:', error);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
// Graceful shutdown
const shutdown = () => {
    // Stop activity monitoring
    try {
        (0, activityMonitor_1.stopActivityMonitoring)();
    }
    catch (err) {
        console.error('Error stopping activity monitoring:', err);
    }
    // Clean up auth store intervals
    try {
        const { cleanupAuthStores } = require('./routes/auth');
        cleanupAuthStores();
    }
    catch (err) {
        // Ignore if module not loaded
    }
    if (mongoose_1.default.connection.readyState === 1) {
        mongoose_1.default.connection.close(false).then(() => {
            process.exit(0);
        }).catch((err) => {
            console.error('Error closing MongoDB connection:', err);
            process.exit(1);
        });
    }
    else {
        process.exit(0);
    }
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
//# sourceMappingURL=server.js.map