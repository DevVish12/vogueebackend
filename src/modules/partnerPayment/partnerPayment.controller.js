const PartnerPaymentService = require('./partnerPayment.service');
const { successResponse, errorResponse } = require('../../utils/response');

class PartnerPaymentController {
  static async saveUpi(req, res, next) {
    try {
      const partnerId = req.partner?.id;
      const jwtMobile = req.partner?.mobile;

      if (!partnerId || !jwtMobile) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      // Validate request body
      const { upi_id } = req.body;
      if (!upi_id) {
        return errorResponse(res, 400, 'UPI ID is required');
      }

      const data = await PartnerPaymentService.saveUpi({
        partnerId,
        jwtMobile,
        body: { upi_id },
      });

      return successResponse(res, 200, 'UPI saved successfully', data);
    } catch (err) {
      next(err);
    }
  }

  static async getStatus(req, res, next) {
    try {
      const partnerId = req.partner?.id;
      const jwtMobile = req.partner?.mobile;

      if (!partnerId || !jwtMobile) {
        return errorResponse(res, 401, 'Not authorized, token failed');
      }

      const data = await PartnerPaymentService.getUpiStatus({
        partnerId,
        jwtMobile,
      });

      return successResponse(res, 200, 'UPI status', data);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = PartnerPaymentController;
