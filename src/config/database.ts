import mongoose from 'mongoose';

const connectDB = async (): Promise<typeof mongoose> => {
  try {
    // Use existing database name (BondX) to match what's already in MongoDB
    // If you want to use lowercase, rename the database first
    const mongoURI = process.env.MONGODB_URI as string;
    
    // Connect without normalization to use existing database
    // If you get case errors, either:
    // 1. Rename your database to match the connection string, OR
    // 2. Update MONGODB_URI in .env to match your existing database name
    const conn = await mongoose.connect(mongoURI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    console.log(`🔌 Port: ${conn.connection.port}`);

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️ MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('✅ MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        console.error('❌ Error during MongoDB connection closure:', err);
        process.exit(1);
      }
    });

    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;

