const nodemailer = require('nodemailer');

// Mailjet SMTP relay via nodemailer (Gmail SMTP hit its daily sending limit).
const transporter = nodemailer.createTransport({
  host: 'in-v3.mailjet.com',
  port: 587,
  auth: {
    user: process.env.MAILJET_API_KEY,
    pass: process.env.MAILJET_SECRET_KEY
  }
});

// Mailjet requires the sender to be a verified address.
const FROM = process.env.MAILJET_FROM || process.env.SMTP_MAIL || process.env.EMAIL_USER;

async function sendOTPEmail(email, otp) {
  try {
    const mailOptions = {
      from: FROM,
      to: email,
      subject: 'CryptoGT - Password Reset OTP',
      html: `
        <h2>Password Reset Request</h2>
        <p>You requested to reset your password. Here is your one-time password (OTP):</p>
        <p style="font-size: 24px; font-weight: bold; color: #0066cc; letter-spacing: 2px; margin: 20px 0;">
          ${otp}
        </p>
        <p><strong>This OTP will expire in 10 minutes.</strong></p>
        <p>If you did not request this, please ignore this email.</p>
        <hr>
        <p style="color: #666; font-size: 12px;">Do not share this OTP with anyone.</p>
      `
    };

    console.log(`Sending OTP email to ${email} from ${process.env.SMTP_MAIL}`);
    const result = await transporter.sendMail(mailOptions);
    console.log(`OTP email sent successfully to ${email}`);
    return result;
  } catch (error) {
    console.error(`Failed to send OTP email to ${email}:`, error.message);
    throw error;
  }
}

async function sendTemporaryPasswordEmail(email, userId, temporaryPassword) {
  try {
    const mailOptions = {
      from: FROM,
      to: email,
      subject: 'Your CryptoGT Account - Temporary Password',
      html: `
        <h2>Welcome to CryptoGT!</h2>
        <p>Your account has been created. Here are your temporary login credentials:</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Temporary Password:</strong> <code>${temporaryPassword}</code></p>
        <p style="color: red;"><strong>Important:</strong> Please change this password immediately after your first login.</p>
        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/login">Login to your account</a></p>
        <hr>
        <p>If you did not create this account, please ignore this email.</p>
      `
    };

    console.log(`Sending password email to ${email}`);
    const result = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${email}`);
    return result;
  } catch (error) {
    console.error(`Failed to send email to ${email}:`, error.message);
    throw error;
  }
}

async function sendPasswordChangedEmail(email, userId) {
  try {
    const mailOptions = {
      from: FROM,
      to: email,
      subject: 'CryptoGT - Password Changed Successfully',
      html: `
        <h2>Password Changed</h2>
        <p>Your password has been changed successfully.</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p>If you did not request this change, please contact support immediately.</p>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Password confirmation email sent to ${email}`);
    return result;
  } catch (error) {
    console.error(`Failed to send password confirmation email to ${email}:`, error);
    throw error;
  }
}

async function verifyEmailConnection() {
  try {
    await transporter.verify();
    console.log('Email service is ready');
    return true;
  } catch (error) {
    console.error('Email service verification failed:', error);
    return false;
  }
}

module.exports = {
  sendOTPEmail,
  sendTemporaryPasswordEmail,
  sendPasswordChangedEmail,
  verifyEmailConnection
};
