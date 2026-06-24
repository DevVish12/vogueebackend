const Joi = require('joi');

const mobileSchema = Joi.string()
  .trim()
  .pattern(/^\d{10}$/)
  .required()
  .messages({
    'string.pattern.base': 'Mobile must be a 10-digit number',
    'any.required': 'Mobile is required',
  });

const devLoginSchema = Joi.object({
  mobile: mobileSchema,
  countryCode: Joi.string().trim().max(6).optional().default('+91'),
});

const sendOtpSchema = Joi.object({
  mobile: mobileSchema,
  countryCode: Joi.string().trim().max(6).optional().default('+91'),
});

const verifyOtpSchema = Joi.object({
  mobile: mobileSchema,
  otp: Joi.string().trim().length(6).required().messages({
    'string.length': 'OTP must be 6 digits',
    'any.required': 'OTP is required'
  })
});

module.exports = {
  devLoginSchema,
  sendOtpSchema,
  verifyOtpSchema,
};
