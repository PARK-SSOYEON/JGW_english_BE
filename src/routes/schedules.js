const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

function calcMinutes(f_homework, f_retest) {
  const count = (f_homework ? 1 : 0) + (f_retest ? 1 : 0);
  if (count === 1) return 180;
  if (count >= 2)  return 420;
  return null;
}

function calcDeadline(dayOfWeek, scheduledDate) {
  const base = new Date(scheduledDate + 'T00:00:00+09:00');
  let daysUntilNext = (dayOfWeek - base.getDay() + 7) % 7;
  if (daysUntilNext === 0) daysUntilNext = 7;
  const nextClassDate = new Date(base);
  nextClassDate.setDate(base.getDate() + daysUntilNext);
  const deadline = new Date(nextClassDate);
  deadline.setDate(nextClassDate.getDate() - 1);
  if (dayOfWeek === 2 && deadline.getDay() === 1) {
    deadline.setDate(deadline.getDate() - 1);
  }
  return deadline.toISOString().slice(0, 10);
}

// GET /api/schedules
router.get('/', authMiddleware, async (req, res) => {
  const { date, student_id, type, status } = req.query;
  let sql = `
    SELECT sc.*,
           s.name AS student_name, s.school, s.grade,
           GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS class_names
    FROM schedules sc
           JOIN students s ON sc.student_id = s.id
           LEFT JOIN student_classes stc ON s.id = stc.student_id
           LEFT JOIN classes c ON stc.class_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (date)       { sql += ' AND sc.scheduled_date = ?'; params.push(date); }
  if (student_id) { sql += ' AND sc.student_id = ?';     params.push(student_id); }
  if (type)       { sql += ' AND sc.type = ?';           params.push(type); }
  if (status)     { sql += ' AND sc.status = ?';         params.push(status); }
  sql += ' GROUP BY sc.id ORDER BY sc.deadline_date, s.school, s.grade, s.name';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// GET /api/schedules/week
router.get('/week', authMiddleware, async (req, res) => {
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'start 날짜가 필요합니다.' });
  const [rows] = await pool.query(
      `SELECT sc.*, s.name AS student_name, s.school, s.grade,
            GROUP_CONCAT(DISTINCT c.name SEPARATOR ', ') AS class_names
     FROM schedules sc
     JOIN students s ON sc.student_id = s.id
     LEFT JOIN student_classes stc ON s.id = stc.student_id
     LEFT JOIN classes c ON stc.class_id = c.id
     WHERE sc.scheduled_date BETWEEN ? AND DATE_ADD(?, INTERVAL 6 DAY)
     GROUP BY sc.id
     ORDER BY sc.scheduled_date, sc.scheduled_time, sc.type, s.name`,
      [start, start]
  );
  res.json(rows);
});

// POST /api/schedules
router.post('/', authMiddleware, async (req, res) => {
  // ← scheduled_time 추가
  const { student_id, type, scheduled_date, scheduled_time, f_homework, f_retest, deadline_date, note } = req.body;
  if (!student_id || !type || !scheduled_date)
    return res.status(400).json({ error: '필수 항목 누락' });
  
  const required_minutes = type === 'study' ? calcMinutes(f_homework, f_retest) : null;
  
  let finalDeadline = deadline_date || null;
  if (!finalDeadline) {
    const [classRows] = await pool.query(
        `SELECT c.day_of_week FROM classes c
       JOIN student_classes sc ON sc.class_id = c.id
       WHERE sc.student_id = ? LIMIT 1`,
        [student_id]
    );
    if (classRows.length) {
      finalDeadline = calcDeadline(classRows[0].day_of_week, scheduled_date);
    }
  }
  
  const [result] = await pool.query(
      `INSERT INTO schedules
       (student_id, type, scheduled_date, scheduled_time, f_homework, f_retest,
        required_minutes, done_minutes, deadline_date, status, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)`,
      [student_id, type, scheduled_date, scheduled_time || null,
        f_homework ? 1 : 0, f_retest ? 1 : 0,
        required_minutes, finalDeadline, note || null]
  );
  res.status(201).json({ id: result.insertId, message: '일정 등록 완료', required_minutes, deadline_date: finalDeadline });
});

// PATCH /api/schedules/:id
router.patch('/:id', authMiddleware, async (req, res) => {
  // ← scheduled_time 추가
  const { scheduled_date, scheduled_time, f_homework, f_retest, deadline_date, is_completed, status, note } = req.body;
  const fields = [];
  const params = [];
  
  if (scheduled_date !== undefined) { fields.push('scheduled_date = ?'); params.push(scheduled_date); }
  if (scheduled_time !== undefined) { fields.push('scheduled_time = ?'); params.push(scheduled_time || null); }
  if (deadline_date  !== undefined) { fields.push('deadline_date = ?');  params.push(deadline_date); }
  if (note           !== undefined) { fields.push('note = ?');           params.push(note); }
  
  if (f_homework !== undefined || f_retest !== undefined) {
    const [cur] = await pool.query(
        'SELECT f_homework, f_retest FROM schedules WHERE id = ?', [req.params.id]
    );
    if (cur.length) {
      const newFH = f_homework !== undefined ? f_homework : !!cur[0].f_homework;
      const newFR = f_retest   !== undefined ? f_retest   : !!cur[0].f_retest;
      fields.push('f_homework = ?');       params.push(newFH ? 1 : 0);
      fields.push('f_retest = ?');         params.push(newFR ? 1 : 0);
      fields.push('required_minutes = ?'); params.push(calcMinutes(newFH, newFR));
    }
  }
  
  if (status !== undefined) {
    fields.push('status = ?'); params.push(status);
    if (status === 'completed') {
      fields.push('is_completed = 1');
      fields.push('completed_at = NOW()');
    } else {
      fields.push('is_completed = 0');
      fields.push('completed_at = NULL');
    }
  } else if (is_completed !== undefined) {
    fields.push('is_completed = ?'); params.push(is_completed ? 1 : 0);
    fields.push('status = ?');       params.push(is_completed ? 'completed' : 'pending');
    if (is_completed) fields.push('completed_at = NOW()');
    else              fields.push('completed_at = NULL');
  }
  
  if (!fields.length) return res.status(400).json({ error: '수정할 항목 없음' });
  params.push(req.params.id);
  await pool.query(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`, params);
  res.json({ message: '수정 완료' });
});

// DELETE /api/schedules/:id
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('DELETE FROM schedules WHERE id = ?', [req.params.id]);
  res.json({ message: '일정 삭제 완료' });
});

module.exports = router;
