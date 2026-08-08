require("dotenv").config();
const { rateLimit } = require("express-rate-limit");

const {
  app,
  aiProvider,
  ensureTeacherRoleValue,
  ensureStudentYearColumns,
  ensureUserProfileColumns,
  ensureAvatarUploadDir,
  ensureCertificatesTable,
  ensureExamTables,
  ensureProjectColumns,
} = require("./appContext");
const registerChatRoutes = require("./routes/chatRoutes");
const registerSystemRoutes = require("./routes/systemRoutes");
const registerUserRoutes = require("./routes/userRoutes");
const registerExamRoutes = require("./routes/examRoutes");
const registerLessonRoutes = require("./routes/lessonRoutes");
const registerVideoRoutes = require("./routes/videoRoutes");
const registerProjectRoutes = require("./routes/projectRoutes");
const registerCatalogRoutes = require("./routes/catalogRoutes");
const registerNotificationRoutes = require("./routes/notificationRoutes");
const { ensureNotificationsTable } = require("./services/notificationService");
const { ensureBootstrapAdmin } = require("./services/bootstrapService");
const { authorizeApiRequest } = require("./middleware/auth");

const authenticationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Please try again later." },
});
app.use(["/api/login", "/api/auth/forgot-password", "/api/auth/verify-reset-otp", "/api/auth/reset-password"], authenticationLimiter);
app.use("/api", authorizeApiRequest);

registerChatRoutes(app);
registerSystemRoutes(app);
registerUserRoutes(app);
registerExamRoutes(app);
registerLessonRoutes(app);
registerVideoRoutes(app);
registerProjectRoutes(app);
registerCatalogRoutes(app);
registerNotificationRoutes(app);

// ===================================================================
// ERROR HANDLING MIDDLEWARE
// ===================================================================
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Uploaded image is too large. Please choose a file under 2MB." });
  }
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ===================================================================
// START SERVER
// ===================================================================
const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 API URL: http://localhost:${PORT}/api`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api/health`);
  const startupTasks = [
    ["teacher roles", ensureTeacherRoleValue],
    ["student year columns", ensureStudentYearColumns],
    ["user profile columns", ensureUserProfileColumns],
    ["avatar directory", ensureAvatarUploadDir],
    ["certificates table", ensureCertificatesTable],
    ["exam tables", ensureExamTables],
    ["project columns", ensureProjectColumns],
    ["notifications table", ensureNotificationsTable],
    ["administrator bootstrap", ensureBootstrapAdmin],
  ];
  const startupResults = await Promise.allSettled(
    startupTasks.map(([, task]) => Promise.resolve().then(task)),
  );
  startupResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Startup check failed (${startupTasks[index][0]}):`, result.reason?.message || result.reason);
    }
  });

  if (!aiProvider) {
    console.error("WARNING: AI chat is not configured. Add GROQ_API_KEY or ANTHROPIC_API_KEY.");
  } else {
    console.log(`AI chat provider configured: ${aiProvider}`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `❌ Port ${PORT} is already in use. Stop the running backend first, or set a different PORT in Backend/.env.`,
    );
    console.error(
      `   PowerShell: Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess`,
    );
    process.exit(1);
  }

  console.error("❌ Server failed to start:", err.message);
  process.exit(1);
});



