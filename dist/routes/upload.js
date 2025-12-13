"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const auth_1 = require("../middleware/auth");
const cloudinary_1 = __importDefault(require("cloudinary"));
const router = express_1.default.Router();
// Configure Cloudinary - will be configured on first request
const configureCloudinary = () => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
    if (!cloudName || !apiKey || !apiSecret) {
        return false;
    }
    try {
        cloudinary_1.default.v2.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
            secure: true
        });
        // Verify configuration was set
        const config = cloudinary_1.default.v2.config();
        if (config.cloud_name !== cloudName || config.api_key !== apiKey) {
            return false;
        }
        // Configuration successful
        return true;
    }
    catch (error) {
        return false;
    }
};
// Configure multer for memory storage
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit (increased for videos)
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        // Allow both image and video files
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        }
        else {
            cb(null, false);
        }
    }
});
// POST /api/upload/logo - Upload token logo (supports both images and videos)
router.post('/logo', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        // Configure Cloudinary on each request to ensure env vars are loaded
        if (!configureCloudinary()) {
            return res.status(500).json({
                error: 'Media upload service not configured',
                details: 'Please check your Cloudinary environment variables (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)'
            });
        }
        // Verify Cloudinary is actually configured by checking the config
        const currentConfig = cloudinary_1.default.v2.config();
        if (!currentConfig.cloud_name || !currentConfig.api_key || !currentConfig.api_secret) {
            return res.status(500).json({
                error: 'Media upload service configuration error',
                details: 'Cloudinary credentials not properly set. Please restart the server after setting environment variables.'
            });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }
        // Detect file type
        const isVideo = req.file.mimetype.startsWith('video/');
        const isImage = req.file.mimetype.startsWith('image/');
        if (!isVideo && !isImage) {
            return res.status(400).json({ error: 'File must be an image or video' });
        }
        // Convert buffer to base64
        const base64Data = req.file.buffer.toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${base64Data}`;
        // Double-check configuration before upload
        const config = cloudinary_1.default.v2.config();
        if (!config.api_key || !config.api_secret) {
            return res.status(500).json({
                error: 'Cloudinary configuration error',
                details: 'API credentials not properly configured'
            });
        }
        // Upload to Cloudinary
        const uploadOptions = {
            folder: isVideo ? 'bondx/videos' : 'bondx/logos',
            resource_type: isVideo ? 'video' : 'image',
            transformation: isVideo
                ? [
                    { quality: 'auto:good' },
                    { format: 'mp4' } // Ensure video format
                ]
                : [
                    { width: 400, height: 400, crop: 'fill', gravity: 'center' },
                    { quality: 'auto:good' }
                ]
        };
        const result = await cloudinary_1.default.v2.uploader.upload(dataURI, uploadOptions);
        res.json({
            url: result.secure_url,
            public_id: result.public_id,
            width: result.width,
            height: result.height,
            format: result.format,
            size: result.bytes,
            resource_type: result.resource_type, // 'image' or 'video'
            type: isVideo ? 'video' : 'image' // Helper field for frontend
        });
    }
    catch (error) {
        // Provide more detailed error information
        if (error.http_code) {
            return res.status(500).json({
                error: 'Failed to upload media to cloud storage',
                details: error.message,
                http_code: error.http_code
            });
        }
        res.status(500).json({
            error: 'Failed to upload media',
            details: error.message || 'Unknown error'
        });
    }
});
// Error handling middleware for multer
router.use((error, _req, res, _next) => {
    if (error instanceof multer_1.default.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Only one file allowed.' });
        }
        return res.status(400).json({ error: error.message });
    }
    if (error.message === 'Only image and video files are allowed') {
        return res.status(400).json({ error: 'Only image and video files are allowed' });
    }
    _next(error);
});
exports.default = router;
//# sourceMappingURL=upload.js.map