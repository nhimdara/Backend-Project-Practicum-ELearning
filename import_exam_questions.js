const fs = require("fs");
const path = require("path");
const db = require("./db");

const DEFAULT_ACCENT_COLORS = {
  ITE: "#2563eb",
  IT: "#0891b2",
  Mathematics: "#7c3aed",
};

async function ensureExamTables() {
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
      CONSTRAINT exam_questions_exam_fk
        FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE
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
}

async function importExamQuestions(filePath) {
  const absolutePath = path.resolve(filePath || path.join(__dirname, "examQuestions.json"));
  const payload = JSON.parse(fs.readFileSync(absolutePath, "utf8"));

  await ensureExamTables();

  for (const [major, exam] of Object.entries(payload)) {
    const title = exam.title || `${major} Certification Exam`;
    const description = exam.description || `${major} certification exam`;
    const passScore = Number(exam.passScore || 70);
    const accentColor = exam.accentColor || DEFAULT_ACCENT_COLORS[major] || "#4f46e5";

    await db.query(
      `INSERT INTO exams (major, title, description, pass_score, accent_color, is_active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         description = VALUES(description),
         pass_score = VALUES(pass_score),
         accent_color = VALUES(accent_color),
         is_active = 1`,
      [major, title, description, passScore, accentColor],
    );

    const [[row]] = await db.query("SELECT id FROM exams WHERE major = ? LIMIT 1", [major]);
    const examId = row.id;

    await db.query("UPDATE exam_questions SET is_active = 0 WHERE exam_id = ?", [examId]);

    for (const [index, question] of (exam.questions || []).entries()) {
      await db.query(
        `INSERT INTO exam_questions
         (exam_id, question_key, question_text, options, correct_answer, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE
           question_text = VALUES(question_text),
           options = VALUES(options),
           correct_answer = VALUES(correct_answer),
           sort_order = VALUES(sort_order),
           is_active = 1`,
        [
          examId,
          question.id || `${major.toLowerCase()}-${index + 1}`,
          question.question,
          JSON.stringify(question.options || []),
          Number(question.correctAnswer ?? question.answer),
          index + 1,
        ],
      );
    }

    console.log(`Imported ${exam.questions?.length || 0} questions for ${major}`);
  }
}

importExamQuestions(process.argv[2])
  .then(async () => {
    await db.end();
    console.log("Exam question import complete.");
  })
  .catch(async (err) => {
    console.error(err.message);
    await db.end().catch(() => {});
    process.exit(1);
  });
