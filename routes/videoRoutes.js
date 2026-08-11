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

module.exports = function registerVideoRoutes(app) {
let videoTeacherColumnReady;
const ensureVideoTeacherColumn = () => {
  if (!videoTeacherColumnReady) {
    videoTeacherColumnReady = db.query("ALTER TABLE videos ADD COLUMN IF NOT EXISTS teacher_id BIGINT NULL");
  }
  return videoTeacherColumnReady;
};

const requireTeacherId = async (req, res) => {
  const teacherId = Number(req.get("x-user-id") || req.body?.teacher_id);
  if (!Number.isInteger(teacherId) || teacherId < 1) {
    res.status(401).json({ error: "A signed-in teacher is required." });
    return null;
  }
  const [teachers] = await db.query("SELECT id FROM users WHERE id = ? AND role = 'teacher' LIMIT 1", [teacherId]);
  if (!teachers.length) {
    res.status(403).json({ error: "Teacher account not found." });
    return null;
  }
  return teacherId;
};

app.get("/api/videos", async (req, res) => {
  try {
    await ensureVideoTeacherColumn();
    const [rows] = await db.query(
      "SELECT id, lesson_id, teacher_id, title, link, thumbnail, duration_minutes, view_count, description, is_free, order_index FROM videos ORDER BY lesson_id, order_index, id",
    );
    res.json(dedupeVideos(rows));
  } catch (err) {
    console.error("❌ /api/videos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET videos for a specific lesson
app.get("/api/lessons/:id/videos", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM videos WHERE lesson_id = ? ORDER BY order_index, id",
      [req.params.id],
    );
    res.json(dedupeVideos(rows));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE a new video
app.post("/api/videos", async (req, res) => {
  const {
    lesson_id,
    title,
    link,
    duration_minutes,
    description,
    is_free,
    order_index,
  } = req.body;

  if (!lesson_id) {
    return res.status(400).json({ error: "Lesson ID is required." });
  }
  if (!title || title.trim().length < 3) {
    return res
      .status(400)
      .json({ error: "Title must be at least 3 characters." });
  }
  if (!link || !link.trim()) {
    return res.status(400).json({ error: "Video URL is required." });
  }

  try {
    await ensureVideoTeacherColumn();
    const teacherId = await requireTeacherId(req, res);
    if (!teacherId) return;
    const [result] = await db.query(
      `INSERT INTO videos 
       (lesson_id, teacher_id, title, link, duration_minutes, description, is_free, order_index) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lesson_id,
        teacherId,
        title.trim(),
        link.trim(),
        duration_minutes || null,
        description || null,
        is_free ? 1 : 0,
        order_index || 1,
      ],
    );

    const [newVideo] = await db.query("SELECT * FROM videos WHERE id = ?", [
      result.insertId,
    ]);
    await removeDuplicateVideoSlots(
      lesson_id,
      order_index || 1,
      result.insertId,
    );
    res.status(201).json({
      success: true,
      video: newVideo[0],
    });
  } catch (err) {
    console.error("❌ POST /api/videos error:", err.message);
    res
      .status(500)
      .json({ error: "Failed to create video. Please try again." });
  }
});

// UPDATE a video
app.put("/api/videos/:id", async (req, res) => {
  const {
    lesson_id,
    title,
    link,
    duration_minutes,
    description,
    is_free,
    order_index,
  } = req.body;

  if (!lesson_id) {
    return res.status(400).json({ error: "Lesson ID is required." });
  }
  if (!title || title.trim().length < 3) {
    return res
      .status(400)
      .json({ error: "Title must be at least 3 characters." });
  }
  if (!link || !link.trim()) {
    return res.status(400).json({ error: "Video URL is required." });
  }

  try {
    await ensureVideoTeacherColumn();
    const teacherId = await requireTeacherId(req, res);
    if (!teacherId) return;
    const [result] = await db.query(
      `UPDATE videos SET 
        lesson_id = ?, teacher_id = ?, title = ?, link = ?, duration_minutes = ?,
        description = ?, is_free = ?, order_index = ?
       WHERE id = ? AND (teacher_id IS NULL OR teacher_id = ?)`,
      [
        lesson_id,
        teacherId,
        title.trim(),
        link.trim(),
        duration_minutes || null,
        description || null,
        is_free ? 1 : 0,
        order_index || 1,
        req.params.id,
        teacherId,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Video not found." });
    }

    await removeDuplicateVideoSlots(lesson_id, order_index || 1, req.params.id);
    const [updatedVideo] = await db.query("SELECT * FROM videos WHERE id = ?", [
      req.params.id,
    ]);
    res.json({ success: true, video: updatedVideo[0] });
  } catch (err) {
    console.error("❌ PUT /api/videos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a video
app.delete("/api/videos/:id", async (req, res) => {
  try {
    await ensureVideoTeacherColumn();
    const teacherId = await requireTeacherId(req, res);
    if (!teacherId) return;

    const [ownedVideos] = await db.query(
      "SELECT id FROM videos WHERE id = ? AND (teacher_id IS NULL OR teacher_id = ?) LIMIT 1",
      [req.params.id, teacherId],
    );
    if (!ownedVideos.length) {
      return res.status(404).json({ error: "Video not found." });
    }

    // Delete related video progress first
    await db.query("DELETE FROM video_progress WHERE video_id = ?", [
      req.params.id,
    ]);

    const [result] = await db.query(
      "DELETE FROM videos WHERE id = ? AND (teacher_id IS NULL OR teacher_id = ?)",
      [req.params.id, teacherId],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Video not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/videos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// ENROLLMENTS & PROGRESS ENDPOINTS
// ===================================================================

// Enroll user in a lesson
app.post("/api/enroll", async (req, res) => {
  const { user_id, lesson_id } = req.body;

  if (!user_id || !lesson_id) {
    return res
      .status(400)
      .json({ error: "User ID and Lesson ID are required." });
  }

  try {
    // Check if already enrolled
    const [existing] = await db.query(
      "SELECT id FROM enrollments WHERE user_id = ? AND lesson_id = ?",
      [user_id, lesson_id],
    );

    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: "Already enrolled in this lesson." });
    }

    const [result] = await db.query(
      "INSERT INTO enrollments (user_id, lesson_id, enrolled_at, last_accessed) VALUES (?, ?, NOW(), NOW())",
      [user_id, lesson_id],
    );

    // Update lesson student count
    await db.query("UPDATE lessons SET students = students + 1 WHERE id = ?", [
      lesson_id,
    ]);

    res.status(201).json({
      success: true,
      enrollment_id: result.insertId,
    });
  } catch (err) {
    console.error("❌ POST /api/enroll error:", err.message);
    res.status(500).json({ error: "Failed to enroll." });
  }
});

// Get user's enrolled lessons
app.get("/api/users/:id/enrollments", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*, l.title, l.major, l.color, l.credit
       FROM enrollments e
       JOIN lessons l ON l.id = e.lesson_id
       WHERE e.user_id = ?
       ORDER BY e.enrolled_at DESC`,
      [req.params.id],
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ GET /api/users/:id/enrollments error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update video progress
app.post("/api/video-progress", async (req, res) => {
  const { user_id, video_id, watched_seconds, completed } = req.body;

  if (!user_id || !video_id) {
    return res
      .status(400)
      .json({ error: "User ID and Video ID are required." });
  }

  try {
    const [result] = await db.query(
      `INSERT INTO video_progress (user_id, video_id, watched_seconds, completed, last_watched)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         watched_seconds = GREATEST(watched_seconds, VALUES(watched_seconds)),
         completed = IF(watched_seconds >= (SELECT duration_minutes * 60 FROM videos WHERE id = VALUES(video_id)), 1, completed),
         last_watched = NOW()`,
      [user_id, video_id, watched_seconds || 0, completed ? 1 : 0],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ POST /api/video-progress error:", err.message);
    res.status(500).json({ error: "Failed to update progress." });
  }
});

// Get user's video progress for a lesson
app.get("/api/users/:user_id/lessons/:lesson_id/progress", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT v.id, v.title, v.duration_minutes, vp.watched_seconds, vp.completed
       FROM videos v
       LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.user_id = ?
       WHERE v.lesson_id = ?
       ORDER BY v.order_index`,
      [req.params.user_id, req.params.lesson_id],
    );
    res.json(rows);
  } catch (err) {
    console.error(
      "❌ GET /api/users/:user_id/lessons/:lesson_id/progress error:",
      err.message,
    );
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// PROJECTS ENDPOINTS
// ===================================================================

// GET all projects
};
