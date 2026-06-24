const UserAuthModel = require('./userAuth.model');
const { generateToken } = require('../../utils/jwt');
const { sendNimbusSms } = require('../../utils/sms');

const normalizeMobile = (value) => String(value || '').replace(/\D/g, '').slice(-10);

class UserAuthService {
    static async devLogin({ mobile, countryCode }) {
        const cleanMobile = normalizeMobile(mobile);

        let user = await UserAuthModel.findByMobile(cleanMobile);
        let isNewUser = false;

        if (!user) {
            isNewUser = true;
            const id = await UserAuthModel.createUser({ mobile: cleanMobile, countryCode });
            user = await UserAuthModel.findById(id);
        } else {
            user = await UserAuthModel.findById(user.id);
        }

        const token = generateToken({ id: user.id, role: user.role, mobile: user.mobile });

        return {
            user,
            token,
            isNewUser
        };
    }

    static async sendOtp({ mobile, countryCode }) {
        const cleanMobile = normalizeMobile(mobile);

        // Rate limiting: Max 5 OTPs per 15 minutes
        const recentCount = await UserAuthModel.countRecentOtps(cleanMobile, 15);
        if (recentCount >= 5) {
            const error = new Error('Too many OTP requests. Please try again after 15 minutes.');
            error.statusCode = 429;
            throw error;
        }

        // Generate 6 digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        console.log(`[OTP GENERATED] Mobile: ${cleanMobile}, OTP: ${otp}`);

        // Invalidate old OTPs
        await UserAuthModel.invalidateOldOtps(cleanMobile);

        // Expiry 10 minutes from now
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Save OTP
        await UserAuthModel.saveOtp(cleanMobile, otp, expiresAt);
        console.log(`[OTP SAVED] Mobile: ${cleanMobile}`);

        // Send SMS via Nimbus
        await sendNimbusSms(cleanMobile, otp);

        return { success: true, message: 'OTP sent successfully' };
    }

    static async resendOtp({ mobile }) {
        return this.sendOtp({ mobile });
    }

    static async verifyOtp({ mobile, otp }) {
        const cleanMobile = normalizeMobile(mobile);

        const otpRecord = await UserAuthModel.findOtp(cleanMobile, otp);

        if (!otpRecord) {
            console.log(`[OTP VERIFY FAILED] Mobile: ${cleanMobile}, Reason: Invalid OTP`);
            const error = new Error('Invalid OTP');
            error.statusCode = 400;
            throw error;
        }

        if (new Date() > new Date(otpRecord.expires_at)) {
            console.log(`[OTP VERIFY FAILED] Mobile: ${cleanMobile}, Reason: OTP Expired`);
            const error = new Error('OTP has expired');
            error.statusCode = 400;
            throw error;
        }

        // Mark OTP as verified
        await UserAuthModel.markOtpVerified(otpRecord.id);
        console.log(`[OTP VERIFY SUCCESS] Mobile: ${cleanMobile}`);

        // Reuse devLogin logic to create or fetch user and generate token
        return this.devLogin({ mobile: cleanMobile });
    }

    static async updateProfile(userId, { name, gender, email, city }) {
        const user = await UserAuthModel.findById(userId);
        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        await UserAuthModel.updateProfile(userId, { name, gender, email, city });
        const updated = await UserAuthModel.findById(userId);
        return { user: updated };
    }

    static async updateAvatar(userId, avatar) {
        const user = await UserAuthModel.findById(userId);
        if (!user) {
            const error = new Error('User not found');
            error.statusCode = 404;
            throw error;
        }

        await UserAuthModel.updateAvatar(userId, avatar);
        const updated = await UserAuthModel.findById(userId);
        return { user: updated, avatar };
    }
}

module.exports = UserAuthService;
