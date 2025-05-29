const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

const authMiddleware = (req, res, next) => {
  // Get token from either header
  const token =
    req.header("Authorization")?.replace("Bearer ", "") ||
    req.header("auth-token");

  if (!token) {
    return res
      .status(401)
      .json({ error: "Please authenticate using a valid token" });
  }

  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch (error) {
    console.error("JWT Error:", error.message);
    return res.status(401).json({
      error: "Invalid or expired token",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = authMiddleware;
