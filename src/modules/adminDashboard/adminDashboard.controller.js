const { successResponse } = require('../../utils/response');
const { fetchDashboardSummary } = require('./adminDashboard.service');

class AdminDashboardController {
  static async summary(req, res, next) {
    try {
      const data = await fetchDashboardSummary();
      return successResponse(res, 200, 'Dashboard summary fetched', data);
    } catch (error) {
      return next(error);
    }
  }
}

module.exports = AdminDashboardController;