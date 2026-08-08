const db = require("../db");
const { syncUserNotifications } = require("../services/notificationService");

module.exports = function registerNotificationRoutes(app) {
  app.get("/api/users/:id/notifications", async (req, res) => {
    try {
      await syncUserNotifications(req.params.id);
      const [rows] = await db.query(`SELECT id, type, title, message, href, is_read AS read, created_at
        FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [req.params.id]);
      res.json(rows);
    } catch (error) {
      console.error("Load notifications error:", error.message);
      res.status(500).json({ error: "Could not load notifications." });
    }
  });

  app.patch("/api/users/:id/notifications/:notificationId/read", async (req, res) => {
    const [result] = await db.query("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", [req.params.notificationId, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Notification not found." });
    res.json({ success: true });
  });

  app.post("/api/users/:id/notifications/read-all", async (req, res) => {
    await db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", [req.params.id]);
    res.json({ success: true });
  });

  app.delete("/api/users/:id/notifications/read", async (req, res) => {
    await db.query("DELETE FROM notifications WHERE user_id = ? AND is_read = TRUE", [req.params.id]);
    res.json({ success: true });
  });

  app.delete("/api/users/:id/notifications/:notificationId", async (req, res) => {
    await db.query("DELETE FROM notifications WHERE id = ? AND user_id = ?", [req.params.notificationId, req.params.id]);
    res.json({ success: true });
  });
};
