const db = require("../db");
const bcrypt = require("bcrypt");

async function ensureBootstrapAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || "");
  if (!email || password.length < 12) {
    console.warn("ADMIN_EMAIL/ADMIN_PASSWORD not configured; database admin bootstrap skipped.");
    return;
  }
  const [users] = await db.query("SELECT id, role FROM users WHERE email = ?", [email]);
  const passwordHash = await bcrypt.hash(password, 10);
  if (users.length) {
    await db.query("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?", [passwordHash, users[0].id]);
    return;
  }
  await db.query("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", ["Administrator", email, passwordHash]);
}

module.exports = { ensureBootstrapAdmin };
