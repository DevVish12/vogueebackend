


// const crypto = require('crypto');
// const jwt = require('jsonwebtoken');

// const generateToken = (payload) => {
//     return jwt.sign(payload, process.env.JWT_SECRET, {
//         expiresIn: process.env.JWT_EXPIRES_IN || '15m',
//     });
// };

// const generateRefreshToken = () => crypto.randomBytes(32).toString('hex');

// const verifyToken = (token, options = {}) => {
//     const detailed = Boolean(options && options.detailed);
//     try {
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);
//         return detailed ? { decoded, error: null } : decoded;
//     } catch (error) {
//         return detailed ? { decoded: null, error } : null;
//     }
// };

// module.exports = {
//     generateToken,
//     generateRefreshToken,
//     verifyToken
// };


const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const generateToken = (payload) => {
    if (process.env.NODE_ENV !== 'production' && payload?.role === 'partner') {
        console.log('[JWT IDENTITY DEBUG]', {
            jwtId: payload?.id ?? null,
            jwtIdType: typeof payload?.id,
            jwtRole: payload?.role,
        });
    }
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    });
};

const generateRefreshToken = () => crypto.randomBytes(32).toString('hex');

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
    generateRefreshToken,
    verifyToken
};
