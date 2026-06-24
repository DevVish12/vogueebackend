const fs = require('fs/promises');
const path = require('path');
const CategoryModel = require('./category.model');

const safeUnlink = async (relativePath) => {
  if (!relativePath) return;

  // Expect stored path like: uploads/categories/<file>
  const absolutePath = path.join(__dirname, '..', '..', '..', relativePath);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // ignore missing file
  }
};

class CategoryService {
  static async listCategories() {
    return await CategoryModel.getAll();
  }

  static async createCategory({ name, imagePath }) {
    if (!imagePath) {
      const error = new Error('Image required');
      error.statusCode = 400;
      throw error;
    }

    try {
      // Now returns the full row
      const created = await CategoryModel.create({ name, imagePath });
      return created;
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        const error = new Error('Category name already exists');
        error.statusCode = 400;
        throw error;
      }
      throw err;
    }
  }

  static async updateCategory(id, { name, imagePath }) {
    const existing = await CategoryModel.getById(id);
    if (!existing) {
      const error = new Error('Category not found');
      error.statusCode = 404;
      throw error;
    }

    let updated;
    if (imagePath) {
      updated = await CategoryModel.update(id, { name, imagePath });
      await safeUnlink(existing.image_path);
    } else {
      updated = await CategoryModel.update(id, { name });
    }
    return updated;
  }

  static async deleteCategory(id) {
    const existing = await CategoryModel.getById(id);
    if (!existing) {
      const error = new Error('Category not found');
      error.statusCode = 404;
      throw error;
    }

    await CategoryModel.remove(id);
    await safeUnlink(existing.image_path);
    return { message: 'Category deleted' };
  }
}

module.exports = CategoryService;
