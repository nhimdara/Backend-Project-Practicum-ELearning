const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const db = require("./db");
require("dotenv").config();

// Fix: Correct Anthropic import
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());

const ALLOWED_MAJORS = ["ITE", "IT", "Mathematics"];
const EMAIL_DOMAIN = "elearning.com";

function clampAcademicYear(value) {
  const year = Number.parseInt(value, 10);
  if (Number.isNaN(year)) return 1;
  return Math.min(4, Math.max(1, year));
}

function getCurrentAcademicYear(startYear) {
  const start = Number.parseInt(startYear, 10);
  if (Number.isNaN(start)) return 1;
  return clampAcademicYear(new Date().getFullYear() - start + 1);
}

function normalizeStudentEmailName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

function buildStudentEmail(name, startYear, endYear) {
  const base = normalizeStudentEmailName(name);
  const start = String(startYear).slice(-2);
  const end = String(endYear).slice(-2);
  return `${base}.${end}${start}@${EMAIL_DOMAIN}`;
}

function buildStaffEmail(name, role) {
  const base = normalizeStudentEmailName(name);
  return `${base}.${role}@${EMAIL_DOMAIN}`;
}

async function ensureStudentYearColumns() {
  try {
    const [columns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('start_year', 'end_year', 'academic_year')`,
    );
    const existing = new Set(columns.map((column) => column.COLUMN_NAME));
    const alters = [];
    if (!existing.has("start_year")) {
      alters.push("ADD COLUMN start_year INT NULL");
    }
    if (!existing.has("end_year")) {
      alters.push("ADD COLUMN end_year INT NULL");
    }
    if (!existing.has("academic_year")) {
      alters.push("ADD COLUMN academic_year TINYINT NULL");
    }
    if (alters.length > 0) {
      await db.query(`ALTER TABLE users ${alters.join(", ")}`);
      console.log("✅ Student year columns are ready");
    }
  } catch (err) {
    console.error("❌ Could not verify student year columns:", err.message);
  }
}

async function ensureTeacherRoleValue() {
  try {
    const [columns] = await db.query(
      `SHOW COLUMNS FROM users WHERE Field = 'role'`,
    );
    const roleType = columns[0]?.Type || "";

    if (!roleType.includes("'teacher'")) {
      await db.query(
        `ALTER TABLE users
         MODIFY role ENUM('student','teacher','admin') DEFAULT 'student'`,
      );
      console.log("✅ Teacher role is ready");
    }
  } catch (err) {
    console.error("❌ Could not verify teacher role:", err.message);
  }
}

// ===================================================================
// CONFIGURATION & INITIALIZATION
// ===================================================================

// Fix: Better API key initialization with error checking
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("❌ ANTHROPIC_API_KEY is missing in .env file");
  console.error("Please add your Anthropic API key to .env file");
}

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "dummy-key-for-checking",
});

// ===================================================================
// AI CHAT ENDPOINT
// ===================================================================
app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  // Check if API key is configured
  if (
    !process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_API_KEY === "dummy-key-for-checking"
  ) {
    return res.status(500).json({
      error:
        "AI service is not configured. Please add ANTHROPIC_API_KEY to .env file",
      details: "Missing API key configuration",
    });
  }

  try {
    // Format messages for Claude API
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Call Claude API
    const response = await anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      system:
        system ||
        "You are a helpful AI learning assistant for an e-learning platform.",
      messages: formattedMessages,
    });

    // Extract the text response
    const reply = response.content[0].text;

    res.json({
      success: true,
      response: reply,
      content: reply,
    });
  } catch (error) {
    console.error("❌ Anthropic API error:", error.message);

    // Better error handling
    let errorMessage = "Failed to get AI response";
    let statusCode = 500;

    if (error.status === 401) {
      errorMessage = "Invalid Anthropic API key. Please check your .env file.";
      statusCode = 401;
    } else if (error.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
      statusCode = 429;
    } else if (error.status === 500) {
      errorMessage = "Anthropic service error. Please try again later.";
      statusCode = 500;
    } else if (error.message?.includes("API key")) {
      errorMessage =
        "API key not configured. Please add ANTHROPIC_API_KEY to .env file";
      statusCode = 401;
    }

    res.status(statusCode).json({
      error: errorMessage,
      details: error.message,
    });
  }
});

// ===================================================================
// HEALTH CHECK
// ===================================================================
app.get("/api/health", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT COUNT(*) AS total FROM lessons");
    res.json({ status: "ok", lessons: rows[0].total });
  } catch (err) {
    res.status(500).json({ status: "db_error", error: err.message });
  }
});

// ===================================================================
// AUTHENTICATION ENDPOINTS
// ===================================================================

// REGISTER - save new user to MySQL
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
              start_year, end_year, academic_year
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

// GET user by ID (for session restore)
app.get("/api/users/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({
      ...rows[0],
      academicYear: rows[0].startYear
        ? getCurrentAcademicYear(rows[0].startYear)
        : rows[0].academicYear,
    });
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

  const generatedEmail = (
    email || buildStudentEmail(cleanName, parsedStartYear, parsedEndYear)
  )
    .toLowerCase()
    .trim();
  const selectedAcademicYear = getCurrentAcademicYear(parsedStartYear);

  try {
    const [existing] = await db.query("SELECT id FROM users WHERE email = ?", [
      generatedEmail,
    ]);
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ error: "A student with this generated email already exists." });
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
    const [rows] = await db.query(
      `SELECT id, name, email, role, major,
              start_year AS startYear,
              end_year AS endYear,
              academic_year AS academicYear,
              created_at, last_login
       FROM users WHERE id = ?`,
      [req.params.id],
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    res.json({
      ...rows[0],
      academicYear: rows[0].startYear
        ? getCurrentAcademicYear(rows[0].startYear)
        : rows[0].academicYear,
    });
  } catch (err) {
    console.error("❌ GET /api/users/:id/profile error:", err.message);
    res.status(500).json({ error: err.message });
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
      "SELECT * FROM videos WHERE lesson_id = ? ORDER BY order_index",
      [req.params.id],
    );

    res.json({
      ...lessons[0],
      videos,
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
app.get("/api/videos", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, lesson_id, title, link, thumbnail, duration_minutes, view_count, description, is_free, order_index FROM videos ORDER BY lesson_id, order_index",
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ /api/videos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET videos for a specific lesson
app.get("/api/lessons/:id/videos", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM videos WHERE lesson_id = ? ORDER BY order_index",
      [req.params.id],
    );
    res.json(rows);
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
    const [result] = await db.query(
      `INSERT INTO videos 
       (lesson_id, title, link, duration_minutes, description, is_free, order_index) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        lesson_id,
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

  try {
    const [result] = await db.query(
      `UPDATE videos SET 
        lesson_id = ?, title = ?, link = ?, duration_minutes = ?,
        description = ?, is_free = ?, order_index = ?
       WHERE id = ?`,
      [
        lesson_id,
        title.trim(),
        link.trim(),
        duration_minutes || null,
        description || null,
        is_free ? 1 : 0,
        order_index || 1,
        req.params.id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Video not found." });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("❌ PUT /api/videos error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE a video
app.delete("/api/videos/:id", async (req, res) => {
  try {
    // Delete related video progress first
    await db.query("DELETE FROM video_progress WHERE video_id = ?", [
      req.params.id,
    ]);

    const [result] = await db.query("DELETE FROM videos WHERE id = ?", [
      req.params.id,
    ]);
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
app.get("/api/projects", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM projects WHERE is_active = 1 ORDER BY featured DESC, id DESC",
    );

    const projects = rows.map((project) => ({
      ...project,
      tags: project.tags ? project.tags.split(", ") : [],
    }));

    res.json(projects);
  } catch (err) {
    console.error("❌ /api/projects error:", err.message);
    res.status(500).json({ error: err.message });
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
    // Increment view count
    await db.query(
      "UPDATE projects SET view_count = view_count + 1 WHERE id = ?",
      [req.params.id],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ GET /api/projects/:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ===================================================================
// REFERENCE DATA ENDPOINTS
// ===================================================================

// GET all years
app.get("/api/years", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name FROM years ORDER BY display_order, id",
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
// ERROR HANDLING MIDDLEWARE
// ===================================================================
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ===================================================================
// START SERVER
// ===================================================================
const PORT = process.env.PORT || 5001;
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 API URL: http://localhost:${PORT}/api`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api/health`);
  ensureTeacherRoleValue();
  ensureStudentYearColumns();

  // Debug check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ WARNING: ANTHROPIC_API_KEY is not set in .env file");
    console.error(
      "   AI chat feature will not work until you add your API key",
    );
  } else {
    console.log("✅ Anthropic API key is configured");
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
