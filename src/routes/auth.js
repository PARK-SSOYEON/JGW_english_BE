const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: '코드를 입력해주세요.' });

  const [rows] = await pool.query(
    'SELECT * FROM admins WHERE code = ? AND is_active = TRUE',
    [code]
  );
  if (!rows.length) return res.status(401).json({ error: '코드가 올바르지 않습니다.' });

  const admin = rows[0];
  const token = jwt.sign(
    { id: admin.id, name: admin.name, role: admin.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, name: admin.name, role: admin.role });
});

module.exports = router;
