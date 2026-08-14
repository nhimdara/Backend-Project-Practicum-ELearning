const {
  db,
  bcrypt,
  fs,
  path,
  UPLOAD_ROOT,
  AVATAR_UPLOAD_DIR,
  MAX_AVATAR_SIZE_BYTES,
  IMAGE_EXTENSIONS,
  corsOptions,
  ALLOWED_MAJORS,
  EMAIL_DOMAIN,
  EXAM_PASS_SCORE,
  EXAM_BANK,
  clampAcademicYear,
  getCurrentAcademicYear,
  getStudentEmailNameParts,
  buildStudentEmail,
  buildStaffEmail,
  dedupeVideos,
  removeDuplicateVideoSlots,
  ensureStudentYearColumns,
  ensureTeacherRoleValue,
  ensureUserProfileColumns,
  parseListField,
  stringifyListField,
  ensureAvatarUploadDir,
  requestOrigin,
  assetUrl,
  fallbackAvatar,
  hasImageSignature,
  decodeAvatarImage,
  publicUserProfile,
  getUserLearningStats,
  ensureCertificatesTable,
  ensureExamTables,
  parseJsonField,
  getActorRole,
  requireExamQuestionManager,
  normalizeExamQuestionPayload,
  ensureExamForMajor,
  getCompletedCertificateRows,
  syncCompletedCertificates,
  mapCertificateRow,
  normalizeExamMajor,
  getExamDefinition,
  publicExam,
  awardExamCertificate,
  awardManualCertificate,
  normalizeProjectTags,
  toTinyInt,
  mapProjectRow,
  getProjectColumns,
  ensureProjectColumns,
  getProjectPayload,
  anthropicApiKey,
  groqApiKey,
  aiProvider,
  anthropic,
} = require("../appContext");

module.exports = function registerCatalogRoutes(app) {
app.get("/api/years", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name
       FROM years
       WHERE display_order BETWEEN 1 AND 4
       ORDER BY display_order, id`,
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/years error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET semesters by year
app.get("/api/years/:yearId/semesters", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, semester_number FROM semesters WHERE year_id = ? ORDER BY semester_number, id",
      [req.params.yearId],
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/years/:yearId/semesters error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET all semesters
app.get("/api/semesters", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT s.id, s.name, s.semester_number, y.name as year_name, y.id as year_id
      FROM semesters s
      LEFT JOIN years y ON y.id = s.year_id
      ORDER BY y.display_order, y.id, s.semester_number, s.id
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/semesters error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET all categories
app.get("/api/categories", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, slug, icon FROM categories WHERE is_active = 1 ORDER BY name",
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/categories error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// STATISTICS & DASHBOARD ENDPOINTS
// ===================================================================

// Get dashboard statistics
app.get("/api/stats", async (req, res) => {
  try {
    const [totalUsers] = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'student'",
    );
    const [totalLessons] = await db.query(
      "SELECT COUNT(*) as count FROM lessons WHERE is_published = 1",
    );
    const [totalVideos] = await db.query(
      "SELECT COUNT(*) as count FROM videos",
    );
    const [totalEnrollments] = await db.query(
      "SELECT COUNT(*) as count FROM enrollments",
    );
    const [avgRating] = await db.query(
      "SELECT AVG(rating) as avg FROM lessons WHERE rating > 0",
    );

    res.json({
      totalStudents: totalUsers[0].count,
      totalLessons: totalLessons[0].count,
      totalVideos: totalVideos[0].count,
      totalEnrollments: totalEnrollments[0].count,
      averageRating: parseFloat(avgRating[0].avg || 0).toFixed(1),
    });
  } catch (err) {
    console.error("❌ /api/stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get top rated lessons
app.get("/api/top-rated", async (req, res) => {
  const { limit = 6 } = req.query;
  try {
    const [rows] = await db.query(
      `SELECT id, title, major, rating, students, color 
       FROM lessons 
       WHERE is_published = 1 AND rating > 0 
       ORDER BY rating DESC, students DESC 
       LIMIT ?`,
      [parseInt(limit)],
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/top-rated error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
};
