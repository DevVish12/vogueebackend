const Joi = require('joi');

const mobileSchema = Joi.string()
    .trim()
    .pattern(/^\d{10}$/)
    .required()
    .messages({
        'string.pattern.base': 'Mobile must be a 10-digit number',
        'any.required': 'Mobile is required'
    });

const devLoginSchema = Joi.object({
    mobile: mobileSchema,
    countryCode: Joi.string().trim().max(6).optional().default('+91')
});

const updateProfileSchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required().messages({
        'any.required': 'Name is required'
    }),
    email: Joi.string().trim().email().allow('', null).optional(),
    gender: Joi.string().trim().valid('male', 'female', 'other').required().messages({
        'any.only': 'Gender must be one of: male, female, other',
        'any.required': 'Gender is required'
    }),
    city: Joi.string().trim().max(100).allow('', null).optional()
});

const sendOtpSchema = Joi.object({
    mobile: mobileSchema,
    countryCode: Joi.string().trim().max(6).optional().default('+91')
});

const verifyOtpSchema = Joi.object({
    mobile: mobileSchema,
    otp: Joi.string().trim().length(6).required().messages({
        'string.length': 'OTP must be exactly 6 characters',
        'any.required': 'OTP is required'
    })
});

module.exports = {
    devLoginSchema,
    updateProfileSchema,
    sendOtpSchema,
    verifyOtpSchema
};
