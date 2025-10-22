import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const testEmail = async () => {
  try {
    console.log('Testing Zoho email configuration...');
    console.log('From:', process.env.ZOHO_USER);
    console.log('To: snoryder8019@gmail.com');
    console.log('---');

    // Create Zoho transporter
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
      },
    });

    // Send test email
    const result = await transporter.sendMail({
      from: process.env.ZOHO_USER,
      to: 'snoryder8019@gmail.com',
      subject: 'Zoho Mail Test - MadLadsLab',
      html: `
        <h2>Zoho Mail Test Email</h2>
        <p>Hello Scott,</p>
        <p>This is a test email from MadLadsLab using Zoho Mail SMTP.</p>
        <p>If you're reading this, the Zoho Mail configuration is working correctly!</p>
        <hr>
        <p><small>Sent at: ${new Date().toLocaleString()}</small></p>
      `,
    });

    console.log('✓ Email sent successfully!');
    console.log('Message ID:', result.messageId);
    console.log('Response:', result.response);
    process.exit(0);
  } catch (error) {
    console.error('✗ Email failed to send:');
    console.error('Error:', error.message);
    if (error.code) console.error('Error Code:', error.code);
    if (error.command) console.error('Command:', error.command);
    process.exit(1);
  }
};

testEmail();
