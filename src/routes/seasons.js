const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/seasons
router.get('/', async (req, res) => {
    const [rows] = await pool.query(
        'SELECT * FROM seasons ORDER BY start_date DESC'
    );
    res.json(rows);
});

// GET /api/seasons/active
router.get('/active', async (req, res) => {
    const [rows] = await pool.query(
        'SELECT * FROM seasons WHERE is_active = TRUE LIMIT 1'
    );
    res.json(rows[0] || null);
});

// POST /api/seasons (슈퍼)
router.post('/', authMiddleware, superOnly, async (req, res) => {
    const { name, start_date, end_date } = req.body;
    if (!name || !start_date || !end_date)
        return res.status(400).json({ error: '필수 항목 누락' });
    const [result] = await pool.query(
        'INSERT INTO seasons (name, start_date, end_date) VALUES (?, ?, ?)',
        [name, start_date, end_date]
    );
    res.status(201).json({ id: result.insertId });
});

// PATCH /api/seasons/:id/activate (슈퍼) - 시즌 활성화
router.patch('/:id/activate', authMiddleware, superOnly, async (req, res) => {
    await pool.query('UPDATE seasons SET is_active = FALSE');
    await pool.query('UPDATE seasons SET is_active = TRUE WHERE id = ?', [req.params.id]);
    res.json({ message: '시즌 활성화 완료' });
});

// DELETE /api/seasons/:id (슈퍼)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
    await pool.query('DELETE FROM seasons WHERE id = ?', [req.params.id]);
    res.json({ message: '삭제 완료' });
});

module.exports = router;
