"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = __importDefault(require("./config/database"));
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const socket_io_1 = require("socket.io");
const http_1 = __importDefault(require("http"));
// Import routes
const tokens_1 = __importDefault(require("./routes/tokens"));
const holders_1 = __importDefault(require("./routes/holders"));
const histories_1 = __importDefault(require("./routes/histories"));
const transactions_1 = __importDefault(require("./routes/transactions"));
const users_1 = __importDefault(require("./routes/users"));
const auth_1 = __importDefault(require("./routes/auth"));
const upload_1 = __importDefault(require("./routes/upload"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const chat_1 = __importDefault(require("./routes/chat"));
const test_sendgrid_1 = __importDefault(require("./routes/test-sendgrid"));
const debug_auth_1 = __importDefault(require("./routes/debug-auth"));
const tokenCreation_1 = __importDefault(require("./routes/tokenCreation"));
const liquidityEvents_1 = __importDefault(require("./routes/liquidityEvents"));
const wallet_1 = __importDefault(require("./routes/wallet"));
// Import sync job
const track_1 = require("./sync/track");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
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
app.use((0, morgan_1.default)('combined'));
// CORS configuration
const corsOptions = {
    origin: '*',
    credentials: true,
    optionsSuccessStatus: 200,
};
app.use((0, cors_1.default)(corsOptions));
// Add header to allow private network access (fixes localhost requests from public IPs)
app.use((_req, res, next) => {
    // Allow private network access for browsers that support it
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    next();
});
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '10000'),
    message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);
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
app.use(express_1.default.static(actualBuildPath));
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
app.use('/api/auth', auth_1.default);
app.use('/api/upload', upload_1.default);
app.use('/api/analytics', analytics_1.default);
app.use('/api/chat', chat_1.default);
app.use('/api/test', test_sendgrid_1.default);
app.use('/api/wallet', wallet_1.default);
if (process.env.NODE_ENV !== 'production') {
    app.use('/api/debug', debug_auth_1.default);
}
// Serve frontend for all non-API routes (SPA routing)
app.get('*', (req, res) => {
    // Don't serve frontend for API routes
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: 'Route not found' });
    }
    // Serve index.html for SPA routing
    res.sendFile(path_1.default.join(actualBuildPath, 'index.html'));
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
        // origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
// Initialize Socket logic
const socket_1 = __importDefault(require("./socket"));
(0, socket_1.default)(io);
// Connect to MongoDB and start server
const startServer = async () => {
    try {
        await (0, database_1.default)();
        // Start server
        server.listen(PORT, () => {
            console.log(`🚀 BondX Backend Server running on port ${PORT}`);
            console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔗 Health check: http://localhost:${PORT}/health`);
        });
        // Start multi-chain tracking (will track all configured chains)
        // trackTrading() will automatically detect and track all chains with WebSocket URLs configured
        (0, track_1.trackTrading)();
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
// Graceful shutdown
const shutdown = () => {
    console.log('Shutting down gracefully...');
    if (mongoose_1.default.connection.readyState === 1) {
        mongoose_1.default.connection.close(false).then(() => {
            console.log('MongoDB connection closed');
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