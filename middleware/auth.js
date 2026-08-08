const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "development-only-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

function createAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), role: String(user.role), email: user.email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: "elearning-api", audience: "elearning-web" },
  );
}

function authenticate(req, res, next) {
  const authorization = String(req.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Authentication required." });
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: "elearning-api",
      audience: "elearning-web",
    });
    req.user = { id: Number(payload.sub) || payload.sub, role: payload.role, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ error: "Your session is invalid or has expired." });
  }
}

const hasRole = (req, roles) => roles.includes(String(req.user?.role || "").toLowerCase());
const isSelf = (req) => String(req.user?.id) === String(req.params?.id || req.params?.user_id || "");

function authorizeApiRequest(req, res, next) {
  const path = String(req.originalUrl || req.url).split("?")[0];
  const method = req.method;
  const publicRequest =
    (method === "POST" && ["/api/login", "/api/auth/forgot-password", "/api/auth/verify-reset-otp", "/api/auth/reset-password"].includes(path)) ||
    (method === "GET" && (/^\/api\/(health|stats|top-rated|years|semesters|categories)$/.test(path) || /^\/api\/(lessons|videos|projects)(\/|$)/.test(path)));
  if (publicRequest) return next();

  authenticate(req, res, () => {
    const role = String(req.user.role || "").toLowerCase();
    const staff = ["admin", "teacher"].includes(role);

    if (/^\/api\/users\/?$/.test(path) && method === "GET" && role !== "admin") {
      return res.status(403).json({ error: "Administrator access required." });
    }
    if (/^\/api\/users\/(students|teachers)$/.test(path) && role !== "admin") {
      return res.status(403).json({ error: "Administrator access required." });
    }
    if (/^\/api\/users\/[^/]+$/.test(path) && method === "DELETE" && role !== "admin") {
      return res.status(403).json({ error: "Administrator access required." });
    }
    if (/^\/api\/users\/[^/]+$/.test(path) && method === "GET") {
      req.params.id = path.split("/")[3];
      if (!isSelf(req) && role !== "admin") return res.status(403).json({ error: "You cannot access another user's data." });
    }
    if (/^\/api\/(lessons|videos)(\/|$)/.test(path) && method !== "GET" && !staff) {
      return res.status(403).json({ error: "Staff access required." });
    }
    if (/^\/api\/certificates(\/|$)/.test(path) && role !== "admin") {
      return res.status(403).json({ error: "Administrator access required." });
    }
    if (/\/questions(\/|$)/.test(path) && !staff) {
      return res.status(403).json({ error: "Staff access required." });
    }
    if (["/api/enroll", "/api/video-progress"].includes(path) && role === "student") {
      req.body.user_id = req.user.id;
    }
    if (/^\/api\/users\/[^/]+\/(major|profile|avatar|certificates|exam-attempts|enrollments|notifications|needs-major-select|lessons)/.test(path)) {
      req.params.id = path.split("/")[3];
      if (!isSelf(req) && role !== "admin") return res.status(403).json({ error: "You cannot access another user's data." });
    }
    // Ignore client-provided role headers. Downstream legacy checks receive verified identity.
    req.headers["x-user-id"] = String(req.user.id);
    req.headers["x-user-role"] = req.user.role;
    if (req.body && typeof req.body === "object") {
      req.body.actorUserId = req.user.id;
      req.body.actorRole = req.user.role;
    }
    next();
  });
}

module.exports = { createAccessToken, authenticate, authorizeApiRequest, hasRole, isSelf };
