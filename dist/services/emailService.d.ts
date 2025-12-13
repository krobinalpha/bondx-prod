interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}
/**
 * Send email using SendGrid
 */
export declare function sendEmail(options: EmailOptions): Promise<void>;
/**
 * Generate HTML email template for verification code
 */
export declare function generateVerificationEmail(code: string): string;
/**
 * Generate plain text email for verification code
 */
export declare function generateVerificationEmailText(code: string): string;
export {};
//# sourceMappingURL=emailService.d.ts.map