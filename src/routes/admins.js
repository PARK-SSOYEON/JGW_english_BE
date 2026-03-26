const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/admins
router.get('/', authMiddleware, superOnly, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, role, is_active, created_at FROM admins ORDER BY created_at'
  );
  res.json(rows);
});

// POST /api/admins
router.post('/', authMiddleware, superOnly, async (req, res) => {
  const { name, code, role } = req.body;
  if (!name || !code) return res.status(400).json({ error: '필수 항목 누락' });
  const [result] = await pool.query(
    'INSERT INTO admins (name, code, role) VALUES (?, ?, ?)',
    [name, code, role || 'admin']
  );
  res.status(201).json({ id: result.insertId });
});

// PATCH /api/admins/:id
router.patch('/:id', authMiddleware, superOnly, async (req, res) => {
  const { name, code, role, is_active } = req.body;
  const fields = [];
  const params = [];
  if (name !== undefined)      { fields.push('name = ?');      params.push(name); }
  if (code !== undefined)      { fields.push('code = ?');      params.push(code); }
  if (role !== undefined)      { fields.push('role = ?');      params.push(role); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active); }
  if (!fields.length) return res.status(400).json({ error: '수정할 항목 없음' });
  params.push(req.params.id);
  await pool.query(`UPDATE admins SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ message: '수정 완료' });
});

// DELETE /api/admins/:id
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('UPDATE admins SET is_active = FALSE WHERE id = ?', [req.params.id]);
  res.json({ message: '비활성화 완료' });
});

module.exports = router;
