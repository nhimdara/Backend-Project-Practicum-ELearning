const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const fs = require("fs");
const path = require("path");
const db = require("./db");
require("dotenv").config();
const { ALLOWED_MAJORS, EMAIL_DOMAIN, EXAM_PASS_SCORE, EXAM_BANK } = require("./config/constants");
const { clampAcademicYear, getCurrentAcademicYear, getStudentEmailNameParts, buildStudentEmail, buildStaffEmail } = require("./utils/userHelpers");
const { dedupeVideos, removeDuplicateVideoSlots } = require("./utils/videoHelpers");
const { ensureStudentYearColumns, ensureTeacherRoleValue, ensureUserProfileColumns } = require("./services/schemaService");
const { normalizeProjectTags, toTinyInt, mapProjectRow, getProjectColumns, ensureProjectColumns, getProjectPayload } = require("./services/projectService");
const { anthropicApiKey, groqApiKey, aiProvider, anthropic } = require("./services/aiService");

// Fix: Correct Anthropic import

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

module.exports = {
  app,
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
};
