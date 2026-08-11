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

module.exports = function registerExamRoutes(app) {
app.get("/api/exams/by-major/:major", async (req, res) => {
  const major = normalizeExamMajor(req.params.major);
  const actor = await getActorRole(req);
  const includeAnswers = actor && ["teacher", "admin"].includes(actor.role);
  const exam = await publicExam(major, { includeAnswers });

  if (!exam) {
    return res.status(404).json({ error: "Exam is not available for this major." });
  }

  res.json(exam);
});

// ADD a student exam question (teachers and admins only)
app.post("/api/exams/by-major/:major/questions", async (req, res) => {
  const actor = await requireExamQuestionManager(req, res);
  if (!actor) return;

  const major = normalizeExamMajor(req.params.major || req.body?.major);
  if (!major) {
    return res.status(400).json({ error: "A valid major is required." });
  }

  const payload = normalizeExamQuestionPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const exam = await ensureExamForMajor(major, { seedDefaults: true });
    if (!exam) {
      return res.status(500).json({ error: "Could not prepare exam." });
    }

    const [[orderRow]] = await db.query(
      "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order FROM exam_questions WHERE exam_id = ?",
      [exam.id],
    );
    const sortOrder = payload.sortOrder || Number(orderRow.next_sort_order || 1);
    const questionKey = payload.questionKey || `${major.toLowerCase()}-${Date.now()}`;

    await db.query(
      `INSERT INTO exam_questions
       (exam_id, created_by, question_key, question_text, options, correct_answer, sort_order, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         created_by = VALUES(created_by),
         question_text = VALUES(question_text),
         options = VALUES(options),
         correct_answer = VALUES(correct_answer),
         sort_order = VALUES(sort_order),
         is_active = 1`,
      [
        exam.id,
        actor.userId,
        questionKey,
        payload.questionText,
        JSON.stringify(payload.options),
        payload.correctAnswer,
        sortOrder,
      ],
    );

    res.status(201).json({
      success: true,
      major,
      question: {
        id: questionKey,
        question: payload.questionText,
        options: payload.options,
        correctAnswer: payload.correctAnswer,
        sortOrder,
      },
    });
  } catch (err) {
    console.error("Could not add exam question:", err.message);
    res.status(500).json({ error: "Failed to add exam question." });
  }
});

