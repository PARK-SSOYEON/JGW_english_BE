const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/classes?school=유신고&grade=1
router.get('/', async (req, res) => {
  const { school, grade } = req.query;
  let sql = 'SELECT * FROM classes WHERE 1=1';
  const params = [];
  if (school) { sql += ' AND school = ?'; params.push(school); }
  if (grade)  { sql += ' AND grade = ?';  params.push(grade); }
  sql += ' ORDER BY school, grade, day_of_week';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/classes/:id/students
router.get('/:id/students', authMiddleware, async (req, res) => {
  const [classRows] = await pool.query('SELECT * FROM classes WHERE id = ?', [req.params.id]);
  if (!classRows.length) return res.status(404).json({ error: '반을 찾을 수 없습니다.' });
  
  const [rows] = await pool.query(
      `SELECT s.*,
              GROUP_CONCAT(DISTINCT c2.name SEPARATOR ', ') AS class_names,
              -- 미완료 자습 (pending/in_progress)
              SUM(CASE WHEN sc.type = 'study' AND sc.status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pending_study_count,
              -- 미완료 재시험
              SUM(CASE WHEN sc.type = 'retest' AND sc.status IN ('pending','in_progress') THEN 1 ELSE 0 END) AS pending_retest_count,
              -- 남은 자습 시간 합계
              SUM(CASE WHEN sc.type = 'study' AND sc.status IN ('pending','in_progress')
                         THEN (sc.required_minutes - sc.done_minutes) ELSE 0 END) AS remaining_minutes
       FROM students s
              JOIN student_classes stc ON s.id = stc.student_id AND stc.class_id = ?
              LEFT JOIN student_classes stc2 ON s.id = stc2.student_id
              LEFT JOIN classes c2 ON stc2.class_id = c2.id
              LEFT JOIN schedules sc ON sc.student_id = s.id AND sc.status IN ('pending','in_progress')
       WHERE s.is_active = TRUE
       GROUP BY s.id
       ORDER BY s.name`,
      [req.params.id]
  );
  res.json(rows);
});

// POST /api/classes (슈퍼 관리자)
router.post('/', authMiddleware, superOnly, async (req, res) => {
  const { name, school, grade, day_of_week } = req.body;
  if (!name || !school || !grade || day_of_week === undefined)
    return res.status(400).json({ error: '필수 항목 누락' });
  const [result] = await pool.query(
    'INSERT INTO classes (name, school, grade, day_of_week) VALUES (?, ?, ?, ?)',
    [name, school, grade, day_of_week]
  );
  res.status(201).json({ id: result.insertId });
});

// DELETE /api/classes/:id (슈퍼 관리자)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('DELETE FROM classes WHERE id = ?', [req.params.id]);
  res.json({ message: '삭제 완료' });
});

module.exports = router;
