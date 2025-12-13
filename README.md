# BondX Backend (TypeScript)

Backend API for BondX Token Launchpad - TypeScript version.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with the required environment variables:
```env
# ============================================
# Server Configuration
# ============================================
PORT=5000
NODE_ENV=development

# ============================================
# Database Configuration
# ============================================
MONGODB_URI=your_mongodb_connection_string

# ============================================
# JWT Authentication
# ============================================
JWT_SECRET=your_jwt_secret_key
CHAIN_ID=84532

# ============================================
# Blockchain Configuration - Multi-Chain
# ============================================
# Ethereum Mainnet (Chain ID: 1)
FACTORY_ADDRESS_ETHEREUM=0x0000000000000000000000000000000000000000
BONDING_CURVE_ADDRESS_ETHEREUM=0x0000000000000000000000000000000000000000

# Base Mainnet (Chain ID: 8453)
FACTORY_ADDRESS_BASE=0x0000000000000000000000000000000000000000
BONDING_CURVE_ADDRESS_BASE=0x0000000000000000000000000000000000000000

# Arbitrum Mainnet (Chain ID: 42161)
FACTORY_ADDRESS_ARBITRUM=0x0000000000000000000000000000000000000000
BONDING_CURVE_ADDRESS_ARBITRUM=0x0000000000000000000000000000000000

# Base Sepolia Testnet (Chain ID: 84532)
FACTORY_ADDRESS_BASE_SEPOLIA=0x0000000000000000000000000000000000000000
BONDING_CURVE_ADDRESS_BASE_SEPOLIA=0x0000000000000000000000000000000000000000

# Legacy/Default (for backward compatibility)
FACTORY_ADDRESS=0x0000000000000000000000000000000000000000
BONDING_CURVE_ADDRESS=0x0000000000000000000000000000000000000000

# ============================================
# SendGrid Email Service (for email authentication)
# ============================================
SENDGRID_API_KEY=your_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com

# ============================================
# Cloudinary (for image uploads)
# ============================================
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# ============================================
# WebSocket Configuration
# ============================================
WS_PORT=5001
```

3. **SendGrid Setup** (for email authentication):
   - Sign up at [SendGrid](https://sendgrid.com/)
   - Create an API key in SendGrid dashboard
   - Verify your sender email address (or use a domain)
   - Add `SENDGRID_API_KEY` and `SENDGRID_FROM_EMAIL` to your `.env` file
   - Note: If SendGrid is not configured, the system will fall back to console logging in development mode

4. Build the project:
```bash
npm run build
```

5. Run in development mode:
```bash
npm run dev
```

6. Run in production mode:
```bash
npm start
```

## Scripts

- `npm run dev` - Run in development mode with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Run the compiled JavaScript
- `npm run sync` - Run the blockchain sync job
- `npm run seed` - Seed the database
- `npm test` - Run tests

## Project Structure

```
src/
├── config/         # Configuration files (database, blockchain)
├── models/         # Mongoose models
├── middleware/     # Express middleware
├── routes/         # API routes
├── services/       # Service utilities (email, etc.)
├── sync/           # Blockchain sync jobs
├── socket/          # Socket.io handlers
├── scripts/         # Utility scripts
├── types/           # TypeScript type definitions
└── server.ts        # Main server file
```

## TypeScript

This project uses TypeScript for type safety. All JavaScript files from the original backend have been converted to TypeScript with proper type definitions.

