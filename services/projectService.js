const db = require("../db");

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

module.exports = { normalizeProjectTags, toTinyInt, mapProjectRow, getProjectColumns, ensureProjectColumns, getProjectPayload };
