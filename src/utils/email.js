const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true, // true for 465, false for other ports. Gmail uses 465 for secure.
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const sendResetEmail = async (toEmail, resetLink) => {
    const mailOptions = {
        from: `UrbanApp Admin System <${process.env.SMTP_FROM_EMAIL}>`,
        to: toEmail,
        subject: 'Password Reset Request',
        html: `
            <h2>Password Reset Request</h2>
            <p>You requested a password reset for your UrbanApp admin account.</p>
            <p>Please click the link below to reset your password. This link is valid for 1 hour.</p>
            <a href="${resetLink}" target="_blank">${resetLink}</a>
            <p>If you did not request this, please ignore this email.</p>
        `
    };

    return await transporter.sendMail(mailOptions);
};

module.exports = {
    sendResetEmail
};
