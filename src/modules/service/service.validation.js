const Joi = require('joi');

const serviceCreateSchema = Joi.object({
  categoryId: Joi.number().integer().positive().required().messages({
    'any.required': 'Category required',
    'number.base': 'Category required'
  }),
  serviceName: Joi.string().min(2).max(150).required().messages({
    'string.empty': 'Service name required'
  }),
  description: Joi.string().min(2).required().messages({
    'string.empty': 'Description required'
  }),
  basePrice: Joi.number().positive().required().messages({
    'number.base': 'Base Price required'
  }),
  discountPrice: Joi.number().min(0).allow('', null),
  commissionType: Joi.string().valid('percentage', 'fixed').default('percentage'),
  commissionValue: Joi.number().min(0).default(0),
  commissionEnabled: Joi.boolean().default(true),
  duration: Joi.number().integer().positive().required().messages({
    'number.base': 'Duration required'
  }),
  variants: Joi.string().max(255).allow('', null),
  isMVP: Joi.boolean().default(false),
  isFeatured: Joi.boolean().default(false),
  badges: Joi.string().allow('', null),
  // showSeasonal: Joi.boolean().default(false), // Removed as per requirements
  showQuick: Joi.boolean().default(false),
  rating: Joi.number().min(0).max(5).allow('', null),
  reviews: Joi.number().min(0).allow('', null),
  status: Joi.string().valid('Active', 'Paused', 'Draft').default('Active')
});

const serviceUpdateSchema = serviceCreateSchema.keys({
  commissionType: Joi.string().valid('percentage', 'fixed').optional(),
  commissionValue: Joi.number().min(0).optional(),
  commissionEnabled: Joi.boolean().optional(),
});

module.exports = {
  serviceCreateSchema,
  serviceUpdateSchema
};
