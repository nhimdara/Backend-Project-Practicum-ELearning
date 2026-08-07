const db = require("../db");

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
      `SELECT data_type AS "Type"
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'users'
         AND column_name = 'role'`,
    );
    if (columns.length === 0) throw new Error("users.role column does not exist");
    console.log("✅ Teacher role is ready");
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

module.exports = { ensureStudentYearColumns, ensureTeacherRoleValue, ensureUserProfileColumns };
