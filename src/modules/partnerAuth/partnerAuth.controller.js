


// const PartnerAuthService = require('./partnerAuth.service');
// const { devLoginSchema, sendOtpSchema, verifyOtpSchema } = require('./partnerAuth.validation');
// const { successResponse, errorResponse } = require('../../utils/response');

// class PartnerAuthController {
//   static async devLogin(req, res, next) {
//     try {
//       const { error, value } = devLoginSchema.validate(req.body, { abortEarly: false });
//       if (error) {
//         const errors = error.details.map((detail) => detail.message);
//         return errorResponse(res, 400, 'Validation Error', errors);
//       }

//       const data = await PartnerAuthService.devLogin(value);

//       // Real-time update: notify admin panel when a new partner is created.
//       if (data?.isNewPartner) {
//         const io = req.app.get('io');
//         if (io) {
//           io.emit('partner:new', data?.partner);
//         }
//       }
//       return successResponse(res, 200, 'Login successful', data);
//     } catch (err) {
//       next(err);
//     }
//   }

//   static async sendOtp(req, res, next) {
//       try {
//           const { error, value } = sendOtpSchema.validate(req.body, { abortEarly: false });
//           if (error) {
//               const errors = error.details.map((detail) => detail.message);
//               return errorResponse(res, 400, 'Validation Error', errors);
//           }
//           const data = await PartnerAuthService.sendOtp(value);
//           return successResponse(res, 200, 'OTP sent successfully', data);
//       } catch (err) {
//           next(err);
//       }
//   }

//   static async resendOtp(req, res, next) {
//       try {
//           const { error, value } = sendOtpSchema.validate(req.body, { abortEarly: false });
//           if (error) {
//               const errors = error.details.map((detail) => detail.message);
//               return errorResponse(res, 400, 'Validation Error', errors);
//           }
//           const data = await PartnerAuthService.resendOtp(value);
//           return successResponse(res, 200, 'OTP resent successfully', data);
//       } catch (err) {
//           next(err);
//       }
//   }

//   static async verifyOtp(req, res, next) {
//       try {
//           const { error, value } = verifyOtpSchema.validate(req.body, { abortEarly: false });
//           if (error) {
//               const errors = error.details.map((detail) => detail.message);
//               return errorResponse(res, 400, 'Validation Error', errors);
//           }

//           const data = await PartnerAuthService.verifyOtp(value);

//           if (data?.isNewPartner) {
//               const io = req.app.get('io');
//               if (io) {
//                   io.emit('partner:new', data?.partner);
//               }
//           }
//           return successResponse(res, 200, 'OTP verified successfully', data);
//       } catch (err) {
//           next(err);
//       }
//   }

//   static async me(req, res, next) {
//     try {
//       const partnerId = req.partner?.id;
//       const data = await PartnerAuthService.me(partnerId);
//       return successResponse(res, 200, 'Partner profile', data);
//     } catch (err) {
//       next(err);
//     }
//   }

//   static async deleteAccount(req, res, next) {
//     try {
//       const partnerId = req.partner?.id;
//       const device = req.headers['user-agent'] || req.headers['x-device-model'] || req.headers['x-device-name'] || null;
//       const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || null;

//       const data = await PartnerAuthService.deleteAccount({ partnerId, ip: Array.isArray(ip) ? ip[0] : ip, device });
//       return successResponse(res, 200, 'Partner account deleted successfully', data);
//     } catch (err) {
//       next(err);
//     }
//   }
// }

// module.exports = PartnerAuthController;














const PartnerAuthService = require('./partnerAuth.service');
const { devLoginSchema, sendOtpSchema, verifyOtpSchema } = require('./partnerAuth.validation');
const { successResponse, errorResponse } = require('../../utils/response');

class PartnerAuthController {
    static async devLogin(req, res, next) {
        try {
            const { error, value } = devLoginSchema.validate(req.body, { abortEarly: false });
            if (error) {
                const errors = error.details.map((detail) => detail.message);
                return errorResponse(res, 400, 'Validation Error', errors);
            }

            const data = await PartnerAuthService.devLogin(value);

            // Real-time update: notify admin panel when a new partner is created.
            if (data?.isNewPartner) {
                const io = req.app.get('io');
                if (io) {
                    io.emit('partner:new', data?.partner);
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
            const data = await PartnerAuthService.sendOtp(value);
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
            const data = await PartnerAuthService.resendOtp(value);
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

            const data = await PartnerAuthService.verifyOtp(value);

            if (data?.isNewPartner) {
                const io = req.app.get('io');
                if (io) {
                    io.emit('partner:new', data?.partner);
                }
            }
            return successResponse(res, 200, 'OTP verified successfully', data);
        } catch (err) {
            next(err);
        }
    }

    static async refresh(req, res, next) {
        try {
            const { refreshToken } = req.body || {};
            const data = await PartnerAuthService.refreshSession({ refreshToken });
            return successResponse(res, 200, 'Session refreshed', data);
        } catch (err) {
            next(err);
        }
    }

    static async logout(req, res, next) {
        try {
            const refreshToken = req.body?.refreshToken || req.headers['x-refresh-token'] || null;
            const data = await PartnerAuthService.logout({ partnerId: req.partner?.id, refreshToken });
            return successResponse(res, 200, 'Logged out successfully', data);
        } catch (err) {
            next(err);
        }
    }

    static async me(req, res, next) {
        try {
            const partnerId = req.partner?.id;
            const data = await PartnerAuthService.me(partnerId);
            return successResponse(res, 200, 'Partner profile', data);
        } catch (err) {
            next(err);
        }
    }

    static async deleteAccount(req, res, next) {
        try {
            const partnerId = req.partner?.id;
            const device = req.headers['user-agent'] || req.headers['x-device-model'] || req.headers['x-device-name'] || null;
            const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress || null;

            const data = await PartnerAuthService.deleteAccount({ partnerId, ip: Array.isArray(ip) ? ip[0] : ip, device });
            return successResponse(res, 200, 'Partner account deleted successfully', data);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = PartnerAuthController;
