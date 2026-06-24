const Joi = require('joi');

const categoryCreateSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    'string.empty': 'Category name required',
    'string.min': 'Category name must be at least 2 characters'
  })
});

const categoryUpdateSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    'string.empty': 'Category name required',
    'string.min': 'Category name must be at least 2 characters'
  })
});

module.exports = {
  categoryCreateSchema,
  categoryUpdateSchema
};