// UPDATE a student exam question (teachers and admins only)
app.put("/api/exams/by-major/:major/questions/:questionId", async (req, res) => {
  const actor = await requireExamQuestionManager(req, res);
  if (!actor) return;

  const major = normalizeExamMajor(req.params.major || req.body?.major);
  const questionId = String(req.params.questionId || "").trim();

  if (!major) {
    return res.status(400).json({ error: "A valid major is required." });
  }

  if (!questionId) {
    return res.status(400).json({ error: "Question ID is required." });
  }

  const payload = normalizeExamQuestionPayload(req.body);
  if (payload.error) {
    return res.status(400).json({ error: payload.error });
  }

  try {
    const exam = await ensureExamForMajor(major, { seedDefaults: true });
    if (!exam) {
      return res.status(500).json({ error: "Could not prepare exam." });
    }

    const [result] = await db.query(
      `UPDATE exam_questions
       SET created_by = COALESCE(?, created_by),
           question_text = ?,
           options = ?,
           correct_answer = ?,
           sort_order = COALESCE(?, sort_order),
           is_active = 1
       WHERE exam_id = ? AND question_key = ?`,
      [
        actor.userId,
        payload.questionText,
        JSON.stringify(payload.options),
        payload.correctAnswer,
        payload.sortOrder,
        exam.id,
        questionId,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Exam question not found." });
    }

    res.json({
      success: true,
      major,
      question: {
        id: questionId,
        question: payload.questionText,
        options: payload.options,
        correctAnswer: payload.correctAnswer,
        sortOrder: payload.sortOrder,
      },
    });
  } catch (err) {
    console.error("Could not update exam question:", err.message);
    res.status(500).json({ error: "Failed to update exam question." });
  }
});

// DELETE a student exam question (teachers and admins only)
app.delete("/api/exams/by-major/:major/questions/:questionId", async (req, res) => {
  const actor = await requireExamQuestionManager(req, res);
  if (!actor) return;

  const major = normalizeExamMajor(req.params.major);
  const questionId = String(req.params.questionId || "").trim();

  if (!major) {
    return res.status(400).json({ error: "A valid major is required." });
  }

  if (!questionId) {
    return res.status(400).json({ error: "Question ID is required." });
  }

  try {
    const exam = await ensureExamForMajor(major, { seedDefaults: true });
    if (!exam) {
      return res.status(500).json({ error: "Could not prepare exam." });
    }

    const [result] = await db.query(
      `UPDATE exam_questions
       SET is_active = 0
       WHERE exam_id = ? AND question_key = ? AND is_active = 1`,
      [exam.id, questionId],
    );

    if (result.affectedRows === 0) {
      const [existing] = await db.query(
        "SELECT id FROM exam_questions WHERE exam_id = ? AND question_key = ? LIMIT 1",
        [exam.id, questionId],
      );
      if (existing.length > 0) {
        return res.json({ success: true, major, questionId, alreadyDeleted: true });
      }
      return res.status(404).json({ error: "Exam question not found." });
    }

    res.json({ success: true, major, questionId });
  } catch (err) {
    console.error("Could not delete exam question:", err.message);
    res.status(500).json({ error: "Failed to delete exam question." });
  }
});

// SUBMIT student exam and award a certificate on pass
app.post("/api/users/:id/exam-attempts", async (req, res) => {
  const major = normalizeExamMajor(req.body?.major);
  const answers = req.body?.answers || {};

  const exam = await getExamDefinition(major);
  if (!exam) {
    return res.status(400).json({ error: "A valid major is required." });
  }

  try {
    await ensureCertificatesTable();
    await ensureExamTables();
    const [users] = await db.query("SELECT id, major FROM users WHERE id = ?", [
      req.params.id,
    ]);

    if (users.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    if (users[0].major && users[0].major !== major) {
      return res.status(403).json({ error: "This exam does not match the student's major." });
    }

    if (!exam.questions.length) {
      return res.status(400).json({ error: "This exam does not have any questions yet." });
    }

    const details = exam.questions.map((question) => {
      const selected = Number(answers[question.id]);
      return {
        id: question.id,
        correct: selected === question.answer,
        selected: Number.isNaN(selected) ? null : selected,
        answer: question.answer,
      };
    });
    const correct = details.filter((item) => item.correct).length;
    const score = Math.round((correct / exam.questions.length) * 100);
    const passScore = Number(exam.passScore || EXAM_PASS_SCORE);
    const passed = score >= passScore;
    let certificate = null;

    await db.query(
      `INSERT INTO exam_attempts
       (user_id, exam_id, major, score, correct_count, total_questions, passed, answers, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        exam.id || null,
        major,
        score,
        correct,
        exam.questions.length,
        passed ? 1 : 0,
        JSON.stringify(answers),
        JSON.stringify(details),
      ],
    );

    if (passed) {
      const row = await awardExamCertificate(req.params.id, major, score);
      certificate = row ? mapCertificateRow(row, req) : null;
    }

    res.json({
      success: true,
      major,
      score,
      correct,
      total: exam.questions.length,
      passScore,
      passed,
      certificate,
      details,
    });
  } catch (err) {
    console.error("Could not submit exam:", err.message);
    res.status(500).json({ error: "Failed to submit exam." });
  }
});

// GET all certificates for admin review/printing
app.get("/api/certificates", async (req, res) => {
  try {
    await ensureCertificatesTable();
    const [rows] = await db.query(
      `SELECT cert.id, cert.user_id, cert.lesson_id, cert.title, cert.issuer,
              cert.description, cert.credential_id, cert.skills, cert.grade,
              cert.hours, cert.accent_color, cert.image, cert.certificate_type,
              cert.exam_major, cert.score, cert.issued_at, cert.expiry_date,
              cert.verified,
              u.name AS student_name,
              u.email AS student_email,
              u.major AS student_major
       FROM certificates cert
       LEFT JOIN users u ON u.id = cert.user_id
       ORDER BY cert.issued_at DESC, cert.id DESC`,
    );

    res.json(rows.map((row) => mapCertificateRow(row, req)));
  } catch (err) {
    console.error("Could not load certificates:", err.message);
    res.status(500).json({ error: "Failed to load certificates." });
  }
});

// DELETE a certificate from the admin certificate list
app.delete("/api/certificates/:id", async (req, res) => {
  try {
    await ensureCertificatesTable();
    const [result] = await db.query("DELETE FROM certificates WHERE id = ?", [req.params.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Certificate not found." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Could not delete certificate:", err.message);
    res.status(500).json({ error: "Failed to delete certificate." });
  }
});

// GENERATE a certificate for a student by major
app.post("/api/certificates", async (req, res) => {
  const userId = req.body?.userId;
  const major = normalizeExamMajor(req.body?.major);
  const title = req.body?.title;

  if (!userId) {
    return res.status(400).json({ error: "Student is required." });
  }
  if (!major) {
    return res.status(400).json({ error: "A valid major is required." });
  }

  try {
    await ensureCertificatesTable();
    const [users] = await db.query(
      "SELECT id, name, email, major FROM users WHERE id = ? AND role = 'student'",
      [userId],
    );

    if (users.length === 0) {
      return res.status(404).json({ error: "Student not found." });
    }

    if (users[0].major && users[0].major !== major) {
      return res.status(400).json({ error: "Certificate major must match the student major." });
    }

    const certificate = await awardManualCertificate(userId, major, title);
    res.status(201).json({
      success: true,
      certificate: certificate ? mapCertificateRow(certificate, req) : null,
    });
  } catch (err) {
    console.error("Could not generate certificate:", err.message);
    res.status(err.status || 500).json({
      error: err.status ? err.message : "Failed to generate certificate.",
    });
  }
});

// GET certificates earned from completed enrolled lessons
app.get("/api/users/:id/certificates", async (req, res) => {
  try {
    await ensureCertificatesTable();
    // Certificate synchronization is best-effort. A malformed legacy
    // enrollment/progress row must not prevent the user from loading
    // certificates that already exist.
    try {
      await syncCompletedCertificates(req.params.id);
    } catch (syncError) {
      console.warn(
        `Could not synchronize certificates for user ${req.params.id}:`,
        syncError.message,
      );
    }

    const [rows] = await db.query(
      `SELECT id, user_id, lesson_id, title, issuer, description,
              credential_id, skills, grade, hours, accent_color, image,
              certificate_type, exam_major, score, issued_at, expiry_date, verified
       FROM certificates
       WHERE user_id = ?
       ORDER BY issued_at DESC, id DESC`,
      [req.params.id],
    );

    res.json(rows.map((row) => mapCertificateRow(row, req)));
  } catch (err) {
    console.error("âŒ GET /api/users/:id/certificates error:", err.message);
    res.status(500).json({ error: "Failed to load certificates." });
  }
});

// CHECK if user needs major selection
app.get("/api/users/:id/needs-major-select", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT major FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found." });
    }
    res.json({ needsSelect: rows[0].major === null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// LESSONS ENDPOINTS
// ===================================================================

// GET all lessons
};
