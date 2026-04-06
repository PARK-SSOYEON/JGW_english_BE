const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/students
router.get('/', authMiddleware, async (req, res) => {
  const { school, grade, class_id, warned, season_id } = req.query;
  let sql = `
    SELECT s.*, GROUP_CONCAT(c.name SEPARATOR ', ') AS class_names
    FROM students s
    LEFT JOIN student_classes sc ON s.id = sc.student_id
    LEFT JOIN classes c ON sc.class_id = c.id
    WHERE s.is_active = TRUE
  `;
  const params = [];
  if (school)    { sql += ' AND s.school = ?';      params.push(school); }
  if (grade)     { sql += ' AND s.grade = ?';       params.push(grade); }
  if (class_id)  { sql += ' AND sc.class_id = ?';   params.push(class_id); }
  if (warned === 'true') { sql += ' AND s.warn_count > 0'; }
  if (season_id) { sql += ' AND sc.season_id = ?';  params.push(season_id); }
  sql += ' GROUP BY s.id ORDER BY s.school, s.grade, s.name';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/students/search
router.get('/search', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: '이름을 입력해주세요.' });
  
  const [students] = await pool.query(
      `SELECT s.*, GROUP_CONCAT(c.name SEPARATOR ', ') AS class_names,
            GROUP_CONCAT(c.day_of_week SEPARATOR ',') AS class_days
     FROM students s
     LEFT JOIN student_classes sc ON s.id = sc.student_id
     LEFT JOIN classes c ON sc.class_id = c.id
     WHERE s.name LIKE ? AND s.is_active = TRUE
     GROUP BY s.id`,
      [`%${name}%`]
  );
  
  if (!students.length) return res.json([]);
  
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = today.toISOString().slice(0, 10);
  const todayDow = today.getDay();
  
  const result = await Promise.all(students.map(async (s) => {
    const classDays = s.class_days ? s.class_days.split(',').map(Number) : [];
    const hasClassToday = classDays.includes(todayDow);
    
    const [studySchedules] = await pool.query(
        `SELECT s2.*, COALESCE(s2.done_minutes, 0) AS done_minutes
       FROM schedules s2
       WHERE s2.student_id = ? AND s2.type = 'study'
         AND s2.status IN ('pending', 'in_progress')
       ORDER BY s2.deadline_date`,
        [s.id]
    );
    
    const [retestSchedules] = await pool.query(
        `SELECT * FROM schedules
       WHERE student_id = ? AND type = 'retest'
         AND status IN ('pending', 'in_progress')`,
        [s.id]
    );
    
    const [activeLog] = await pool.query(
        `SELECT * FROM study_logs
       WHERE student_id = ? AND DATE(start_time) = ? AND end_time IS NULL
       ORDER BY start_time DESC LIMIT 1`,
        [s.id, todayStr]
    );
    
    return {
      ...s,
      hasClassToday,
      studySchedules,
      retestSchedules,
      activeStudyLog: activeLog[0] || null,
    };
  }));
  
  res.json(result);
});

// POST /api/students
router.post('/', authMiddleware, async (req, res) => {
  const { name, school, grade, class_ids, season_id } = req.body;
  if (!name || !school || !grade) return res.status(400).json({ error: '필수 항목 누락' });
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
        'INSERT INTO students (name, school, grade) VALUES (?, ?, ?)',
        [name, school, grade]
    );
    const studentId = result.insertId;
    if (class_ids?.length) {
      for (const cid of class_ids) {
        await conn.query(
            'INSERT INTO student_classes (student_id, class_id, season_id) VALUES (?, ?, ?)',
            [studentId, cid, season_id || null]
        );
      }
    }
    await conn.commit();
    res.status(201).json({ id: studentId, message: '학생 등록 완료' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// PATCH /api/students/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  const { name, school, grade, warn_count, class_ids, season_id } = req.body;
  const fields = [];
  const params = [];
  if (name !== undefined)       { fields.push('name = ?');       params.push(name); }
  if (school !== undefined)     { fields.push('school = ?');     params.push(school); }
  if (grade !== undefined)      { fields.push('grade = ?');      params.push(grade); }
  if (warn_count !== undefined) { fields.push('warn_count = ?'); params.push(warn_count); }
  
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (fields.length) {
      params.push(req.params.id);
      await conn.query(`UPDATE students SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    if (class_ids !== undefined) {
      await conn.query('DELETE FROM student_classes WHERE student_id = ?', [req.params.id]);
      for (const cid of class_ids) {
        await conn.query(
            'INSERT INTO student_classes (student_id, class_id, season_id) VALUES (?, ?, ?)',
            [req.params.id, cid, season_id || null]
        );
      }
    }
    await conn.commit();
    res.json({ message: '수정 완료' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/students/:id (슈퍼)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('UPDATE students SET is_active = FALSE WHERE id = ?', [req.params.id]);
  res.json({ message: '퇴원 처리 완료' });
});

module.exports = router;
