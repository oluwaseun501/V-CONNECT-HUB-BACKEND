const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: { rejectUnauthorized: false }  // ← add this
});

// Add this new function before module.exports:
const testEmailConnection = async () => {
  try {
    await transporter.verify();
    return { ok: true, message: 'SMTP connection successful' };
  } catch (error) {
    return { ok: false, message: error.message };
  }
};


const sendWelcomeEmail = async (name, email) => {
  const mailOptions = {
    from: `"V Connect Hub" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: 'Welcome to V Connect Hub! 🎉',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Welcome to V Connect Hub, ${name}! 🎉</h2>
        <p>Thank you for registering. Your account has been created successfully.</p>
        <p>You can now enjoy our services:</p>
        <ul>
          <li>Buy Virtual Numbers</li>
          <li>Fund your wallet</li>
          <li>And much more!</li>
        </ul>
        <p>If you have any questions, reply to this email.</p>
        <br/>
        <p>Best regards,<br/><strong>V Connect Hub Team</strong></p>
      </div>
    `
  };
  await transporter.sendMail(mailOptions);
};

const sendPasswordResetEmail = async (name, email, resetURL) => {
    const mailOptions = {
        from: `"V Connect Hub" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Password Reset Request',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Password Reset</h2>
            <p>Hi ${name}, you requested to reset your password.</p>
            <p>Click the button below — this link expires in <strong>15 minutes</strong>:</p>
            <a href="${resetURL}" style="display:inline-block; padding:12px 24px; background:#2563eb; color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
              Reset Password
            </a>
            <p>If you didn't request this, ignore this email — your password won't change.</p>
            <br/>
            <p>Best regards,<br/><strong>V Connect Hub Team</strong></p>
          </div>
        `
    };
    await transporter.sendMail(mailOptions);
};

const sendVerificationEmail = async (name, email, verifyURL) => {
    const mailOptions = {
        from: `"V Connect Hub" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Verify Your Email Address',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">Verify Your Email, ${name}!</h2>
            <p>Thank you for registering on V Connect Hub. Please verify your email to activate your account.</p>
            <a href="${verifyURL}" style="display:inline-block; padding:12px 24px; background:#2563eb; color:#fff; text-decoration:none; border-radius:6px; margin:16px 0;">
              Verify Email
            </a>
            <p>This link expires in <strong>24 hours</strong>.</p>
            <p>If you didn't create an account, ignore this email.</p>
            <br/>
            <p>Best regards,<br/><strong>V Connect Hub Team</strong></p>
          </div>
        `
    };
    await transporter.sendMail(mailOptions);
};

module.exports = { sendWelcomeEmail, sendPasswordResetEmail, sendVerificationEmail, testEmailConnection };
