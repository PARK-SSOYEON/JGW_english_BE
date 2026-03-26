const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

function kstDateStr() {
  return new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\. /g, '-').replace(/\.$/, '').trim();
}

// GET /api/attendance?date=2024-11-01
router.get('/', authMiddleware, async (req, res) => {
  const { date, student_id } = req.query;
  let sql = `
    SELECT a.*, s.name AS student_name, s.school, s.grade
    FROM attendance_logs a
    JOIN students s ON a.student_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (date)       { sql += ' AND a.log_date = ?';   params.push(date); }
  if (student_id) { sql += ' AND a.student_id = ?'; params.push(student_id); }
  sql += ' ORDER BY a.created_at ASC';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// POST /api/attendance — 수동 등원 기록
router.post('/', authMiddleware, async (req, res) => {
  const { student_id, purpose, note } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id 필요' });
  const todayStr = kstDateStr();
  const [result] = await pool.query(
      'INSERT INTO attendance_logs (student_id, log_date, purpose, note) VALUES (?, ?, ?, ?)',
      [student_id, todayStr, purpose || 'general', note || null]
  );
  res.status(201).json({ id: result.insertId, message: '등원 기록 완료' });
});

// POST /api/attendance/checkout — 하원 기록
router.post('/checkout', authMiddleware, async (req, res) => {
  const { student_id, note } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id 필요' });
  const todayStr = kstDateStr();
  const [result] = await pool.query(
      `INSERT INTO attendance_logs (student_id, log_date, purpose, note) VALUES (?, ?, 'general', ?)`,
      [student_id, todayStr, note || '하원']
  );
  res.status(201).json({ id: result.insertId, message: '하원 기록 완료' });
});

// DELETE /api/attendance/:id (슈퍼 관리자)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('DELETE FROM attendance_logs WHERE id = ?', [req.params.id]);
  res.json({ message: '삭제 완료' });
});

module.exports = router;
