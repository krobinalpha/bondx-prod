import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize SendGrid with trimmed API key
const initializeSendGrid = () => {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (apiKey) {
    sgMail.setApiKey(apiKey);
    return true;
  }
  return false;
};

// Initialize on module load
initializeSendGrid();

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send email using SendGrid
 */
export async function sendEmail(options: EmailOptions): Promise<void> {
  // Trim and validate API key
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  const fromEmail = process.env.SENDGRID_FROM_EMAIL?.trim();

  if (!apiKey) {
    throw new Error('SENDGRID_API_KEY is not configured');
  }

  if (!fromEmail) {
    throw new Error('SENDGRID_FROM_EMAIL is not configured');
  }

  // Validate API key format
  if (!apiKey.startsWith('SG.')) {
    throw new Error('Invalid SendGrid API key format. API key should start with "SG."');
  }

  // Re-initialize SendGrid with trimmed API key on each call
  // This ensures we always use the latest env vars
  try {
    sgMail.setApiKey(apiKey);
  } catch (setKeyError: any) {
    throw new Error(`Failed to set SendGrid API key: ${setKeyError.message}`);
  }

  const msg = {
    to: options.to,
    from: fromEmail,
    subject: options.subject,
    text: options.text || options.subject,
    html: options.html,
  };

  try {
    await sgMail.send(msg);
    console.log(`✅ Email sent successfully to ${options.to}`);
  } catch (error: any) {
    // Enhanced error logging
    const errorDetails = {
      message: error.message,
      code: error.code,
      response: error.response?.body,
      statusCode: error.response?.statusCode,
      apiKeyPrefix: apiKey.substring(0, 15) + '...',
      fromEmail: fromEmail,
      apiKeyLength: apiKey.length,
    };

    console.error('SendGrid error details:', JSON.stringify(errorDetails, null, 2));

    // Provide more specific error messages
    if (error.response?.body?.errors) {
      const errorMsg = error.response.body.errors[0]?.message;
      if (errorMsg?.includes('Permission denied') || errorMsg?.includes('wrong credentials')) {
        // Most common issue: API key doesn't have Mail Send permission
        throw new Error(
          `SendGrid authentication failed: ${errorMsg}\n\n` +
          `This usually means:\n` +
          `1. The API key doesn't have "Mail Send" permission enabled\n` +
          `2. Go to SendGrid Dashboard > Settings > API Keys\n` +
          `3. Click on your API key and ensure "Mail Send" is checked\n` +
          `4. If using "Restricted Access", make sure "Mail Send" scope is enabled\n` +
          `5. Try creating a new API key with "Full Access" to test\n` +
          `6. Ensure the API key and sender email belong to the same SendGrid account`
        );
      }
      throw new Error(`SendGrid error: ${errorMsg}`);
    }

    throw new Error(`Failed to send email: ${error.message}`);
  }
}

/**
 * Generate HTML email template for verification code
 */
export function generateVerificationEmail(code: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">BondX</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; color: #333333; font-size: 24px; font-weight: 600;">Verify Your Email</h2>
              <p style="margin: 0 0 20px; color: #666666; font-size: 16px; line-height: 1.6;">
                Thank you for signing up! Please use the verification code below to complete your authentication:
              </p>
              
              <!-- Code Box -->
              <div style="background-color: #f8f9fa; border: 2px dashed #667eea; border-radius: 8px; padding: 30px; text-align: center; margin: 30px 0;">
                <div style="font-size: 36px; font-weight: 700; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                  ${code}
                </div>
              </div>
              
              <p style="margin: 20px 0 0; color: #999999; font-size: 14px; line-height: 1.6;">
                This code will expire in <strong>10 minutes</strong>. If you didn't request this code, please ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; text-align: center; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; color: #999999; font-size: 12px; line-height: 1.6;">
                © ${new Date().getFullYear()} BondX. All rights reserved.<br>
                This is an automated email, please do not reply.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Generate plain text email for verification code
 */
export function generateVerificationEmailText(code: string): string {
  return `
BondX - Email Verification

Thank you for signing up! Please use the verification code below to complete your authentication:

Verification Code: ${code}

This code will expire in 10 minutes. If you didn't request this code, please ignore this email.

© ${new Date().getFullYear()} BondX. All rights reserved.
This is an automated email, please do not reply.
  `.trim();
}

