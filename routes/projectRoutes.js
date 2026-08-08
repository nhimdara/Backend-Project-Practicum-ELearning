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

module.exports = function registerProjectRoutes(app) {
app.get("/api/projects", async (req, res) => {
  try {
    const columns = await getProjectColumns();
    const includeInactive = req.query.include_inactive === "1";
    const where =
      columns.has("is_active") && !includeInactive ? " WHERE is_active = 1" : "";
    const order = `${columns.has("featured") ? "featured DESC, " : ""}id DESC`;
    const [rows] = await db.query(
      `SELECT * FROM projects${where} ORDER BY ${order}`,
    );

    res.json(rows.map(mapProjectRow));
  } catch (err) {
    console.error("❌ /api/projects error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// CREATE a project
app.post("/api/projects", async (req, res) => {
  const title = String(req.body.title || "").trim();
  if (title.length < 3) {
    return res
      .status(400)
      .json({ error: "Project title must be at least 3 characters." });
  }

  try {
    const columns = await getProjectColumns();
    const payload = getProjectPayload(req.body, columns);
    if (!columns.has("title")) {
      return res.status(500).json({ error: "Projects table is missing title." });
    }

    const keys = Object.keys(payload);
    const placeholders = keys.map(() => "?").join(", ");
    const columnSql = keys.map((key) => `\`${key}\``).join(", ");
    const values = keys.map((key) => payload[key]);
    const [result] = await db.query(
      `INSERT INTO projects (${columnSql}) VALUES (${placeholders})`,
      values,
    );
    const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [
      result.insertId,
    ]);

    res.status(201).json({
      success: true,
      project: rows[0] ? mapProjectRow(rows[0]) : null,
    });
  } catch (err) {
    console.error("âŒ POST /api/projects error:", err.message);
    res.status(500).json({ error: "Failed to create project." });
  }
});

// GET single project
app.get("/api/projects/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    const columns = await getProjectColumns();
    if (columns.has("view_count")) {
      await db.query(
        "UPDATE projects SET view_count = view_count + 1 WHERE id = ?",
        [req.params.id],
      );
      rows[0].view_count = Number(rows[0].view_count || 0) + 1;
    }
    res.json(mapProjectRow(rows[0]));
  } catch (err) {
    console.error("❌ GET /api/projects/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE a project
app.put("/api/projects/:id", async (req, res) => {
  const title = String(req.body.title || "").trim();
  if (title.length < 3) {
    return res
      .status(400)
      .json({ error: "Project title must be at least 3 characters." });
  }

  try {
    const columns = await getProjectColumns();
    const payload = getProjectPayload(req.body, columns);
    const keys = Object.keys(payload);
    if (keys.length === 0) {
      return res.status(400).json({ error: "No project fields to update." });
    }

    const assignments = keys.map((key) => `\`${key}\` = ?`).join(", ");
    const values = keys.map((key) => payload[key]);
    const [result] = await db.query(
      `UPDATE projects SET ${assignments} WHERE id = ?`,
      [...values, req.params.id],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found." });
    }

    const [rows] = await db.query("SELECT * FROM projects WHERE id = ?", [
      req.params.id,
    ]);
    res.json({
      success: true,
      project: rows[0] ? mapProjectRow(rows[0]) : null,
    });
  } catch (err) {
    console.error("âŒ PUT /api/projects error:", err.message);
    res.status(500).json({ error: "Failed to update project." });
  }
});

// DELETE a project
app.delete("/api/projects/:id", async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM projects WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Project not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("âŒ DELETE /api/projects error:", err.message);
    res.status(500).json({ error: "Failed to delete project." });
  }
});

// ===================================================================
// REFERENCE DATA ENDPOINTS
// ===================================================================

// GET all years
};
