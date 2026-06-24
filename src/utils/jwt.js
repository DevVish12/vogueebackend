const jwt = require('jsonwebtoken');

const generateToken = (payload) => {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN,
    });
};

const verifyToken = (token, options = {}) => {
    const detailed = Boolean(options && options.detailed);
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return detailed ? { decoded, error: null } : decoded;
    } catch (error) {
        return detailed ? { decoded: null, error } : null;
    }
};

module.exports = {
    generateToken,
    verifyToken
};
