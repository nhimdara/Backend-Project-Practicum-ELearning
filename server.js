const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const db = require("./db");
require("dotenv").config();

// Fix: Correct Anthropic import
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const UPLOAD_ROOT = path.join(__dirname, "uploads");
const AVATAR_UPLOAD_DIR = path.join(UPLOAD_ROOT, "avatars");
const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const corsOptions = {
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id", "x-user-role"],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: "6mb" }));
app.use("/uploads", express.static(UPLOAD_ROOT));

const ALLOWED_MAJORS = ["ITE", "IT", "Mathematics"];
const EMAIL_DOMAIN = "elearning.com";
const EXAM_PASS_SCORE = 70;

const EXAM_BANK = {
  ITE: {
    title: "ITE Comprehensive Exam",
    description: "Information Technology Engineering readiness exam",
    accentColor: "#2563eb",
    questions: [
      {
        id: "ite-1",
        question: "Which layer of the OSI model is responsible for routing packets between networks?",
        options: ["Application", "Transport", "Network", "Data Link"],
        answer: 2,
      },
      {
        id: "ite-2",
        question: "What is the main purpose of a database index?",
        options: ["Encrypt table data", "Speed up data lookup", "Delete duplicate rows", "Create backups"],
        answer: 1,
      },
      {
        id: "ite-3",
        question: "In software engineering, what does API stand for?",
        options: ["Application Programming Interface", "Advanced Program Input", "Applied Protocol Internet", "Application Process Index"],
        answer: 0,
      },
      {
        id: "ite-4",
        question: "Which data structure uses FIFO order?",
        options: ["Stack", "Queue", "Tree", "Graph"],
        answer: 1,
      },
      {
        id: "ite-5",
        question: "What does HTTPS add to HTTP?",
        options: ["Compression", "Encryption through TLS", "Offline caching", "Database access"],
        answer: 1,
      },
    ],
  },
  IT: {
    title: "IT Comprehensive Exam",
    description: "Information Technology core skills exam",
    accentColor: "#0891b2",
    questions: [
      {
        id: "it-1",
        question: "Which command-line tool is commonly used to test network reachability?",
        options: ["ping", "mkdir", "sort", "rename"],
        answer: 0,
      },
      {
        id: "it-2",
        question: "What does SQL mainly help you do?",
        options: ["Design images", "Query and manage relational data", "Compile JavaScript", "Configure routers only"],
        answer: 1,
      },
      {
        id: "it-3",
        question: "Which protocol is commonly used to send email?",
        options: ["SMTP", "FTP", "SSH", "DNS"],
        answer: 0,
      },
      {
        id: "it-4",
        question: "What is two-factor authentication used for?",
        options: ["Faster downloads", "Extra login security", "Image compression", "Code formatting"],
        answer: 1,
      },
      {
        id: "it-5",
        question: "Which cloud concept means adding more servers to handle load?",
        options: ["Horizontal scaling", "Defragmentation", "Serialization", "Packet sniffing"],
        answer: 0,
      },
    ],
  },
  Mathematics: {
    title: "Mathematics Comprehensive Exam",
    description: "Mathematics foundation and reasoning exam",
    accentColor: "#7c3aed",
    questions: [
      {
        id: "math-1",
        question: "What is the derivative of x^2?",
        options: ["x", "2x", "x^3", "2"],
        answer: 1,
      },
      {
        id: "math-2",
        question: "If A = {1, 2} and B = {2, 3}, what is A union B?",
        options: ["{2}", "{1, 2, 3}", "{1, 3}", "{}"],
        answer: 1,
      },
      {
        id: "math-3",
        question: "What is the determinant of [[1, 0], [0, 1]]?",
        options: ["0", "1", "2", "-1"],
        answer: 1,
      },
      {
        id: "math-4",
        question: "Which number is prime?",
        options: ["21", "27", "29", "39"],
        answer: 2,
      },
      {
        id: "math-5",
        question: "What is the probability of getting heads when flipping a fair coin once?",
        options: ["0", "1/4", "1/2", "1"],
        answer: 2,
      },
    ],
  },
};

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

function getStudentEmailNameParts(name) {
  const parts = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const firstName = (parts[0] || "student").slice(0, 24);
  const lastName = (parts.length > 1 ? parts[parts.length - 1] : firstName).slice(
    0,
    24,
  );
  return { firstName, lastName };
}

function buildStudentEmail(name, startYear, endYear) {
  const { firstName, lastName } = getStudentEmailNameParts(name);
  const start = String(startYear).slice(-2);
  const end = String(endYear).slice(-2);
  return `${firstName}.${lastName}.${start}${end}@${EMAIL_DOMAIN}`;
}

function buildStaffEmail(name, role) {
  const { firstName, lastName } = getStudentEmailNameParts(name);
  return `${firstName}.${lastName}.${role}@${EMAIL_DOMAIN}`;
}

function dedupeVideos(rows) {
  const bySlot = new Map();
  for (const row of rows) {
    const key = `${row.lesson_id}:${row.order_index || 1}`;
    const current = bySlot.get(key);
    if (!current || Number(row.id) > Number(current.id)) {
      bySlot.set(key, row);
    }
  }
  return [...bySlot.values()].sort(
    (a, b) =>
      Number(a.lesson_id) - Number(b.lesson_id) ||
      Number(a.order_index || 1) - Number(b.order_index || 1) ||
      Number(a.id) - Number(b.id),
  );
}

async function removeDuplicateVideoSlots(lessonId, orderIndex, keepId) {
  await db.query(
    `DELETE FROM videos
     WHERE lesson_id = ?
       AND COALESCE(order_index, 1) = ?
       AND id <> ?`,
    [lessonId, orderIndex || 1, keepId],
  );
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

async function ensureUserProfileColumns() {
  try {
    const [columns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN (
           'avatar', 'phone', 'location', 'bio', 'occupation', 'education',
           'website', 'github', 'linkedin', 'twitter', 'skills', 'languages'
         )`,
    );
    const existing = new Set(columns.map((column) => column.COLUMN_NAME));
    const alters = [];
    if (!existing.has("avatar")) alters.push("ADD COLUMN avatar TEXT NULL");
    if (!existing.has("phone")) alters.push("ADD COLUMN phone VARCHAR(50) NULL");
    if (!existing.has("location")) alters.push("ADD COLUMN location VARCHAR(255) NULL");
    if (!existing.has("bio")) alters.push("ADD COLUMN bio TEXT NULL");
    if (!existing.has("occupation")) alters.push("ADD COLUMN occupation VARCHAR(255) NULL");
    if (!existing.has("education")) alters.push("ADD COLUMN education VARCHAR(255) NULL");
    if (!existing.has("website")) alters.push("ADD COLUMN website VARCHAR(255) NULL");
    if (!existing.has("github")) alters.push("ADD COLUMN github VARCHAR(255) NULL");
    if (!existing.has("linkedin")) alters.push("ADD COLUMN linkedin VARCHAR(255) NULL");
    if (!existing.has("twitter")) alters.push("ADD COLUMN twitter VARCHAR(255) NULL");
    if (!existing.has("skills")) alters.push("ADD COLUMN skills TEXT NULL");
    if (!existing.has("languages")) alters.push("ADD COLUMN languages TEXT NULL");

    if (alters.length > 0) {
      await db.query(`ALTER TABLE users ${alters.join(", ")}`);
      console.log("User profile columns are ready");
    }
  } catch (err) {
    console.error("Could not verify user profile columns:", err.message);
  }
}

function parseListField(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {}
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyListField(value) {
  return JSON.stringify(parseListField(value));
}

function ensureAvatarUploadDir() {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
}

function requestOrigin(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function assetUrl(req, value) {
  if (!value) return "";
  const url = String(value);
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) {
    return url;
  }
  if (!url.startsWith("/")) {
    return url;
  }
  return req ? `${requestOrigin(req)}${url}` : url;
}

function fallbackAvatar(name) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "User")}&background=6366f1&color=fff&size=128`;
}

function hasImageSignature(buffer, mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/gif") {
    return buffer.subarray(0, 4).toString("ascii") === "GIF8";
  }
  if (mimeType === "image/webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function decodeAvatarImage(image) {
  const match = String(image || "").match(/^data:(image\/(?:jpe?g|png|gif|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error("Please upload a JPG, PNG, GIF, or WebP image.");
    err.status = 400;
    throw err;
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = IMAGE_EXTENSIONS[mimeType];
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  if (buffer.length === 0 || !extension || !hasImageSignature(buffer, mimeType)) {
    const err = new Error("The uploaded file is not a valid image.");
    err.status = 400;
    throw err;
  }

  if (buffer.length > MAX_AVATAR_SIZE_BYTES) {
    const err = new Error("Profile photo must be smaller than 2MB.");
    err.status = 413;
    throw err;
  }

  return { buffer, extension };
}

function publicUserProfile(row, stats = {}, req = null) {
  const academicYear = row.startYear
    ? getCurrentAcademicYear(row.startYear)
    : row.academicYear || null;

  return {
    ...row,
    role: row.role === "student" ? "client" : row.role,
    dbRole: row.role,
    academicYear,
    joinDate: row.joinDate || row.created_at || null,
    avatar: assetUrl(req, row.avatar) || fallbackAvatar(row.name),
    occupation:
      row.occupation ||
      (row.role === "teacher" ? "Teacher" : row.role === "admin" ? "Administrator" : "Student"),
    education: row.education || row.major || "",
    bio: row.bio || "",
    phone: row.phone || "",
    location: row.location || "",
    website: row.website || "",
    github: row.github || "",
    linkedin: row.linkedin || "",
    twitter: row.twitter || "",
    skills: parseListField(row.skills),
    languages: parseListField(row.languages),
    achievements: [
      row.role === "teacher" ? "Teacher" : row.role === "admin" ? "Admin" : "Learner",
      ...(stats.certificates > 0 ? ["Certificate Earner"] : []),
      ...(stats.coursesEnrolled > 0 ? ["Course Explorer"] : []),
    ],
    coursesEnrolled: Number(stats.coursesEnrolled || 0),
    certificates: Number(stats.certificates || 0),
    progress: Math.round(Number(stats.progress || 0)),
  };
}

async function getUserLearningStats(userId) {
  const [[enrollments]] = await db.query(
    "SELECT COUNT(*) AS coursesEnrolled FROM enrollments WHERE user_id = ?",
    [userId],
  );
  const [[progress]] = await db.query(
    `SELECT COALESCE(AVG(lesson_progress), 0) AS progress
     FROM (
       SELECT
         e.lesson_id,
         CASE
           WHEN COUNT(v.id) = 0 THEN 0
           ELSE (SUM(CASE WHEN COALESCE(vp.completed, 0) = 1 THEN 1 ELSE 0 END) / COUNT(v.id)) * 100
         END AS lesson_progress
       FROM enrollments e
       LEFT JOIN videos v ON v.lesson_id = e.lesson_id
       LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.user_id = e.user_id
       WHERE e.user_id = ?
       GROUP BY e.lesson_id
     ) progress_rows`,
    [userId],
  );
  const [[certificates]] = await db.query(
    `SELECT COUNT(*) AS certificates
     FROM (
       SELECT e.lesson_id
       FROM enrollments e
       JOIN videos v ON v.lesson_id = e.lesson_id
       LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.user_id = e.user_id
       WHERE e.user_id = ?
       GROUP BY e.lesson_id
       HAVING COUNT(v.id) > 0
          AND SUM(CASE WHEN COALESCE(vp.completed, 0) = 1 THEN 1 ELSE 0 END) >= COUNT(v.id)
     ) completed_lessons`,
    [userId],
  );

  return {
    coursesEnrolled: enrollments.coursesEnrolled || 0,
    progress: progress.progress || 0,
    certificates: certificates.certificates || 0,
  };
}

async function ensureCertificatesTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS certificates (
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT(10) UNSIGNED NOT NULL,
        lesson_id INT(10) UNSIGNED NULL,
        title VARCHAR(255) NOT NULL,
        issuer VARCHAR(255) NOT NULL DEFAULT 'Elearning Academy',
        description TEXT NULL,
        credential_id VARCHAR(100) NOT NULL,
        skills TEXT NULL,
        grade VARCHAR(50) DEFAULT 'Complete',
        hours DECIMAL(8,2) DEFAULT 0,
        accent_color VARCHAR(20) DEFAULT '#6366f1',
        image TEXT NULL,
        certificate_type VARCHAR(30) DEFAULT 'lesson',
        exam_major VARCHAR(50) NULL,
        score DECIMAL(5,2) NULL,
        issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expiry_date DATETIME NULL,
        verified TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_user_lesson (user_id, lesson_id),
        UNIQUE KEY unique_credential_id (credential_id),
        INDEX idx_certificates_user_id (user_id)
      )
    `);

    const [columns] = await db.query(
      `SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'certificates'`,
    );
    const existing = new Set(columns.map((column) => column.COLUMN_NAME));
    const alters = [];
    if (!existing.has("user_id")) alters.push("ADD COLUMN user_id INT NOT NULL");
    if (!existing.has("lesson_id")) alters.push("ADD COLUMN lesson_id INT NOT NULL");
    if (!existing.has("title")) alters.push("ADD COLUMN title VARCHAR(255) NOT NULL");
    if (!existing.has("issuer")) alters.push("ADD COLUMN issuer VARCHAR(255) NOT NULL DEFAULT 'Elearning Academy'");
    if (!existing.has("description")) alters.push("ADD COLUMN description TEXT NULL");
    if (!existing.has("credential_id")) alters.push("ADD COLUMN credential_id VARCHAR(100) NOT NULL");
    if (!existing.has("skills")) alters.push("ADD COLUMN skills TEXT NULL");
    if (!existing.has("grade")) alters.push("ADD COLUMN grade VARCHAR(50) DEFAULT 'Complete'");
    if (!existing.has("hours")) alters.push("ADD COLUMN hours DECIMAL(8,2) DEFAULT 0");
    if (!existing.has("accent_color")) alters.push("ADD COLUMN accent_color VARCHAR(20) DEFAULT '#6366f1'");
    if (!existing.has("image")) alters.push("ADD COLUMN image TEXT NULL");
    if (!existing.has("certificate_type")) alters.push("ADD COLUMN certificate_type VARCHAR(30) DEFAULT 'lesson'");
    if (!existing.has("exam_major")) alters.push("ADD COLUMN exam_major VARCHAR(50) NULL");
    if (!existing.has("score")) alters.push("ADD COLUMN score DECIMAL(5,2) NULL");
    if (!existing.has("issued_at")) alters.push("ADD COLUMN issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP");
    if (!existing.has("expiry_date")) alters.push("ADD COLUMN expiry_date DATETIME NULL");
    if (!existing.has("verified")) alters.push("ADD COLUMN verified TINYINT(1) DEFAULT 1");

    if (alters.length > 0) {
      await db.query(`ALTER TABLE certificates ${alters.join(", ")}`);
      console.log("Certificates table is ready");
    }

    const lessonId = columns.find((column) => column.COLUMN_NAME === "lesson_id");
    if (lessonId && lessonId.IS_NULLABLE === "NO") {
      await db.query(`ALTER TABLE certificates MODIFY lesson_id ${lessonId.COLUMN_TYPE || "INT"} NULL`);
    }
  } catch (err) {
    console.error("Could not verify certificates table:", err.message);
  }
}

async function ensureExamTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS exams (
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        major VARCHAR(50) NOT NULL UNIQUE,
        title VARCHAR(255) NOT NULL,
        description TEXT NULL,
        pass_score INT NOT NULL DEFAULT 70,
        accent_color VARCHAR(20) DEFAULT '#4f46e5',
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS exam_questions (
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        exam_id INT(10) UNSIGNED NOT NULL,
        created_by INT(10) UNSIGNED NULL,
        question_key VARCHAR(100) NOT NULL,
        question_text TEXT NOT NULL,
        options TEXT NOT NULL,
        correct_answer INT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_exam_question_key (exam_id, question_key),
        INDEX idx_exam_questions_exam_id (exam_id),
        INDEX idx_exam_questions_created_by (created_by),
        CONSTRAINT exam_questions_exam_fk
          FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
        CONSTRAINT exam_questions_created_by_fk
          FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS exam_attempts (
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT(10) UNSIGNED NOT NULL,
        exam_id INT(10) UNSIGNED NULL,
        major VARCHAR(50) NOT NULL,
        score DECIMAL(5,2) NOT NULL,
        correct_count INT NOT NULL,
        total_questions INT NOT NULL,
        passed TINYINT(1) DEFAULT 0,
        answers TEXT NULL,
        details TEXT NULL,
        submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_exam_attempts_user_id (user_id),
        INDEX idx_exam_attempts_exam_id (exam_id),
        INDEX idx_exam_attempts_major (major),
        CONSTRAINT exam_attempts_user_fk
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CONSTRAINT exam_attempts_exam_fk
          FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE SET NULL
      )
    `);

    const [columns] = await db.query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'exam_questions'`,
    );
    const existing = new Set(columns.map((column) => column.COLUMN_NAME));
    if (!existing.has("created_by")) {
      await db.query("ALTER TABLE exam_questions ADD COLUMN created_by INT(10) UNSIGNED NULL AFTER exam_id");
      await db.query("ALTER TABLE exam_questions ADD INDEX idx_exam_questions_created_by (created_by)");
    }
  } catch (err) {
    console.error("Could not verify exam tables:", err.message);
  }
}

const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

async function getActorRole(req) {
  const rawRole = String(req.headers["x-user-role"] || req.body?.actorRole || "").trim();
  const normalizedHeaderRole = rawRole === "client" ? "student" : rawRole.toLowerCase();
  const rawUserId = req.headers["x-user-id"] || req.body?.actorUserId || req.body?.actorId;
  const userId = Number(rawUserId);

  if (Number.isInteger(userId) && userId > 0) {
    const [rows] = await db.query("SELECT id, role FROM users WHERE id = ? LIMIT 1", [userId]);
    if (rows.length > 0) {
      const dbRole = String(rows[0].role || "").trim().toLowerCase();
      return {
        role: dbRole === "client" ? "student" : dbRole,
        userId: rows[0].id,
      };
    }
  }

  if (["admin", "teacher"].includes(normalizedHeaderRole)) {
    return { role: normalizedHeaderRole, userId: null };
  }

  return null;
}

async function requireExamQuestionManager(req, res) {
  const actor = await getActorRole(req);
  if (!actor || !["teacher", "admin"].includes(actor.role)) {
    res.status(403).json({ error: "Only teachers and admins can manage exam questions." });
    return null;
  }
  return actor;
}

function normalizeExamQuestionPayload(body) {
  const questionText = String(body?.questionText || body?.question || "").trim();
  const options = Array.isArray(body?.options)
    ? body.options.map((option) => String(option || "").trim()).filter(Boolean)
    : [];
  const correctAnswer = Number(body?.correctAnswer ?? body?.answer);
  const questionKey = String(body?.questionKey || body?.id || "").trim();
  const sortOrder = Number(body?.sortOrder);

  if (questionText.length < 5) {
    return { error: "Question text must be at least 5 characters." };
  }

  if (options.length < 2) {
    return { error: "Please provide at least two answer options." };
  }

  if (!Number.isInteger(correctAnswer) || correctAnswer < 0 || correctAnswer >= options.length) {
    return { error: "Correct answer must be a valid option index." };
  }

  return {
    questionKey,
    questionText,
    options,
    correctAnswer,
    sortOrder: Number.isInteger(sortOrder) && sortOrder > 0 ? sortOrder : null,
  };
}

async function ensureExamForMajor(major, { seedDefaults = false } = {}) {
  await ensureExamTables();

  if (!normalizeExamMajor(major)) {
    return null;
  }

  await db.query(
    `INSERT INTO exams (major, title, description, pass_score, accent_color, is_active)
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE is_active = 1`,
    [
      major,
      `${major} Certification Exam`,
      `${major} certification exam`,
      EXAM_PASS_SCORE,
      EXAM_BANK[major]?.accentColor || "#4f46e5",
    ],
  );

  const [[exam]] = await db.query("SELECT id FROM exams WHERE major = ? LIMIT 1", [major]);
  if (!exam) {
    return null;
  }

  if (seedDefaults && EXAM_BANK[major]?.questions?.length) {
    for (const [index, question] of EXAM_BANK[major].questions.entries()) {
      await db.query(
        `INSERT IGNORE INTO exam_questions
         (exam_id, created_by, question_key, question_text, options, correct_answer, sort_order, is_active)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 1)`,
        [
          exam.id,
          question.id || `${major.toLowerCase()}-${index + 1}`,
          question.question,
          JSON.stringify(question.options || []),
          Number(question.correctAnswer ?? question.answer),
          index + 1,
        ],
      );
    }
  }

  return exam;
}

async function getCompletedCertificateRows(userId) {
  const [rows] = await db.query(
    `SELECT
       l.id AS lesson_id,
       l.title,
       l.description,
       l.major,
       l.credit,
       l.color,
       c.name AS category,
       e.enrolled_at,
       MAX(vp.last_watched) AS completed_at,
       COUNT(v.id) AS total_videos,
       SUM(CASE WHEN COALESCE(vp.completed, 0) = 1 THEN 1 ELSE 0 END) AS completed_videos
     FROM enrollments e
     JOIN lessons l ON l.id = e.lesson_id
     LEFT JOIN categories c ON c.id = l.category_id
     JOIN videos v ON v.lesson_id = l.id
     LEFT JOIN video_progress vp ON vp.video_id = v.id AND vp.user_id = e.user_id
     WHERE e.user_id = ?
     GROUP BY l.id, l.title, l.description, l.major, l.credit, l.color, c.name, e.enrolled_at
     HAVING total_videos > 0 AND completed_videos >= total_videos
     ORDER BY completed_at DESC, e.enrolled_at DESC`,
    [userId],
  );

  return rows;
}

async function syncCompletedCertificates(userId) {
  const completedRows = await getCompletedCertificateRows(userId);

  for (const row of completedRows) {
    const credentialId = `EL-${userId}-${row.lesson_id}`;
    const skills = stringifyListField([row.major, row.category].filter(Boolean));
    const issuedAt = row.completed_at || row.enrolled_at || new Date();
    const hours = Number(row.credit || row.total_videos || 0);
    const values = [
      userId,
      row.lesson_id,
      row.title,
      "Elearning Academy",
      row.description || "",
      credentialId,
      skills,
      "Complete",
      hours,
      row.color || "#6366f1",
      issuedAt,
      1,
    ];

    const [existing] = await db.query(
      "SELECT id FROM certificates WHERE user_id = ? AND lesson_id = ? LIMIT 1",
      [userId, row.lesson_id],
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE certificates SET
           title = ?,
           issuer = ?,
           description = ?,
           credential_id = ?,
           skills = ?,
           grade = ?,
           hours = ?,
           accent_color = ?,
           issued_at = COALESCE(issued_at, ?),
           verified = ?
         WHERE id = ?`,
        [...values.slice(2), existing[0].id],
      );
    } else {
      await db.query(
        `INSERT INTO certificates
         (user_id, lesson_id, title, issuer, description, credential_id, skills, grade, hours, accent_color, issued_at, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values,
      );
    }
  }
}

function mapCertificateRow(row, req = null) {
  return {
    id: row.id,
    lessonId: row.lesson_id,
    userId: row.user_id,
    studentName: row.student_name || row.name || null,
    studentEmail: row.student_email || row.email || null,
    studentMajor: row.student_major || row.major || null,
    title: row.title,
    issuer: row.issuer || "Elearning Academy",
    issueDate: row.issued_at,
    expiryDate: row.expiry_date,
    credentialId: row.credential_id,
    skills: parseListField(row.skills),
    grade: row.grade || "Complete",
    hours: Number(row.hours || 0),
    verified: Boolean(row.verified),
    accentColor: row.accent_color || "#6366f1",
    image: assetUrl(req, row.image),
    description: row.description || "",
    type: row.certificate_type || "lesson",
    examMajor: row.exam_major || null,
    score: row.score === undefined || row.score === null ? null : Number(row.score),
  };
}

function normalizeExamMajor(value) {
  const major = String(value || "").trim();
  return ALLOWED_MAJORS.includes(major) ? major : "";
}

async function getExamDefinition(major) {
  try {
    await ensureExamTables();
    const [exams] = await db.query(
      `SELECT id, major, title, description, pass_score, accent_color
       FROM exams
       WHERE major = ? AND is_active = 1
       LIMIT 1`,
      [major],
    );

    if (exams.length > 0) {
      const [questions] = await db.query(
        `SELECT question_key, question_text, options, correct_answer
         FROM exam_questions
         WHERE exam_id = ? AND is_active = 1
         ORDER BY sort_order ASC, id ASC`,
        [exams[0].id],
      );

      return {
        id: exams[0].id,
        major,
        title: exams[0].title,
        description: exams[0].description || `${major} certification exam`,
        passScore: Number(exams[0].pass_score || EXAM_PASS_SCORE),
        accentColor: exams[0].accent_color || "#4f46e5",
        questions: questions.map((question) => ({
          id: question.question_key,
          question: question.question_text,
          options: parseJsonField(question.options, []),
          answer: Number(question.correct_answer),
        })),
      };
    }
  } catch (err) {
    console.error("Could not load exam from database:", err.message);
  }

  const fallback = EXAM_BANK[major];
  if (!fallback) return null;
  return {
    ...fallback,
    id: null,
    passScore: EXAM_PASS_SCORE,
  };
}

async function publicExam(major, { includeAnswers = false } = {}) {
  const exam = await getExamDefinition(major);
  if (!exam) return null;
  return {
    major,
    title: exam.title,
    description: exam.description,
    passScore: exam.passScore || EXAM_PASS_SCORE,
    totalQuestions: exam.questions.length,
    questions: exam.questions.map(({ id, question, options, answer }) => {
      const publicQuestion = {
        id,
        question,
        options,
      };
      if (includeAnswers) {
        publicQuestion.correctAnswer = answer;
      }
      return publicQuestion;
    }),
  };
}

async function awardExamCertificate(userId, major, score) {
  const exam = await getExamDefinition(major);
  if (!exam) return null;
  const credentialId = `EL-EXAM-${userId}-${major.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
  const skills = stringifyListField([major, "Comprehensive Exam", "Certificate"]);
  const [existing] = await db.query(
    `SELECT id FROM certificates
     WHERE user_id = ?
       AND certificate_type = 'exam'
       AND exam_major = ?
     LIMIT 1`,
    [userId, major],
  );

  if (existing.length > 0) {
    await db.query(
      `UPDATE certificates SET
         lesson_id = NULL,
         title = ?,
         issuer = ?,
         description = ?,
         credential_id = ?,
         skills = ?,
         grade = ?,
         hours = ?,
         accent_color = ?,
         certificate_type = 'exam',
         exam_major = ?,
         score = ?,
         verified = 1
       WHERE id = ?`,
      [
        exam.title,
        "Elearning Academy",
        exam.description,
        credentialId,
        skills,
        `${score}%`,
        0,
        exam.accentColor,
        major,
        score,
        existing[0].id,
      ],
    );
  } else {
    await db.query(
      `INSERT INTO certificates
       (user_id, lesson_id, title, issuer, description, credential_id, skills,
        grade, hours, accent_color, certificate_type, exam_major, score, verified)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'exam', ?, ?, 1)`,
      [
        userId,
        exam.title,
        "Elearning Academy",
        exam.description,
        credentialId,
        skills,
        `${score}%`,
        0,
        exam.accentColor,
        major,
        score,
      ],
    );
  }

  const [rows] = await db.query(
    `SELECT id, user_id, lesson_id, title, issuer, description,
            credential_id, skills, grade, hours, accent_color, image,
            certificate_type, exam_major, score, issued_at, expiry_date, verified
     FROM certificates
     WHERE credential_id = ?
     LIMIT 1`,
    [credentialId],
  );

  return rows[0] || null;
}

async function awardManualCertificate(userId, major, title) {
  const cleanMajor = normalizeExamMajor(major);
  if (!cleanMajor) {
    const err = new Error("A valid major is required.");
    err.status = 400;
    throw err;
  }

  const certificateTitle =
    String(title || "").trim() || `${cleanMajor} Achievement Certificate`;
  const credentialId = `EL-MANUAL-${userId}-${cleanMajor.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`;
  const skills = stringifyListField([cleanMajor, "Academic Achievement", "Admin Issued"]);
  const accentColor =
    cleanMajor === "Mathematics" ? "#7c3aed" : cleanMajor === "IT" ? "#0891b2" : "#2563eb";

  const [existing] = await db.query(
    `SELECT id FROM certificates
     WHERE user_id = ?
       AND certificate_type = 'manual'
       AND exam_major = ?
     LIMIT 1`,
    [userId, cleanMajor],
  );

  if (existing.length > 0) {
    await db.query(
      `UPDATE certificates SET
         lesson_id = NULL,
         title = ?,
         issuer = ?,
         description = ?,
         credential_id = ?,
         skills = ?,
         grade = ?,
         hours = ?,
         accent_color = ?,
         certificate_type = 'manual',
         exam_major = ?,
         verified = 1,
         issued_at = NOW()
       WHERE id = ?`,
      [
        certificateTitle,
        "Elearning Academy",
        `Admin-issued certificate for ${cleanMajor}.`,
        credentialId,
        skills,
        "Complete",
        0,
        accentColor,
        cleanMajor,
        existing[0].id,
      ],
    );
  } else {
    await db.query(
      `INSERT INTO certificates
       (user_id, lesson_id, title, issuer, description, credential_id, skills,
        grade, hours, accent_color, certificate_type, exam_major, verified)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 1)`,
      [
        userId,
        certificateTitle,
        "Elearning Academy",
        `Admin-issued certificate for ${cleanMajor}.`,
        credentialId,
        skills,
        "Complete",
        0,
        accentColor,
        cleanMajor,
      ],
    );
  }

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
     WHERE cert.credential_id = ?
     LIMIT 1`,
    [credentialId],
  );

  return rows[0] || null;
}

let projectColumnCache = null;

function normalizeProjectTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean).join(", ");
  }

  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(", ");
}

function toTinyInt(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue ? 1 : 0;
  }
  if (value === true || value === 1 || value === "1" || value === "true") {
    return 1;
  }
  return 0;
}

function mapProjectRow(project) {
  return {
    ...project,
    image: project.image || project.image_url || "",
    github_url: project.github_url || project.github || "",
    live_url: project.live_url || project.demo_url || "",
    tags: project.tags
      ? project.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [],
    featured: Boolean(project.featured),
    is_active:
      project.is_active === undefined ? true : Boolean(project.is_active),
  };
}

async function getProjectColumns() {
  if (projectColumnCache) return projectColumnCache;

  const [columns] = await db.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'projects'`,
  );

  projectColumnCache = new Set(columns.map((column) => column.COLUMN_NAME));
  return projectColumnCache;
}

async function ensureProjectColumns() {
  try {
    const [tables] = await db.query(
      `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'projects'`,
    );

    if (tables.length === 0) {
      await db.query(`
        CREATE TABLE projects (
          id INT AUTO_INCREMENT PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT NULL,
          image TEXT NULL,
          tags TEXT NULL,
          github_url VARCHAR(500) NULL,
          live_url VARCHAR(500) NULL,
          featured TINYINT(1) DEFAULT 0,
          is_active TINYINT(1) DEFAULT 1,
          view_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      projectColumnCache = null;
      console.log("Projects table is ready");
      return;
    }

    const columns = await getProjectColumns();
    const alters = [];
    if (!columns.has("description")) alters.push("ADD COLUMN description TEXT NULL");
    if (!columns.has("image")) alters.push("ADD COLUMN image TEXT NULL");
    if (!columns.has("tags")) alters.push("ADD COLUMN tags TEXT NULL");
    if (!columns.has("github_url")) alters.push("ADD COLUMN github_url VARCHAR(500) NULL");
    if (!columns.has("live_url")) alters.push("ADD COLUMN live_url VARCHAR(500) NULL");
    if (!columns.has("featured")) alters.push("ADD COLUMN featured TINYINT(1) DEFAULT 0");
    if (!columns.has("is_active")) alters.push("ADD COLUMN is_active TINYINT(1) DEFAULT 1");
    if (!columns.has("view_count")) alters.push("ADD COLUMN view_count INT DEFAULT 0");

    if (alters.length > 0) {
      await db.query(`ALTER TABLE projects ${alters.join(", ")}`);
      projectColumnCache = null;
      console.log("Project management columns are ready");
    }
  } catch (err) {
    console.error("Could not verify projects table:", err.message);
  }
}

function getProjectPayload(body, columns) {
  const image = body.image ?? body.image_url;
  const githubUrl = body.github_url ?? body.github;
  const liveUrl = body.live_url ?? body.demo_url;
  const values = {
    title: String(body.title || "").trim(),
    description: body.description ? String(body.description).trim() : null,
    image: image ? String(image).trim() : null,
    image_url: image ? String(image).trim() : null,
    tags: normalizeProjectTags(body.tags),
    github_url: githubUrl ? String(githubUrl).trim() : null,
    live_url: liveUrl ? String(liveUrl).trim() : null,
    demo_url: liveUrl ? String(liveUrl).trim() : null,
    featured: toTinyInt(body.featured),
    is_active: toTinyInt(body.is_active, true),
  };

  return Object.fromEntries(
    Object.entries(values).filter(([key]) => columns.has(key)),
  );
}

// ===================================================================
// CONFIGURATION & INITIALIZATION
// ===================================================================

const anthropicApiKey = process.env.ANTHROPIC_API_KEY?.trim();
const groqApiKey =
  process.env.GROQ_API_KEY?.trim() ||
  (anthropicApiKey?.startsWith("gsk_") ? anthropicApiKey : "");
const aiProvider = groqApiKey
  ? "groq"
  : anthropicApiKey
    ? "anthropic"
    : null;

if (!aiProvider) {
  console.error("AI chat is missing an API key");
  console.error("Please add GROQ_API_KEY or ANTHROPIC_API_KEY to .env");
}

const anthropic =
  aiProvider === "anthropic"
    ? new Anthropic({
        apiKey: anthropicApiKey,
      })
    : null;

// ===================================================================
// AI CHAT ENDPOINT
// ===================================================================
app.post("/api/chat", async (req, res) => {
  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Messages array is required" });
  }

  if (!aiProvider) {
    return res.status(500).json({
      error: "AI service is not configured. Please add an AI API key.",
      details: "Missing API key configuration",
    });
  }

  try {
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    let reply;

    if (aiProvider === "groq") {
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
            max_tokens: req.body.max_tokens || 1024,
            temperature: 0.7,
            messages: [
              {
                role: "system",
                content:
                  system ||
                  "You are a helpful AI learning assistant for an e-learning platform.",
              },
              ...formattedMessages,
            ],
          }),
        },
      );

      const groqData = await groqResponse.json();
      if (!groqResponse.ok) {
        const message =
          groqData.error?.message || `Groq API error: ${groqResponse.status}`;
        const err = new Error(message);
        err.status = groqResponse.status;
        throw err;
      }

      reply = groqData.choices?.[0]?.message?.content;
    } else {
      const response = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307",
        max_tokens: req.body.max_tokens || 1024,
        system:
          system ||
          "You are a helpful AI learning assistant for an e-learning platform.",
        messages: formattedMessages,
      });

      reply = response.content?.[0]?.text;
    }

    if (!reply) {
      throw new Error("AI provider returned an empty response");
    }

    res.json({
      success: true,
      response: reply,
      content: [{ type: "text", text: reply }],
    });
  } catch (error) {
    console.error("AI API error:", error.message);

    let errorMessage = "Failed to get AI response";
    let statusCode = 500;

    if (error.status === 401) {
      errorMessage = `Invalid ${aiProvider === "groq" ? "Groq" : "Anthropic"} API key. Please check your .env file.`;
      statusCode = 401;
    } else if (error.status === 429) {
      errorMessage = "Rate limit exceeded. Please try again later.";
      statusCode = 429;
    } else if (error.status >= 500) {
      errorMessage = "AI service error. Please try again later.";
      statusCode = 500;
    } else if (error.message?.includes("API key")) {
      errorMessage =
        "API key not configured. Please add GROQ_API_KEY or ANTHROPIC_API_KEY to .env";
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
    await syncCompletedCertificates(req.params.id);

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
app.get("/api/videos", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, lesson_id, title, link, thumbnail, duration_minutes, view_count, description, is_free, order_index FROM videos ORDER BY lesson_id, order_index, id",
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
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`📡 API URL: http://localhost:${PORT}/api`);
  console.log(`📖 API Documentation: http://localhost:${PORT}/api/health`);
  ensureTeacherRoleValue();
  ensureStudentYearColumns();
  ensureUserProfileColumns();
  ensureAvatarUploadDir();
  ensureCertificatesTable();
  ensureExamTables();
  ensureProjectColumns();

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



