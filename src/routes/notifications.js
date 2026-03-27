const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/notifications
router.get('/', authMiddleware, async (req, res) => {
    const [rows] = await pool.query(
        `SELECT n.*, s.name AS student_name, s.school, s.grade
     FROM notifications n
     JOIN students s ON n.student_id = s.id
     ORDER BY n.created_at DESC`,
    );
    res.json(rows);
});

// DELETE /api/notifications/:id
router.delete('/:id', authMiddleware, async (req, res) => {
    await pool.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
    res.json({ message: '삭제 완료' });
});

// DELETE /api/notifications (전체 삭제)
router.delete('/', authMiddleware, async (req, res) => {
    await pool.query('DELETE FROM notifications');
    res.json({ message: '전체 삭제 완료' });
});

module.exports = router;
