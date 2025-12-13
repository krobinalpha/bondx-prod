import express, { Request, Response } from 'express';

// Import emailCodeStore from auth route
// Note: This is a workaround - in production, use Redis or a shared store
const emailCodeStore = (global as any).emailCodeStore || new Map();

const router = express.Router();

// Debug endpoint to check stored codes (development only)
// GET /api/debug/email-codes - Check stored verification codes
router.get('/email-codes', (_req: Request, res: Response): Response | void => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints disabled in production' });
  }

  const codes: Array<{
    email: string;
    code: string;
    expiresAt: number;
    attempts: number;
    isExpired: boolean;
    timeRemaining: number;
  }> = [];

  const now = Date.now();
  for (const [email, data] of emailCodeStore.entries()) {
    codes.push({
      email,
      code: data.code,
      expiresAt: data.expiresAt,
      attempts: data.attempts,
      isExpired: data.expiresAt < now,
      timeRemaining: Math.max(0, Math.floor((data.expiresAt - now) / 1000)),
    });
  }

  res.json({
    totalCodes: codes.length,
    codes: codes,
  });
});

// GET /api/debug/email-codes/:email - Check code for specific email
router.get('/email-codes/:email', async (req: Request, res: Response): Promise<Response | void> => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Debug endpoints disabled in production' });
  }

  const email = req.params.email.toLowerCase().trim();
  const stored = emailCodeStore.get(email);

  if (!stored) {
    return res.json({
      email,
      found: false,
      message: 'No code found for this email',
    });
  }

  const now = Date.now();
  res.json({
    email,
    found: true,
    code: stored.code,
    codeType: typeof stored.code,
    codeLength: String(stored.code).length,
    expiresAt: stored.expiresAt,
    attempts: stored.attempts,
    isExpired: stored.expiresAt < now,
    timeRemaining: Math.max(0, Math.floor((stored.expiresAt - now) / 1000)),
    expiresAtFormatted: new Date(stored.expiresAt).toISOString(),
  });
});

export default router;

