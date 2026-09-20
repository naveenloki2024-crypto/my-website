require('dotenv').config();

const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'rh_admin_token';
const TOKEN_TTL = '8h';

function getSecret() {
    const secret = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;

    if (!secret || secret.length < 16) {
        throw new Error('ADMIN_JWT_SECRET is missing or too short. Add a strong ADMIN_JWT_SECRET to your .env file.');
    }

    return secret;
}

function signAdminToken(admin) {
    return jwt.sign(
        { sub: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' },
        getSecret(),
        { expiresIn: TOKEN_TTL }
    );
}

function verifyAdminToken(token) {
    try {
        const payload = jwt.verify(token, getSecret());
        return (payload && payload.role === 'ADMIN') ? payload : null;
    } catch (error) {
        return null;
    }
}

function readCookieHeaderToken(req) {
    const raw = req.headers.cookie || '';

    if (!raw) return null;

    for (const pair of raw.split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (name === COOKIE_NAME && value) {
            return value;
        }
    }

    return null;
}

function readTokenFromRequest(req) {
    if (req.cookies && req.cookies[COOKIE_NAME]) {
        return req.cookies[COOKIE_NAME];
    }

    const rawCookieToken = readCookieHeaderToken(req);
    if (rawCookieToken) {
        return rawCookieToken;
    }

    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme === 'Bearer' && token) {
        return token;
    }

    return null;
}

function isAdminAuthenticated(req) {
    const token = readTokenFromRequest(req);
    return token ? verifyAdminToken(token) : null;
}

function requireAdmin(req, res, next) {
    const payload = isAdminAuthenticated(req);

    if (!payload) {
        return res.status(401).json({ error: 'Unauthorized. Please sign in as an administrator.' });
    }

    req.admin = payload;
    next();
}

const ADMIN_ASSET_EXTENSION = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)$/i;
const ADMIN_PUBLIC_PATH = '/login.html';

function requireAdminPage(req, res, next) {
    if (req.path === ADMIN_PUBLIC_PATH) {
        return next();
    }

    if (ADMIN_ASSET_EXTENSION.test(req.path)) {
        return next();
    }

    if (isAdminAuthenticated(req)) {
        return next();
    }

    return res.redirect('/admin/login.html');
}

function setAdminCookie(res, token) {
    const isSecure = process.env.NODE_ENV === 'production';

    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/'
    });
}

function clearAdminCookie(res) {
    res.clearCookie(COOKIE_NAME, { path: '/' });
}

module.exports = {
    COOKIE_NAME,
    signAdminToken,
    verifyAdminToken,
    isAdminAuthenticated,
    requireAdmin,
    requireAdminPage,
    setAdminCookie,
    clearAdminCookie
};