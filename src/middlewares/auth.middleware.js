const { verifyToken } = require('../utils/jwt');
const { errorResponse } = require('../utils/response');

const extractBearerToken = (authHeader) => {
    const raw = String(authHeader || '').trim();
    if (!raw) return null;

    // Accept:
    // - "Bearer <token>" (any casing, extra spaces)
    // - "<token>" (fallback)
    const m = raw.match(/^Bearer\s+(.+)$/i);
    const token = m && m[1] ? String(m[1]).trim() : raw;
    if (!token) return null;
    if (/^(null|undefined)$/i.test(token)) return null;
    return token;
};

const adminProtect = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = extractBearerToken(authHeader);

        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('[auth] authorization header:', authHeader);
            // eslint-disable-next-line no-console
            console.log('[auth] extracted token:', token);
        }

        if (!token) {
            return errorResponse(res, 401, 'Not authorized, no token provided');
        }

        const { decoded, error } = verifyToken(token, { detailed: true });
        if (process.env.NODE_ENV !== 'production' && error) {
            // eslint-disable-next-line no-console
            console.log('[auth] JWT ERROR:', error.message);
        }

        if (!decoded || !decoded.id) {
            return errorResponse(res, 401, 'Not authorized, token failed');
        }

        req.admin = decoded; // add decoded payload to request
        next();
    } catch (error) {
        return errorResponse(res, 401, 'Not authorized, token failed');
    }
};

const userProtect = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = extractBearerToken(authHeader);

        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('[auth] authorization header:', authHeader);
            // eslint-disable-next-line no-console
            console.log('[auth] extracted token:', token);
        }

        if (!token) {
            return errorResponse(res, 401, 'Not authorized, no token provided');
        }

        const { decoded, error } = verifyToken(token, { detailed: true });
        if (process.env.NODE_ENV !== 'production' && error) {
            // eslint-disable-next-line no-console
            console.log('[auth] JWT ERROR:', error.message);
        }

        if (!decoded || !decoded.id) {
            return errorResponse(res, 401, 'Not authorized, token failed');
        }

        req.user = decoded;
        next();
    } catch (error) {
        return errorResponse(res, 401, 'Not authorized, token failed');
    }
};

const partnerProtect = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = extractBearerToken(authHeader);

        if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.log('[auth] authorization header:', authHeader);
            // eslint-disable-next-line no-console
            console.log('[auth] extracted token:', token);
        }

        if (!token) {
            return errorResponse(res, 401, 'Not authorized, no token provided');
        }

        const { decoded, error } = verifyToken(token, { detailed: true });
        if (process.env.NODE_ENV !== 'production' && error) {
            // eslint-disable-next-line no-console
            console.log('[auth] JWT ERROR:', error.message);
        }

        if (!decoded || !decoded.id) {
            return errorResponse(res, 401, 'Not authorized, token failed');
        }

        if (decoded.role && decoded.role !== 'partner') {
            return errorResponse(res, 403, 'Forbidden');
        }

        req.partner = decoded;
        next();
    } catch (error) {
        return errorResponse(res, 401, 'Not authorized, token failed');
    }
};

module.exports = { adminProtect, userProtect, partnerProtect };
