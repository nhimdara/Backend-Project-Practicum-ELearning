const db = require("../db");

async function ensureNotificationsTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    href VARCHAR(255),
    source_key VARCHAR(255) NOT NULL UNIQUE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query("CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)");
}

async function syncUserNotifications(userId) {
  await ensureNotificationsTable();
  await db.query(`INSERT INTO notifications (user_id, type, title, message, href, source_key, created_at)
    SELECT e.user_id, 'lesson', 'Lesson enrolled', 'You enrolled in ' || l.title, '/lessons',
           'enrollment:' || e.id, e.enrolled_at
    FROM enrollments e JOIN lessons l ON l.id = e.lesson_id WHERE e.user_id = ?
    ON CONFLICT (source_key) DO NOTHING`, [userId]);
  await db.query(`INSERT INTO notifications (user_id, type, title, message, href, source_key, created_at)
    SELECT c.user_id, 'achievement', 'Certificate earned', c.title || ' is ready to view.', '/profile',
           'certificate:' || c.id, c.issued_at
    FROM certificates c WHERE c.user_id = ?
    ON CONFLICT (source_key) DO NOTHING`, [userId]);
  await db.query(`INSERT INTO notifications (user_id, type, title, message, href, source_key, created_at)
    SELECT u.id, 'project', CASE WHEN COALESCE(p.featured, FALSE) THEN 'Featured project' ELSE 'Project available' END,
           p.title, '/projects', 'project:' || p.id || ':user:' || u.id, COALESCE(p.updated_at, p.created_at, CURRENT_TIMESTAMP)
    FROM users u CROSS JOIN projects p
    WHERE u.id = ? AND COALESCE(p.is_active, TRUE) = TRUE
      AND (p.major IS NULL OR u.major IS NULL OR LOWER(p.major) = LOWER(u.major))
    ON CONFLICT (source_key) DO NOTHING`, [userId]).catch(() => {});
}

module.exports = { ensureNotificationsTable, syncUserNotifications };
