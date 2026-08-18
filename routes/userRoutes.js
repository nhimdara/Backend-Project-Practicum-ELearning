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
const {
  normalizeEmail,
  issuePasswordResetOtp,
  verifyPasswordResetOtp,
} = require("../services/passwordResetService");

module.exports = function registerUserRoutes(app) {
const requireSuperadmin = async (req, res) => {
  const actorId = Number(req.get("x-user-id"));
  if (!Number.isInteger(actorId) || actorId < 1) {
    res.status(401).json({ error: "Superadmin sign-in required." });
    return null;
  }
  const [actors] = await db.query("SELECT id, role FROM users WHERE id = ? LIMIT 1", [actorId]);
  if (actors[0]?.role !== "superadmin") {
    res.status(403).json({ error: "Only a superadmin can perform this action." });
    return null;
  }
  return actors[0];
};

app.post("/api/auth/forgot-password", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }
  try {
    const [users] = await db.query("SELECT name FROM users WHERE email = ? LIMIT 1", [email]);
    // Do not reveal whether an account exists.
    if (!users.length) return res.status(404).json({ error: "No account was found with this email." });
    const demoOtp = await issuePasswordResetOtp(email);
    return res.json({ success: true, message: "Demo reset code created.", demoOtp });
  } catch (err) {
    console.error("Forgot-password error:", err.cause?.message || err.message);
    return res.status(err.status || 500).json({ error: err.message || "Could not send reset code." });
  }
});

app.post("/api/auth/verify-reset-otp", (req, res) => {
  const result = verifyPasswordResetOtp(req.body.email, req.body.otp);
  if (!result.valid) return res.status(400).json({ error: result.error });
  return res.json({ success: true });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ error: "Password must be at least 8 characters and include a letter and number." });
  }
  const verification = verifyPasswordResetOtp(email, req.body.otp);
  if (!verification.valid) return res.status(400).json({ error: verification.error });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await db.query("UPDATE users SET password_hash = ? WHERE email = ?", [passwordHash, email]);
    if (!result.affectedRows) return res.status(400).json({ error: "Unable to reset this account." });
    verifyPasswordResetOtp(email, req.body.otp, true);
    return res.json({ success: true, message: "Password reset successfully." });
  } catch (err) {
    console.error("Reset-password error:", err.message);
    return res.status(500).json({ error: "Could not reset password. Please try again." });
  }
});

app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || name.trim().length < 2) {
    return res
      .status(400)
      .json({ error: "Name must be at least 2 characters." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res
      .status(400)
      .json({ error: "Please enter a valid email address." });
  }
  if (!password || password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
      normalizedEmail,
    ]);
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: "An account with this email already exists." });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'student')",
      [name.trim(), normalizedEmail, password_hash],
    );

    res.status(201).json({
      success: true,
      user: {
        id: result.insertId,
        name: name.trim(),
        email: normalizedEmail,
        role: "student",
      },
    });
  } catch (err) {
    console.error("❌ /api/register error:", err.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// LOGIN - verify credentials against MySQL
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Please enter your email and password." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const [rows] = await db.query(
      `SELECT id, name, email, password_hash, role, major,
              start_year, end_year, academic_year, avatar
       FROM users WHERE email = ?`,
      [normalizedEmail],
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Update last login
    await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [
      user.id,
    ]);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        major: user.major || null,
        avatar: assetUrl(req, user.avatar) || fallbackAvatar(user.name),
        startYear: user.start_year || null,
        endYear: user.end_year || null,
        academicYear: user.start_year
          ? getCurrentAcademicYear(user.start_year)
          : user.academic_year || null,
        needsMajorSelect:
          !user.major && (user.role === "student" || user.role === "teacher"),
      },
    });
  } catch (err) {
    console.error("❌ /api/login error:", err.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// ===================================================================
// USER MANAGEMENT ENDPOINTS
// ===================================================================

// GET all users (admin dashboard)
app.get("/api/users", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at AS joinDate,
              last_login
       FROM users ORDER BY id DESC`,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        academicYear: row.startYear
          ? getCurrentAcademicYear(row.startYear)
          : row.academicYear,
      })),
    );
  } catch (err) {
    console.error("❌ /api/users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// SUPERADMIN: overview of all primary website data.
app.get("/api/superadmin/summary", async (req, res) => {
  try {
    if (!(await requireSuperadmin(req, res))) return;
    const tables = ["users", "lessons", "videos", "projects", "certificates"];
    const summary = {};
    for (const table of tables) {
      const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${table}`);
      summary[table] = Number(rows[0]?.count || 0);
    }
    res.json(summary);
  } catch (err) {
    console.error("Superadmin summary error:", err.message);
    res.status(500).json({ error: "Could not load website summary." });
  }
});

