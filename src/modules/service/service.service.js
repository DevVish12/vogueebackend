const ServiceModel = require('./service.model');
const fs = require('fs/promises');
const path = require('path');

const safeUnlink = async (relativePath) => {
  if (!relativePath) return;
  const absolutePath = path.join(__dirname, '..', '..', '..', relativePath);
  try {
    await fs.unlink(absolutePath);
  } catch {
    // ignore
  }
};

const parseImagePaths = (row) => {
  if (!row || !row.image_paths) return [];
  try {
    const parsed = JSON.parse(row.image_paths);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

class ServiceService {
  static async listServices() {
    return await ServiceModel.getAll();
  }

  static async getServiceById(id) {
    return await ServiceModel.getById(id);
  }

  static async createService(payload) {
    const normalized = payload && typeof payload === 'object' ? payload : {};
    const categoryId = typeof normalized.categoryId !== 'undefined'
      ? normalized.categoryId
      : (typeof normalized.category_id !== 'undefined' ? normalized.category_id : normalized.chapter_id);

    return await ServiceModel.create({
      ...normalized,
      categoryId
    });
  }

  static async updateService(id, payload) {
    const existing = await ServiceModel.getById(id);
    if (!existing) {
      const error = new Error('Service not found');
      error.statusCode = 404;
      throw error;
    }

    const beforePaths = parseImagePaths(existing);
    const updated = await ServiceModel.update(id, payload);

    // Delete files that were removed
    const afterPaths = parseImagePaths(updated);
    const keep = new Set(afterPaths);
    const removed = beforePaths.filter((p) => p && !keep.has(p));
    for (const p of removed) await safeUnlink(p);

    return updated;
  }

  static async deleteService(id) {
    const existing = await ServiceModel.getById(id);
    if (!existing) {
      const error = new Error('Service not found');
      error.statusCode = 404;
      throw error;
    }

    const paths = parseImagePaths(existing);
    await ServiceModel.remove(id);
    for (const p of paths) await safeUnlink(p);
    return { message: 'Service deleted' };
  }

  static async updateCommission(id, payload) {
    const existing = await ServiceModel.getById(id);
    if (!existing) {
      const error = new Error('Service not found');
      error.statusCode = 404;
      throw error;
    }

    return await ServiceModel.updateCommission(id, payload);
  }
}

module.exports = ServiceService;
