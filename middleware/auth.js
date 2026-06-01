const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET || "letterboxd-jwt-secret-key-2024";

/**
 * verifyToken — Required authentication middleware.
 * Reads the JWT from the httpOnly cookie "token".
 * If valid, attaches req.user = { id, name, email }.
 * If invalid or missing, redirects to /login.
 */
function verifyToken(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) {
      return res.redirect("/login");
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      name: decoded.name,
      username: decoded.name,
      email: decoded.email,
    };
    next();
  } catch (err) {
    console.error("JWT verification failed:", err.message);
    res.clearCookie("token");
    return res.redirect("/login");
  }
}

/**
 * optionalAuth — Optional authentication middleware.
 * Same as verifyToken but doesn't block unauthenticated users.
 * Sets req.user = null if no valid token is found.
 */
function optionalAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies.token;
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.id,
      name: decoded.name,
      username: decoded.name,
      email: decoded.email,
    };
    next();
  } catch (err) {
    req.user = null;
    next();
  }
}

module.exports = { verifyToken, optionalAuth };