app.get("/api/superadmin/admins", async (req, res) => {
  try {
    if (!(await requireSuperadmin(req, res))) return;
    const [rows] = await db.query(
      "SELECT id, name, email, role, created_at AS joinDate, last_login FROM users WHERE role IN ('admin', 'superadmin') ORDER BY id DESC",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load administrators." });
  }
});

app.post("/api/superadmin/admins", async (req, res) => {
  try {
    if (!(await requireSuperadmin(req, res))) return;
    const name = String(req.body.name || "").trim();
    const emailBase = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.|\.$/g, "") || "admin";
    let email = `${emailBase}.admin@${EMAIL_DOMAIN}`;
    const password = String(req.body.password || require("crypto").randomBytes(12).toString("base64url"));
    if (name.length < 2) return res.status(400).json({ error: "Admin name must be at least 2 characters." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters with a letter and number." });
    }
    let suffix = 2;
    let [existing] = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    while (existing.length) {
      email = `${emailBase}.admin${suffix}@${EMAIL_DOMAIN}`;
      suffix += 1;
      [existing] = await db.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await db.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')",
      [name, email, passwordHash],
    );
    res.status(201).json({
      success: true,
      admin: { id: result.insertId, name, email, role: "admin" },
      temporaryPassword: password,
    });
  } catch (err) {
    console.error("Create admin error:", err.message);
    res.status(500).json({ error: "Could not create administrator." });
  }
});

app.delete("/api/superadmin/admins/:id", async (req, res) => {
  try {
    if (!(await requireSuperadmin(req, res))) return;
    const [result] = await db.query("DELETE FROM users WHERE id = ? AND role = 'admin'", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Administrator not found." });
    res.json({ success: true });
  } catch (err) {
    console.error("Delete admin error:", err.message);
    res.status(500).json({ error: "Could not delete administrator. Reassign their related data first." });
  }
});

// GET user by ID (for session restore)
app.get("/api/users/:id", async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at AS joinDate,
              last_login,
              avatar, phone, location, bio, occupation, education,
              website, github, linkedin, twitter, skills, languages
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    const stats = await getUserLearningStats(req.params.id);
    res.json(publicUserProfile(rows[0], stats, req));
  } catch (err) {
    console.error("❌ GET /api/users/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// CREATE a student account from the admin dashboard
app.post("/api/users/students", async (req, res) => {
  const {
    name,
    password,
    major,
    startYear,
    endYear,
    email,
  } = req.body;

  const cleanName = String(name || "").trim();
  const cleanMajor = major || "ITE";
  const parsedStartYear = Number.parseInt(startYear, 10);
  const parsedEndYear = Number.parseInt(endYear, 10);
  const cleanPassword = password || "Student@123";

  if (cleanName.length < 2) {
    return res
      .status(400)
      .json({ error: "Student name must be at least 2 characters." });
  }
  if (!ALLOWED_MAJORS.includes(cleanMajor)) {
    return res
      .status(400)
      .json({ error: `major must be one of: ${ALLOWED_MAJORS.join(", ")}` });
  }
  if (
    Number.isNaN(parsedStartYear) ||
    Number.isNaN(parsedEndYear) ||
    parsedEndYear <= parsedStartYear
  ) {
    return res.status(400).json({
      error: "Start year and end year are required, and end year must be later.",
    });
  }
  if (cleanPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  let generatedEmail = (
    email || buildStudentEmail(cleanName, parsedStartYear, parsedEndYear, cleanMajor)
  )
    .toLowerCase()
    .trim();
  const selectedAcademicYear = getCurrentAcademicYear(parsedStartYear);

  try {
    if (!email) {
      let suffix = 2;
      let [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
        generatedEmail,
      ]);
      while (existing.length > 0) {
        const { firstName, lastName } = getStudentEmailNameParts(cleanName);
        const start = String(parsedStartYear).slice(-2);
        const end = String(parsedEndYear).slice(-2);
        const cleanMajorStr = cleanMajor
          ? String(cleanMajor).toLowerCase().replace(/[^a-z0-9]/g, "")
          : "";
        const majorPart = cleanMajorStr ? `.${cleanMajorStr}` : "";
        generatedEmail = `${firstName}.${lastName}${majorPart}${suffix}.${start}${end}@${EMAIL_DOMAIN}`;
        suffix++;
        [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
          generatedEmail,
        ]);
      }
    } else {
      const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
        generatedEmail,
      ]);
      if (existing.length > 0) {
        return res
          .status(409)
          .json({ error: "A student with this generated email already exists." });
      }
    }

    const password_hash = await bcrypt.hash(cleanPassword, 10);
    const [result] = await db.query(
      `INSERT INTO users
       (name, email, password_hash, role, major, start_year, end_year, academic_year)
       VALUES (?, ?, ?, 'student', ?, ?, ?, ?)`,
      [
        cleanName,
        generatedEmail,
        password_hash,
        cleanMajor,
        parsedStartYear,
        parsedEndYear,
        clampAcademicYear(selectedAcademicYear),
      ],
    );

    res.status(201).json({
      success: true,
      user: {
        id: result.insertId,
        name: cleanName,
        email: generatedEmail,
        role: "student",
        major: cleanMajor,
        startYear: parsedStartYear,
        endYear: parsedEndYear,
        academicYear: clampAcademicYear(selectedAcademicYear),
      },
      temporaryPassword: cleanPassword,
    });
  } catch (err) {
    console.error("❌ POST /api/users/students error:", err.message);
    res.status(500).json({ error: "Failed to create student account." });
  }
});

// CREATE a teacher account from the admin dashboard
app.post("/api/users/teachers", async (req, res) => {
  const { name, password, major, email } = req.body;

  const cleanName = String(name || "").trim();
  const cleanMajor = major || "ITE";
  const cleanPassword = password || "Teacher@123";

  if (cleanName.length < 2) {
    return res
      .status(400)
      .json({ error: "Teacher name must be at least 2 characters." });
  }
  if (!ALLOWED_MAJORS.includes(cleanMajor)) {
    return res
      .status(400)
      .json({ error: `major must be one of: ${ALLOWED_MAJORS.join(", ")}` });
  }
  if (cleanPassword.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  const generatedEmail = (email || buildStaffEmail(cleanName, "teacher"))
    .toLowerCase()
    .trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(generatedEmail)) {
    return res
      .status(400)
      .json({ error: "Please enter a valid teacher email address." });
  }

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
      generatedEmail,
    ]);
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: "A teacher with this generated email already exists." });
    }

    const password_hash = await bcrypt.hash(cleanPassword, 10);
    const [result] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, major)
       VALUES (?, ?, ?, 'teacher', ?)`,
      [cleanName, generatedEmail, password_hash, cleanMajor],
    );

    res.status(201).json({
      success: true,
      user: {
        id: result.insertId,
        name: cleanName,
        email: generatedEmail,
        role: "teacher",
        major: cleanMajor,
      },
      temporaryPassword: cleanPassword,
    });
  } catch (err) {
    console.error("❌ POST /api/users/teachers error:", err.message);
    if (err.code === "WARN_DATA_TRUNCATED" || err.code === "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD") {
      return res.status(500).json({
        error:
          "The database does not allow teacher accounts yet. Restart the backend so it can update the users.role column.",
      });
    }
    res.status(500).json({ error: "Failed to create teacher account." });
  }
});

// UPDATE a student account's academic details
app.put("/api/users/:id/student-profile", async (req, res) => {
  const { major, startYear, endYear, academicYear } = req.body;

  if (major && !ALLOWED_MAJORS.includes(major)) {
    return res
      .status(400)
      .json({ error: `major must be one of: ${ALLOWED_MAJORS.join(", ")}` });
  }

  try {
    const [result] = await db.query(
      `UPDATE users SET
         major = COALESCE(?, major),
         start_year = COALESCE(?, start_year),
         end_year = COALESCE(?, end_year),
         academic_year = COALESCE(?, academic_year)
       WHERE id = ?`,
      [
        major || null,
        startYear || null,
        endYear || null,
        academicYear ? clampAcademicYear(academicYear) : null,
        req.params.id,
      ],
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ PUT /api/users/:id/student-profile error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a user
app.delete("/api/users/:id", async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM users WHERE id = ?", [
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ DELETE /api/users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user's major
app.put("/api/users/:id/major", async (req, res) => {
  const { major } = req.body;
  if (!major || !ALLOWED_MAJORS.includes(major)) {
    return res
      .status(400)
      .json({ error: `major must be one of: ${ALLOWED_MAJORS.join(", ")}` });
  }
  try {
    const [result] = await db.query("UPDATE users SET major = ? WHERE id = ?", [
      major,
      req.params.id,
    ]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({ success: true, major });
  } catch (err) {
    console.error("❌ PUT /api/users/:id/major error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET user profile
app.get("/api/users/:id/profile", async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at AS joinDate,
              last_login,
              avatar, phone, location, bio, occupation, education,
              website, github, linkedin, twitter, skills, languages
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    const stats = await getUserLearningStats(req.params.id);
    res.json(publicUserProfile(rows[0], stats, req));
  } catch (err) {
    console.error("❌ GET /api/users/:id/profile error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE user profile
app.put("/api/users/:id/profile", async (req, res) => {
  const allowed = [
    "name",
    "email",
    "avatar",
    "phone",
    "location",
    "bio",
    "occupation",
    "education",
    "website",
    "github",
    "linkedin",
    "twitter",
    "skills",
    "languages",
  ];
  const payload = {};

  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      payload[field] = ["skills", "languages"].includes(field)
        ? stringifyListField(req.body[field])
        : String(req.body[field] || "").trim() || null;
    }
  }

  if (payload.name !== undefined && (!payload.name || payload.name.length < 2)) {
    return res.status(400).json({ error: "Name must be at least 2 characters." });
  }
  if (payload.email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    payload.email = payload.email.toLowerCase();
    if (!emailRegex.test(payload.email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
  }

  try {
    await ensureUserProfileColumns();
    if (payload.email) {
      const [existing] = await db.query(
        "SELECT id FROM users WHERE email = ? AND id <> ?",
        [payload.email, req.params.id],
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: "That email is already in use." });
      }
    }

    const fields = Object.keys(payload);
    if (fields.length > 0) {
      const assignments = fields.map((field) => `\`${field}\` = ?`).join(", ");
      const values = fields.map((field) => payload[field]);
      const [result] = await db.query(
        `UPDATE users SET ${assignments} WHERE id = ?`,
        [...values, req.params.id],
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "User not found." });
      }
    }

    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at AS joinDate,
              last_login,
              avatar, phone, location, bio, occupation, education,
              website, github, linkedin, twitter, skills, languages
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    const stats = await getUserLearningStats(req.params.id);
    res.json({ success: true, user: publicUserProfile(rows[0], stats, req) });
  } catch (err) {
    console.error("âŒ PUT /api/users/:id/profile error:", err.message);
    res.status(500).json({ error: "Failed to update profile." });
  }
});

