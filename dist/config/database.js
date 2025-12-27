"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = async () => {
    try {
        // Use existing database name (BondX) to match what's already in MongoDB
        // If you want to use lowercase, rename the database first
        const mongoURI = process.env.MONGODB_URI;
        // Connect with connection pool configuration for scalability (1-10k users)
        // Optimized for production workloads
        const conn = await mongoose_1.default.connect(mongoURI, {
            maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '50'), // Maximum number of connections in pool (default: 50)
            minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '10'), // Minimum number of connections to maintain (default: 10)
            serverSelectionTimeoutMS: 5000, // How long to try selecting a server before timing out (5 seconds)
            socketTimeoutMS: 45000, // How long to wait for a socket operation before timing out (45 seconds)
            connectTimeoutMS: 10000, // How long to wait for initial connection (10 seconds)
            heartbeatFrequencyMS: 10000, // How often to check server status (10 seconds)
            retryWrites: true, // Retry write operations on network errors
            retryReads: true, // Retry read operations on network errors
        });
        // Log successful connection
        console.log(`✅ MongoDB connected successfully: ${conn.connection.host}`);
        console.log(`   Database: ${conn.connection.name}`);
        // Handle connection events
        mongoose_1.default.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });
        mongoose_1.default.connection.on('disconnected', () => {
            console.warn('⚠️ MongoDB disconnected');
        });
        mongoose_1.default.connection.on('reconnected', () => {
            console.log('✅ MongoDB reconnected successfully');
        });
        // Graceful shutdown
        process.on('SIGINT', async () => {
            try {
                await mongoose_1.default.connection.close();
                process.exit(0);
            }
            catch (err) {
                console.error('❌ Error during MongoDB connection closure:', err);
                process.exit(1);
            }
        });
        return conn;
    }
    catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
};
exports.default = connectDB;
//# sourceMappingURL=database.js.map