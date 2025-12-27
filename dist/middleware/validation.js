"use strict";
// Validation middleware for common validation functions
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStringArray = exports.validateBooleanString = exports.validateNumericString = exports.validateAndSanitizeAddress = exports.sanitizeInput = exports.validateSocialLinks = exports.validateTokenMetadata = exports.validateDateRange = exports.validateSort = exports.validatePagination = exports.validatePassword = exports.validateUsername = exports.validateEmail = exports.validateURL = exports.validateAmount = exports.validateChainId = exports.validateTxHash = exports.validateAddress = void 0;
// Validate Ethereum address format
const validateAddress = (value) => {
    if (!value)
        return false;
    return /^0x[a-fA-F0-9]{40}$/.test(value);
};
exports.validateAddress = validateAddress;
// Validate transaction hash format
const validateTxHash = (value) => {
    if (!value)
        return false;
    return /^0x[a-fA-F0-9]{64}$/.test(value);
};
exports.validateTxHash = validateTxHash;
// Validate chain ID
const validateChainId = (value) => {
    const chainId = typeof value === 'string' ? parseInt(value) : value;
    return !isNaN(chainId) && chainId > 0;
};
exports.validateChainId = validateChainId;
// Validate amount (positive number string)
const validateAmount = (value) => {
    if (!value)
        return false;
    const amount = parseFloat(value);
    return !isNaN(amount) && amount >= 0;
};
exports.validateAmount = validateAmount;
// Validate URL format
const validateURL = (value) => {
    if (!value)
        return true; // Optional
    try {
        new URL(value);
        return true;
    }
    catch {
        return false;
    }
};
exports.validateURL = validateURL;
// Validate email format
const validateEmail = (value) => {
    if (!value)
        return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
};
exports.validateEmail = validateEmail;
// Validate username format
const validateUsername = (value) => {
    if (!value)
        return false;
    const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
    return usernameRegex.test(value);
};
exports.validateUsername = validateUsername;
// Validate password strength
const validatePassword = (value) => {
    if (!value)
        return false;
    // At least 6 characters, can contain letters, numbers, and special characters
    return value.length >= 6;
};
exports.validatePassword = validatePassword;
// Validate pagination parameters
const validatePagination = (page, pageSize) => {
    const pageNum = typeof page === 'string' ? parseInt(page) : page;
    const sizeNum = typeof pageSize === 'string' ? parseInt(pageSize) : pageSize;
    if (isNaN(pageNum) || pageNum < 1)
        return false;
    if (isNaN(sizeNum) || sizeNum < 1 || sizeNum > 100)
        return false;
    return true;
};
exports.validatePagination = validatePagination;
// Validate sort parameters
const validateSort = (sortBy, sortOrder) => {
    const validSortFields = [
        'createdAt', 'updatedAt', 'name', 'symbol', 'currentPriceUSD',
        'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent',
        'totalLiquidityUSD', 'blockNumber', 'blockTimestamp'
    ];
    const validSortOrders = ['asc', 'desc'];
    if (sortBy && !validSortFields.includes(sortBy))
        return false;
    if (sortOrder && !validSortOrders.includes(sortOrder))
        return false;
    return true;
};
exports.validateSort = validateSort;
// Validate date range
const validateDateRange = (startDate, endDate) => {
    if (!startDate || !endDate)
        return false;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
        return false;
    if (start >= end)
        return false;
    return true;
};
exports.validateDateRange = validateDateRange;
// Validate token metadata
const validateTokenMetadata = (metadata) => {
    const { name, symbol, description } = metadata;
    if (!name || name.length < 1 || name.length > 10)
        return false;
    if (!symbol || symbol.length < 1 || symbol.length > 7)
        return false;
    if (description && description.length > 200)
        return false;
    return true;
};
exports.validateTokenMetadata = validateTokenMetadata;
// Validate social links
const validateSocialLinks = (links) => {
    const validPlatforms = ['website', 'youtube', 'discord', 'twitter', 'telegram', 'github'];
    for (const [platform, url] of Object.entries(links)) {
        if (validPlatforms.includes(platform) && url && !(0, exports.validateURL)(url)) {
            return false;
        }
    }
    return true;
};
exports.validateSocialLinks = validateSocialLinks;
// Sanitize input data
const sanitizeInput = (data) => {
    if (typeof data === 'string') {
        return data.trim().replace(/[<>]/g, '');
    }
    if (typeof data === 'object' && data !== null) {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            sanitized[key] = (0, exports.sanitizeInput)(value);
        }
        return sanitized;
    }
    return data;
};
exports.sanitizeInput = sanitizeInput;
// Validate and sanitize address
const validateAndSanitizeAddress = (address) => {
    if (!address)
        return null;
    const sanitized = address.trim().toLowerCase();
    return (0, exports.validateAddress)(sanitized) ? sanitized : null;
};
exports.validateAndSanitizeAddress = validateAndSanitizeAddress;
// Validate numeric string
const validateNumericString = (value) => {
    if (!value)
        return false;
    return !isNaN(parseFloat(value)) && isFinite(parseFloat(value));
};
exports.validateNumericString = validateNumericString;
// Validate boolean string
const validateBooleanString = (value) => {
    if (!value)
        return false;
    return value === 'true' || value === 'false';
};
exports.validateBooleanString = validateBooleanString;
// Validate array of strings
const validateStringArray = (value) => {
    if (!Array.isArray(value))
        return false;
    return value.every(item => typeof item === 'string' && item.trim().length > 0);
};
exports.validateStringArray = validateStringArray;
//# sourceMappingURL=validation.js.map