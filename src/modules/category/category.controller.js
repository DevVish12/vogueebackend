const CategoryService = require('./category.service');
const { categoryCreateSchema, categoryUpdateSchema } = require('./category.validation');
const { successResponse, errorResponse } = require('../../utils/response');
const { getIO } = require('../../../socket/socket');

const emitCategoryUpdated = (payload) => {
  try {
    const io = getIO();
    const clientsCount = io?.engine?.clientsCount;

    // Debug log as requested
    // eslint-disable-next-line no-console
    console.log('CATEGORY EMIT', payload, typeof clientsCount === 'number' ? { clientsCount } : '');

    io.emit('categoryUpdated', payload);
  } catch {
    // socket not initialized (or disabled) - ignore
  }
};

const toPublicCategory = (req, row) => {
  if (!row) return row;
  const imageUrl = row.image_path
    ? `${req.protocol}://${req.get('host')}/${row.image_path.replace(/\\/g, '/')}`
    : null;
  return {
    ...row,
    imageUrl
  };
};

class CategoryController {
  static async list(req, res, next) {
    try {
      const rows = await CategoryService.listCategories();
      const data = rows.map((r) => toPublicCategory(req, r));
      return successResponse(res, 200, 'Categories fetched', data);
    } catch (err) {
      next(err);
    }
  }

  static async create(req, res, next) {
    try {
      const { error, value } = categoryCreateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        const errors = error.details.map((d) => d.message);
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      const imagePath = req.file ? `uploads/categories/${req.file.filename}` : null;
      const created = await CategoryService.createCategory({
        name: value.name,
        imagePath
      });

      emitCategoryUpdated({
        action: 'add',
        id: created?.id || null
      });

      return successResponse(res, 201, 'Category created', toPublicCategory(req, created));
    } catch (err) {
      next(err);
    }
  }

  static async update(req, res, next) {
    try {
      const { id } = req.params;
      const { error, value } = categoryUpdateSchema.validate(req.body, { abortEarly: false });
      if (error) {
        const errors = error.details.map((d) => d.message);
        return errorResponse(res, 400, 'Validation Error', errors);
      }

      const imagePath = req.file ? `uploads/categories/${req.file.filename}` : null;
      const updated = await CategoryService.updateCategory(Number(id), {
        name: value.name,
        imagePath
      });

      emitCategoryUpdated({
        action: 'update',
        id: updated?.id || Number(id) || null
      });

      return successResponse(res, 200, 'Category updated', toPublicCategory(req, updated));
    } catch (err) {
      next(err);
    }
  }

  static async remove(req, res, next) {
    try {
      const { id } = req.params;
      const result = await CategoryService.deleteCategory(Number(id));

      emitCategoryUpdated({
        action: 'delete',
        id: Number(id) || null
      });
      return successResponse(res, 200, result.message);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = CategoryController;
