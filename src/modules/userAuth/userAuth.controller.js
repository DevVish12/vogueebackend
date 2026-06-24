const UserAuthService = require('./userAuth.service');
const { devLoginSchema, updateProfileSchema, sendOtpSchema, verifyOtpSchema } = require('./userAuth.validation');
const { successResponse, errorResponse } = require('../../utils/response');
const { getIO } = require('../../../socket/socket');

class UserAuthController {
    static async devLogin(req, res, next) {
        try {
            const { error, value } = devLoginSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const data = await UserAuthService.devLogin(value);

            // Real-time sync (best-effort): when a new user is created, notify connected admin clients.
            if (data?.isNewUser) {
                try {
                    const io = getIO();
                    io.emit('userCreated', {
                        user: data?.user
                    });
                } catch (e) {
                    // Socket not initialized or failed — don't block the HTTP response.
                    if (process.env.NODE_ENV !== 'production') {
                        // eslint-disable-next-line no-console
                        console.log('[userAuth.devLogin] socket emit skipped:', e?.message || e);
                    }
                }
            }
            return successResponse(res, 200, 'Login successful', data);
        } catch (err) {
            next(err);
        }
    }

    static async sendOtp(req, res, next) {
        try {
            const { error, value } = sendOtpSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }
            const data = await UserAuthService.sendOtp(value);
            return successResponse(res, 200, 'OTP sent successfully', data);
        } catch (err) {
            next(err);
        }
    }

    static async resendOtp(req, res, next) {
        try {
            const { error, value } = sendOtpSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }
            const data = await UserAuthService.resendOtp(value);
            return successResponse(res, 200, 'OTP resent successfully', data);
        } catch (err) {
            next(err);
        }
    }

    static async verifyOtp(req, res, next) {
        try {
            const { error, value } = verifyOtpSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const data = await UserAuthService.verifyOtp(value);

            if (data?.isNewUser) {
                try {
                    const io = getIO();
                    io.emit('userCreated', {
                        user: data?.user
                    });
                } catch (e) {
                    if (process.env.NODE_ENV !== 'production') {
                        // eslint-disable-next-line no-console
                        console.log('[userAuth.verifyOtp] socket emit skipped:', e?.message || e);
                    }
                }
            }
            return successResponse(res, 200, 'OTP verified successfully', data);
        } catch (err) {
            next(err);
        }
    }

    static async updateProfile(req, res, next) {
        try {
            console.log('[userAuth.updateProfile] hit', {
                url: req.originalUrl,
                hasAuthHeader: Boolean(req.headers?.authorization),
                user: req.user,
                body: req.body
            });

            const { error, value } = updateProfileSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const userId = req.user?.id;
            const data = await UserAuthService.updateProfile(userId, value);

            // Real-time sync (best-effort): broadcast updated user to connected clients.
            try {
                const io = getIO();
                io.emit('userUpdated', {
                    userId,
                    user: data?.user
                });
            } catch (e) {
                // Socket not initialized or failed — don't block the HTTP response.
                if (process.env.NODE_ENV !== 'production') {
                    // eslint-disable-next-line no-console
                    console.log('[userAuth.updateProfile] socket emit skipped:', e?.message || e);
                }
            }
            return successResponse(res, 200, 'Profile updated', data);
        } catch (err) {
            next(err);
        }
    }

    static async uploadProfileImage(req, res, next) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return errorResponse(res, 401, 'Unauthorized');
            }

            // Debug: helps confirm if multer received the file
            if (process.env.NODE_ENV !== 'production') {
                // eslint-disable-next-line no-console
                console.log('FILE:', req.file);
            }

            if (!req.file) {
                return errorResponse(res, 400, 'No image uploaded');
            }

            const imageUrl = `/uploads/profile/${req.file.filename}`;
            const data = await UserAuthService.updateAvatar(userId, imageUrl);

            // Real-time sync (best-effort)
            try {
                const io = getIO();
                io.emit('userUpdated', {
                    userId,
                    user: data?.user
                });
            } catch (e) {
                if (process.env.NODE_ENV !== 'production') {
                    // eslint-disable-next-line no-console
                    console.log('[userAuth.uploadProfileImage] socket emit skipped:', e?.message || e);
                }
            }

            return successResponse(res, 200, 'Profile image updated', {
                avatar: imageUrl,
                user: data?.user
            });
        } catch (err) {
            next(err);
        }
    }
}

module.exports = UserAuthController;
