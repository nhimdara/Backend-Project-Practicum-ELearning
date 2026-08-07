const db = require("../db");

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

module.exports = { dedupeVideos, removeDuplicateVideoSlots };
