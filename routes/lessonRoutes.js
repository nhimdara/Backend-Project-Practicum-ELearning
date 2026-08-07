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

module.exports = function registerLessonRoutes(app) {
app.get("/api/lessons", async (req, res) => {
  try {
    const sql = `
      SELECT l.id, l.title, l.description, 
             c.name AS category, c.id AS category_id,
             s.name AS semester, s.id AS semester_id,
             y.name AS year, y.id AS year_id,
             l.level, l.hours, l.credit, l.rating, l.students, l.color, 
             l.\`option\`, l.major, l.is_published
      FROM lessons l 
      LEFT JOIN categories c ON c.id = l.category_id 
      LEFT JOIN semesters s ON s.id = l.semester_id 
      LEFT JOIN years y ON y.id = s.year_id 
      ORDER BY y.id, s.id, l.id
    `;
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/lessons error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET lessons filtered by year/semester
// Keep this before /api/lessons/:id so "filter" is not treated as an id.
app.get("/api/lessons/filter", async (req, res) => {
  const { year_id, semester_id, major, include_unpublished } = req.query;

  let sql = `
    SELECT l.id, l.title, l.description, 
           c.name AS category, c.id AS category_id,
           s.name AS semester, s.id AS semester_id,
           y.name AS year, y.id AS year_id,
           l.level, l.hours, l.credit, l.rating, l.students,
           l.color, l.\`option\`, l.major, l.is_published
    FROM lessons l
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN semesters s ON s.id = l.semester_id
    LEFT JOIN years y ON y.id = s.year_id
    WHERE 1=1
  `;
  const params = [];

  if (include_unpublished !== "1") {
    sql += " AND l.is_published = 1";
  }

  if (semester_id) {
    sql += " AND l.semester_id = ?";
    params.push(semester_id);
  } else if (year_id) {
    sql += " AND s.year_id = ?";
    params.push(year_id);
  }

  if (major && major !== "all") {
    sql += " AND l.major = ?";
    params.push(major);
  }

  sql += " ORDER BY y.id, s.id, l.id";

  try {
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/lessons/filter error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET single lesson with its videos
app.get("/api/lessons/:id", async (req, res) => {
  try {
    const [lessons] = await db.query(
      `SELECT l.id, l.title, l.description, 
              c.name AS category, c.id as category_id,
              s.name AS semester, s.id as semester_id,
              y.id as year_id, y.name as year_name,
              l.level, l.hours, l.credit, l.rating, l.students, l.color, l.\`option\`, l.major
       FROM lessons l
       LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN semesters s ON s.id = l.semester_id
       LEFT JOIN years y ON y.id = s.year_id
       WHERE l.id = ?`,
      [req.params.id],
    );

    if (lessons.length === 0) {
      return res.status(404).json({ error: "Lesson not found." });
    }

    const [videos] = await db.query(
      "SELECT * FROM videos WHERE lesson_id = ? ORDER BY order_index, id",
      [req.params.id],
    );

    res.json({
      ...lessons[0],
      videos: dedupeVideos(videos),
    });
  } catch (err) {
    console.error("❌ GET /api/lessons/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET lessons filtered by major
app.get("/api/lessons/by-major/:major", async (req, res) => {
  const { major } = req.params;
  const { year_id } = req.query;
  try {
    let sql = `
      SELECT l.id, l.title, l.description,
             c.name AS category, 
             s.name AS semester, s.id AS semester_id,
             y.name AS year, y.id AS year_id,
             l.level, l.hours, l.credit, l.rating, l.students,
             l.color, l.\`option\`, l.major, l.is_published
      FROM lessons l
      LEFT JOIN categories c ON c.id = l.category_id
      LEFT JOIN semesters s ON s.id = l.semester_id
      LEFT JOIN years y ON y.id = s.year_id
      WHERE l.major = ? AND l.is_published = 1
    `;
    const params = [major];
    if (year_id) {
      sql += " AND y.id = ?";
      params.push(year_id);
    }
    sql += " ORDER BY y.id, s.id, l.id";
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/lessons/by-major error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET lessons filtered by year/semester
app.get("/api/lessons/filter", async (req, res) => {
  const { year_id, semester_id, major, include_unpublished } = req.query;

  let sql = `
    SELECT l.id, l.title, l.description, 
           c.name AS category, c.id AS category_id,
           s.name AS semester, s.id AS semester_id,
           y.name AS year, y.id AS year_id,
           l.level, l.hours, l.credit, l.rating, l.students,
           l.color, l.\`option\`, l.major, l.is_published
    FROM lessons l
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN semesters s ON s.id = l.semester_id
    LEFT JOIN years y ON y.id = s.year_id
    WHERE 1=1
  `;
  const params = [];

  if (include_unpublished !== "1") {
    sql += " AND l.is_published = 1";
  }

  if (semester_id) {
    sql += " AND l.semester_id = ?";
    params.push(semester_id);
  } else if (year_id) {
    sql += " AND s.year_id = ?";
    params.push(year_id);
  }

  if (major && major !== "all") {
    sql += " AND l.major = ?";
    params.push(major);
  }

  sql += " ORDER BY y.id, s.id, l.id";

  try {
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/lessons/filter error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// CREATE a new lesson
app.post("/api/lessons", async (req, res) => {
  const {
    title,
    description,
    category_id,
    semester_id,
    level,
    hours,
    credit,
    color,
    option,
    major,
    is_published,
  } = req.body;

  if (!title || title.trim().length < 3) {
    return res
      .status(400)
      .json({ error: "Title must be at least 3 characters." });
  }
  if (!semester_id) {
    return res.status(400).json({ error: "Semester is required." });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO lessons 
       (title, description, category_id, semester_id, level, hours, credit, color, \`option\`, major, is_published) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title.trim(),
        description || null,
        category_id || null,
        semester_id,
        level || null,
        hours || null,
        credit || 0,
        color || "#6366f1",
        option || null,
        major || "ITE",
        is_published === false || is_published === 0 ? 0 : 1,
      ],
    );

    const [newLesson] = await db.query(
      `SELECT l.id, l.title, l.description, 
              c.name AS category, 
              s.name AS semester,
              y.name AS year, y.id AS year_id,
              l.level, l.hours, l.credit, l.color, l.\`option\`, l.major, l.is_published
       FROM lessons l
       LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN semesters s ON s.id = l.semester_id
       LEFT JOIN years y ON y.id = s.year_id
       WHERE l.id = ?`,
      [result.insertId],
    );

    res.status(201).json({
      success: true,
      lesson: newLesson[0],
    });
  } catch (err) {
    console.error("❌ POST /api/lessons error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to create lesson. Please try again." });
  }
});

// UPDATE a lesson
app.put("/api/lessons/:id", async (req, res) => {
  const {
    title,
    description,
    category_id,
    semester_id,
    level,
    hours,
    credit,
    color,
    option,
    major,
    is_published,
  } = req.body;

  try {
    const [result] = await db.query(
      `UPDATE lessons SET 
        title = ?, description = ?, category_id = ?, semester_id = ?,
        level = ?, hours = ?, credit = ?, color = ?, \`option\` = ?, major = ?,
        is_published = ?
       WHERE id = ?`,
      [
        title.trim(),
        description || null,
        category_id || null,
        semester_id,
        level || null,
        hours || null,
        credit || 0,
        color || null,
        option || null,
        major || null,
        is_published === false || is_published === 0 ? 0 : 1,
        req.params.id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Lesson not found." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PUT /api/lessons error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a lesson
app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const [videos] = await db.query(
      "SELECT COUNT(*) as count FROM videos WHERE lesson_id = ?",
      [req.params.id],
    );
    if (videos[0].count > 0) {
      return res.status(400).json({
        error:
          "Cannot delete lesson with existing videos. Delete videos first.",
      });
    }

    const [result] = await db.query("DELETE FROM lessons WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Lesson not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/lessons error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// VIDEOS ENDPOINTS
// ===================================================================

// GET all videos
};
