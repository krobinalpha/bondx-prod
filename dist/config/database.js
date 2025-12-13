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
        // Connect without normalization to use existing database
        // If you get case errors, either:
        // 1. Rename your database to match the connection string, OR
        // 2. Update MONGODB_URI in .env to match your existing database name
        const conn = await mongoose_1.default.connect(mongoURI);
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        console.log(`📊 Database: ${conn.connection.name}`);
        console.log(`🔌 Port: ${conn.connection.port}`);
        // Handle connection events
        mongoose_1.default.connection.on('error', (err) => {
            console.error('❌ MongoDB connection error:', err);
        });
        mongoose_1.default.connection.on('disconnected', () => {
            console.log('⚠️ MongoDB disconnected');
        });
        mongoose_1.default.connection.on('reconnected', () => {
            console.log('🔄 MongoDB reconnected');
        });
        // Graceful shutdown
        process.on('SIGINT', async () => {
            try {
                await mongoose_1.default.connection.close();
                console.log('✅ MongoDB connection closed through app termination');
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