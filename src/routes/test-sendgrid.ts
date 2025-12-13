import express, { Request, Response } from 'express';
import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Test endpoint to verify SendGrid configuration
// GET /api/test/sendgrid - Test SendGrid credentials
router.get('/sendgrid', async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const apiKey = process.env.SENDGRID_API_KEY?.trim();
    const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();

    if (!apiKey) {
      return res.status(400).json({ 
        error: 'SENDGRID_API_KEY is not configured',
        details: 'Please set SENDGRID_API_KEY in your .env file'
      });
    }

    if (!fromEmail) {
      return res.status(400).json({ 
        error: 'SENDGRID_FROM_EMAIL is not configured',
        details: 'Please set SENDGRID_FROM_EMAIL in your .env file'
      });
    }

    // Validate API key format
    if (!apiKey.startsWith('SG.')) {
      return res.status(400).json({ 
        error: 'Invalid API key format',
        details: 'API key should start with "SG."',
        apiKeyPrefix: apiKey.substring(0, 15) + '...'
      });
    }

    // Set API key
    sgMail.setApiKey(apiKey);

    // Try to send a test email
    const testEmail = req.query.email as string || fromEmail;
    
    const msg = {
      to: testEmail,
      from: fromEmail,
      subject: 'SendGrid Test Email',
      text: 'This is a test email from SendGrid integration.',
      html: '<p>This is a test email from SendGrid integration.</p>',
    };

    try {
      await sgMail.send(msg);
      res.json({
        success: true,
        message: 'Test email sent successfully!',
        details: {
          apiKeyLength: apiKey.length,
          apiKeyPrefix: apiKey.substring(0, 15) + '...',
          fromEmail: fromEmail,
          testEmail: testEmail,
        }
      });
    } catch (sendError: any) {
      const errorDetails = {
        message: sendError.message,
        code: sendError.code,
        response: sendError.response?.body,
        statusCode: sendError.response?.statusCode,
      };

      res.status(500).json({
        success: false,
        error: 'Failed to send test email',
        details: errorDetails,
        troubleshooting: {
          step1: 'Check that your API key has "Mail Send" permission in SendGrid dashboard',
          step2: 'Verify the sender email is verified in SendGrid',
          step3: 'Ensure API key and sender email belong to the same SendGrid account',
          step4: 'Try creating a new API key with "Full Access"',
        }
      });
    }
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'Error testing SendGrid',
      message: error.message,
    });
  }
});

export default router;


