const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications (읽지 않은 것만)
router.get('/', authMiddleware, async (req, res) => {
    const [rows] = await pool.query(
        `SELECT n.*, s.name AS student_name, s.school, s.grade
     FROM notifications n
     JOIN students s ON n.student_id = s.id
     WHERE n.is_read = FALSE
     ORDER BY n.created_at DESC`
    );
    res.json(rows);
});

// PATCH /api/notifications/:id — 읽음 처리 (화면에서 지우기)
router.patch('/:id/read', authMiddleware, async (req, res) => {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [req.params.id]);
    res.json({ message: '읽음 처리 완료' });
});

// PATCH /api/notifications/read-all — 전체 읽음 처리
router.patch('/read-all', authMiddleware, async (req, res) => {
    await pool.query('UPDATE notifications SET is_read = TRUE');
    res.json({ message: '전체 읽음 처리 완료' });
});

module.exports = router;
