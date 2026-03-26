const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/students?school=유신고&grade=1&class_id=1
router.get('/', authMiddleware, async (req, res) => {
  const { school, grade, class_id, warned } = req.query;
  let sql = `
    SELECT s.*, GROUP_CONCAT(c.name SEPARATOR ', ') AS class_names
    FROM students s
    LEFT JOIN student_classes sc ON s.id = sc.student_id
    LEFT JOIN classes c ON sc.class_id = c.id
    WHERE s.is_active = TRUE
  `;
  const params = [];
  if (school) { sql += ' AND s.school = ?'; params.push(school); }
  if (grade)  { sql += ' AND s.grade = ?';  params.push(grade); }
  if (class_id) { sql += ' AND sc.class_id = ?'; params.push(class_id); }
  if (warned === 'true') { sql += ' AND s.is_warned = TRUE'; }
  sql += ' GROUP BY s.id ORDER BY s.school, s.grade, s.name';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/students/search?name=홍길동  — 학생 이름 검색 + 오늘 상태 요약
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

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const todayDow = today.getDay(); // 0=일 ~ 6=토

  const result = await Promise.all(students.map(async (s) => {
    // 오늘 수업 여부 확인
    const classDays = s.class_days ? s.class_days.split(',').map(Number) : [];
    const hasClassToday = classDays.includes(todayDow);
    
    // 미완료 자습 일정 (pending, in_progress만 - expired 제외)
    const [studySchedules] = await pool.query(
        `SELECT s2.*,
                COALESCE(SUM(sl.actual_minutes), 0) AS done_minutes
         FROM schedules s2
                LEFT JOIN study_logs sl ON sl.schedule_id = s2.id AND sl.actual_minutes IS NOT NULL
         WHERE s2.student_id = ?
           AND s2.type = 'study'
           AND s2.status IN ('pending', 'in_progress')
         GROUP BY s2.id`,
        [s.id]
    );

    // 미완료 재시험 일정
    const [retestSchedules] = await pool.query(
      `SELECT * FROM schedules
       WHERE student_id = ? AND type = 'retest' AND is_completed = FALSE`,
      [s.id]
    );

    // 오늘 진행 중인 자습 로그
    const [activeLog] = await pool.query(
      `SELECT * FROM study_logs
       WHERE student_id = ? AND log_date = ? AND end_time IS NULL
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
  const { name, school, grade, class_ids } = req.body;
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
          'INSERT INTO student_classes (student_id, class_id) VALUES (?, ?)',
          [studentId, cid]
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
  const { name, school, grade, is_warned, class_ids } = req.body;
  const fields = [];
  const params = [];
  if (name !== undefined)      { fields.push('name = ?');      params.push(name); }
  if (school !== undefined)    { fields.push('school = ?');    params.push(school); }
  if (grade !== undefined)     { fields.push('grade = ?');     params.push(grade); }
  if (is_warned !== undefined) { fields.push('is_warned = ?'); params.push(is_warned); }

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
          'INSERT INTO student_classes (student_id, class_id) VALUES (?, ?)',
          [req.params.id, cid]
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

// DELETE /api/students/:id  (슈퍼 관리자 전용)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('UPDATE students SET is_active = FALSE WHERE id = ?', [req.params.id]);
  res.json({ message: '학생 퇴원 처리 완료' });
});

module.exports = router;