// UPDATE user profile photo
app.post("/api/users/:id/avatar", async (req, res) => {
  try {
    await ensureUserProfileColumns();
    const { buffer, extension } = decodeAvatarImage(req.body?.image);
    ensureAvatarUploadDir();

    const safeUserId = String(req.params.id).replace(/[^a-z0-9_-]/gi, "");
    const filename = `user-${safeUserId}-${Date.now()}.${extension}`;
    const diskPath = path.join(AVATAR_UPLOAD_DIR, filename);
    const savedPath = `/uploads/avatars/${filename}`;

    await fs.promises.writeFile(diskPath, buffer);

    const [result] = await db.query("UPDATE users SET avatar = ? WHERE id = ?", [
      savedPath,
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      await fs.promises.unlink(diskPath).catch(() => {});
      return res.status(404).json({ error: "User not found." });
    }

    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at AS joinDate,
              last_login,
              avatar, phone, location, bio, occupation, education,
              website, github, linkedin, twitter, skills, languages
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    const stats = await getUserLearningStats(req.params.id);
    const user = publicUserProfile(rows[0], stats, req);

    res.json({
      success: true,
      avatar: user.avatar,
      user,
    });
  } catch (err) {
    console.error("Could not update avatar:", err.message);
    res.status(err.status || 500).json({
      error: err.status ? err.message : "Failed to update profile photo.",
    });
  }
});

// GET major-specific student exam
};
