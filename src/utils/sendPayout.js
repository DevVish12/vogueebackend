const axios = require('axios');

const toPaise = (amountRupees) => {
  const n = Number(amountRupees);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
};

const createClient = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    const err = new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
    err.statusCode = 500;
    throw err;
  }

  return axios.create({
    baseURL: 'https://api.razorpay.com/v1',
    auth: {
      username: keyId,
      password: keySecret,
    },
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
};

const logError = (error) => {
  console.log('STATUS:', error?.response?.status);
  console.log('DATA:', error?.response?.data);
};

async function createContact(client, { name, mobile, referenceId }) {
  const payload = {
    name: name || 'Partner',
    type: 'vendor',
    reference_id: referenceId,
  };

  const contact = String(mobile || '').trim();
  if (contact) {
    payload.contact = contact;
  }

  const response = await client.post('/contacts', payload);
  console.log('CONTACT CREATED');
  return response.data;
}

async function createFundAccount(client, { contactId, upi, referenceId }) {
  const response = await client.post('/fund_accounts', {
    contact_id: contactId,
    account_type: 'vpa',
    vpa: {
      address: upi,
    },
  });

  console.log('FUND ACCOUNT CREATED');
  return response.data;
}

async function createPayout(client, { accountNumber, fundAccountId, amount, partnerId }) {
  const payoutAmount = amount;
  const payoutAmountInPaise = Math.round(Number(payoutAmount || 0) * 100);

  console.log('[PAYOUT AMOUNT DEBUG]', {
    originalAmount: payoutAmount,
    payoutAmountInPaise,
  });

  if (!Number.isInteger(payoutAmountInPaise)) {
    throw new Error('Invalid payout amount generated');
  }

  const payoutResponse = await client.post('/payouts', {
    account_number: accountNumber,
    fund_account_id: fundAccountId,
    amount: payoutAmountInPaise,
    currency: 'INR',
    mode: 'UPI',
    purpose: 'payout',
    queue_if_low_balance: true,
    reference_id: `partner_${partnerId}_${Date.now()}`,
    narration: 'UrbanApp Partner Payout',
  });

  console.log('PAYOUT RESPONSE:', payoutResponse.data);
  return payoutResponse.data;
}

async function sendPayout({ amount, upi, name, partnerId, mobile, referenceId }) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  }

  const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER;
  if (!accountNumber) {
    throw new Error('Razorpay payouts are not configured. Set RAZORPAY_ACCOUNT_NUMBER');
  }

  const upiAddress = String(upi || '').trim();
  if (!upiAddress) {
    throw new Error('UPI address is required');
  }

  const amountPaise = toPaise(amount);
  if (!amountPaise) {
    throw new Error('Valid payout amount is required');
  }

  try {
    const client = createClient();
    const payoutReferenceId = String(referenceId || `partner_${partnerId || 'unknown'}_${Date.now()}`);
    const contact = await createContact(client, {
      name: name || 'Partner',
      mobile,
      referenceId: payoutReferenceId,
    });

    const contactId = contact?.id;
    if (!contactId) {
      throw new Error('Razorpay contact creation failed');
    }

    const fundAccount = await createFundAccount(client, {
      contactId,
      upi: upiAddress,
      referenceId: payoutReferenceId,
    });

    const fundAccountId = fundAccount?.id;
    if (!fundAccountId) {
      throw new Error('Razorpay fund account creation failed');
    }

    return await createPayout(client, {
      accountNumber,
      fundAccountId,
      amount,
      partnerId,
    });
  } catch (error) {
    logError(error);

    const message =
      error?.response?.data?.error?.description ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.error ||
      error?.message ||
      'Failed to create payout';
    const err = new Error(message);
    err.statusCode = error?.response?.status || error?.statusCode || 500;
    throw err;
  }
}

module.exports = sendPayout;
