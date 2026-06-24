const AdminAuthService = require('./adminAuth.service');
const { registerSchema, loginSchema } = require('./adminAuth.validation');
const { successResponse, errorResponse } = require('../../utils/response');

class AdminAuthController {
    static async register(req, res, next) {
        try {
            const { error, value } = registerSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const newAdmin = await AdminAuthService.registerAdmin(value);
            return successResponse(res, 201, 'Admin registered successfully', newAdmin);
        } catch (error) {
            next(error);
        }
    }

    static async login(req, res, next) {
        try {
            const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const data = await AdminAuthService.loginAdmin(value);
            return successResponse(res, 200, 'Login successful', data);
        } catch (error) {
            next(error);
        }
    }

    static async getProfile(req, res, next) {
        try {
            const adminId = req.admin.id;
            const profile = await AdminAuthService.getAdminProfile(adminId);
            return successResponse(res, 200, 'Profile fetched', profile);
        } catch (error) {
            next(error);
        }
    }

    static async forgotPassword(req, res, next) {
        try {
            const { forgotPasswordSchema } = require('./adminAuth.validation');
            const { error, value } = forgotPasswordSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map(detail => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const result = await AdminAuthService.forgotPassword(value.email);
            return successResponse(res, 200, result.message);
        } catch (error) {
            next(error);
        }
    }

    static async resetPassword(req, res, next) {
        try {
            const { token } = req.params;
            const { resetPasswordSchema } = require('./adminAuth.validation');
            const { error, value } = resetPasswordSchema.validate(req.body, { abortEarly: false });
            
            if (error) {
                const errors = error.details.map(detail => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const result = await AdminAuthService.resetPassword(token, value.password);
            return successResponse(res, 200, result.message);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = AdminAuthController;
