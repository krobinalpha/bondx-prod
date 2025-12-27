// Validation middleware for common validation functions

// Validate Ethereum address format
export const validateAddress = (value: string): boolean => {
  if (!value) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(value);
};

// Validate transaction hash format
export const validateTxHash = (value: string): boolean => {
  if (!value) return false;
  return /^0x[a-fA-F0-9]{64}$/.test(value);
};

// Validate chain ID
export const validateChainId = (value: string | number): boolean => {
  const chainId = typeof value === 'string' ? parseInt(value) : value;
  return !isNaN(chainId) && chainId > 0;
};

// Validate amount (positive number string)
export const validateAmount = (value: string): boolean => {
  if (!value) return false;
  const amount = parseFloat(value);
  return !isNaN(amount) && amount >= 0;
};

// Validate URL format
export const validateURL = (value: string): boolean => {
  if (!value) return true; // Optional
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

// Validate email format
export const validateEmail = (value: string): boolean => {
  if (!value) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value);
};

// Validate username format
export const validateUsername = (value: string): boolean => {
  if (!value) return false;
  const usernameRegex = /^[a-zA-Z0-9_]{3,15}$/;
  return usernameRegex.test(value);
};

// Validate password strength
export const validatePassword = (value: string): boolean => {
  if (!value) return false;
  // At least 6 characters, can contain letters, numbers, and special characters
  return value.length >= 6;
};

// Validate pagination parameters
export const validatePagination = (page: string | number, pageSize: string | number): boolean => {
  const pageNum = typeof page === 'string' ? parseInt(page) : page;
  const sizeNum = typeof pageSize === 'string' ? parseInt(pageSize) : pageSize;
  
  if (isNaN(pageNum) || pageNum < 1) return false;
  if (isNaN(sizeNum) || sizeNum < 1 || sizeNum > 100) return false;
  
  return true;
};

// Validate sort parameters
export const validateSort = (sortBy: string, sortOrder: string): boolean => {
  const validSortFields = [
    'createdAt', 'updatedAt', 'name', 'symbol', 'currentPriceUSD',
    'marketCapUSD', 'volume24hUSD', 'priceChange24hPercent',
    'totalLiquidityUSD', 'blockNumber', 'blockTimestamp'
  ];
  
  const validSortOrders = ['asc', 'desc'];
  
  if (sortBy && !validSortFields.includes(sortBy)) return false;
  if (sortOrder && !validSortOrders.includes(sortOrder)) return false;
  
  return true;
};

// Validate date range
export const validateDateRange = (startDate: string, endDate: string): boolean => {
  if (!startDate || !endDate) return false;
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  if (start >= end) return false;
  
  return true;
};

// Validate token metadata
export const validateTokenMetadata = (metadata: { name?: string; symbol?: string; description?: string }): boolean => {
  const { name, symbol, description } = metadata;
  
  if (!name || name.length < 1 || name.length > 10) return false;
  if (!symbol || symbol.length < 1 || symbol.length > 7) return false;
  if (description && description.length > 200) return false;
  
  return true;
};

// Validate social links
export const validateSocialLinks = (links: Record<string, string>): boolean => {
  const validPlatforms = ['website', 'youtube', 'discord', 'twitter', 'telegram', 'github'];
  
  for (const [platform, url] of Object.entries(links)) {
    if (validPlatforms.includes(platform) && url && !validateURL(url)) {
      return false;
    }
  }
  
  return true;
};

// Sanitize input data
export const sanitizeInput = (data: any): any => {
  if (typeof data === 'string') {
    return data.trim().replace(/[<>]/g, '');
  }
  
  if (typeof data === 'object' && data !== null) {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return data;
};

// Validate and sanitize address
export const validateAndSanitizeAddress = (address: string): string | null => {
  if (!address) return null;
  
  const sanitized = address.trim().toLowerCase();
  return validateAddress(sanitized) ? sanitized : null;
};

// Validate numeric string
export const validateNumericString = (value: string): boolean => {
  if (!value) return false;
  return !isNaN(parseFloat(value)) && isFinite(parseFloat(value));
};

// Validate boolean string
export const validateBooleanString = (value: string): boolean => {
  if (!value) return false;
  return value === 'true' || value === 'false';
};

// Validate array of strings
export const validateStringArray = (value: any): boolean => {
  if (!Array.isArray(value)) return false;
  return value.every(item => typeof item === 'string' && item.trim().length > 0);
};

