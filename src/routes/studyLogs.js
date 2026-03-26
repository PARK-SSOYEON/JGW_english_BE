const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

function kstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
function kstDateStr() {
  return kstNow().toISOString().slice(0, 10);
}
function kstDateTimeStr() {
  return kstNow().toISOString().slice(0, 19).replace('T', ' ');
}

// GET /api/study-logs
router.get('/', authMiddleware, async (req, res) => {
  const { date, student_id } = req.query;
  let sql = `
    SELECT sl.*, s.name AS student_name, s.school, s.grade,
           sc.required_minutes, sc.done_minutes, sc.deadline_date
    FROM study_logs sl
    JOIN students s ON sl.student_id = s.id
    LEFT JOIN schedules sc ON sl.schedule_id = sc.id
    WHERE 1=1
  `;
  const params = [];
  if (date)       { sql += ' AND DATE(CONVERT_TZ(sl.start_time, \'+00:00\', \'+09:00\')) = ?'; params.push(date); }
  if (student_id) { sql += ' AND sl.student_id = ?'; params.push(student_id); }
  sql += ' ORDER BY sl.start_time DESC';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// POST /api/study-logs/start
router.post('/start', authMiddleware, async (req, res) => {
  const { student_id, schedule_id } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id 필요' });
  
  const todayStr = kstDateStr();
  
  const [active] = await pool.query(
      `SELECT id FROM study_logs
     WHERE student_id = ?
       AND DATE(CONVERT_TZ(start_time, '+00:00', '+09:00')) = ?
       AND end_time IS NULL`,
      [student_id, todayStr]
  );
  if (active.length) return res.status(409).json({ error: '이미 자습이 진행 중입니다.' });
  
  const nowKST = kstDateTimeStr();
  const [result] = await pool.query(
      `INSERT INTO study_logs (student_id, schedule_id, log_date, start_time)
     VALUES (?, ?, ?, ?)`,
      [student_id, schedule_id || null, todayStr, nowKST]
  );
  
  // 스케줄 상태 in_progress로
  if (schedule_id) {
    await pool.query(
        `UPDATE schedules SET status = 'in_progress'
       WHERE id = ? AND status = 'pending'`,
        [schedule_id]
    );
  }
  
  await pool.query(
      `INSERT INTO attendance_logs (student_id, log_date, purpose) VALUES (?, ?, 'study')`,
      [student_id, todayStr]
  );
  
  res.status(201).json({ id: result.insertId, message: '자습 시작 기록 완료' });
});

// POST /api/study-logs/:id/end
router.post('/:id/end', authMiddleware, async (req, res) => {
    const [logs] = await pool.query(
        `SELECT sl.*, sc.required_minutes, sc.done_minutes, sc.status
         FROM study_logs sl
                  LEFT JOIN schedules sc ON sl.schedule_id = sc.id
         WHERE sl.id = ?`,
        [req.params.id]
    );
    if (!logs.length) return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
    const log = logs[0];
    if (log.end_time) return res.status(409).json({ error: '이미 종료된 자습입니다.' });
    
    const nowKST = kstDateTimeStr(); // "2026-03-26 14:30:00"
    
    // start_time도 KST 문자열로 왔으므로 동일하게 파싱
    // "2026-03-26 14:30:00" → T 붙여서 로컬 시간 해석 방지
    const startStr = log.start_time.replace(' ', 'T'); // "2026-03-26T14:30:00"
    const endStr   = nowKST.replace(' ', 'T');          // "2026-03-26T16:00:00"
    
    const startMs = new Date(startStr).getTime();
    const endMs   = new Date(endStr).getTime();
    const actualMinutes = Math.max(Math.floor((endMs - startMs) / 60000), 0);
    
    await pool.query(
        `UPDATE study_logs SET end_time = ?, actual_minutes = ? WHERE id = ?`,
        [nowKST, actualMinutes, req.params.id]
    );
    
    const todayStr = kstDateStr();
    await pool.query(
        `INSERT INTO attendance_logs (student_id, log_date, purpose, note)
     VALUES (?, ?, 'study', '하원')`,
        [log.student_id, todayStr]
    );
    
    let scheduleCompleted = false;
    if (log.schedule_id && log.required_minutes != null) {
        const newDone = (Number(log.done_minutes) || 0) + actualMinutes;
        scheduleCompleted = newDone >= log.required_minutes;
        
        await pool.query(
            `UPDATE schedules
       SET done_minutes = ?,
           status = ?,
           is_completed = ?,
           completed_at = IF(?, ?, NULL)
       WHERE id = ?`,
            [
                newDone,
                scheduleCompleted ? 'completed' : 'in_progress',
                scheduleCompleted ? 1 : 0,
                scheduleCompleted ? 1 : 0,
                nowKST,
                log.schedule_id
            ]
        );
    }
    
    res.json({
        message: '자습 종료 기록 완료',
        actual_minutes: actualMinutes,
        schedule_completed: scheduleCompleted,
    });
});

// POST /api/study-logs/checkout
router.post('/checkout', authMiddleware, async (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id 필요' });
  const todayStr = kstDateStr();
  await pool.query(
      `INSERT INTO attendance_logs (student_id, log_date, purpose, note)
     VALUES (?, ?, 'general', '하원')`,
      [student_id, todayStr]
  );
  res.json({ message: '하원 기록 완료' });
});

// DELETE /api/study-logs/:id (슈퍼 관리자)
// 삭제 시 done_minutes에서 차감
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  const [logs] = await pool.query(
      'SELECT schedule_id, actual_minutes FROM study_logs WHERE id = ?',
      [req.params.id]
  );
  await pool.query('DELETE FROM study_logs WHERE id = ?', [req.params.id]);
  
  if (logs.length && logs[0].schedule_id && logs[0].actual_minutes) {
    const { schedule_id, actual_minutes } = logs[0];
    // done_minutes 차감 (0 미만 방지)
    await pool.query(
        `UPDATE schedules
       SET done_minutes = GREATEST(done_minutes - ?, 0)
       WHERE id = ?`,
        [actual_minutes, schedule_id]
    );
    // 완료 상태였으면 다시 in_progress로
    await pool.query(
        `UPDATE schedules
       SET status = 'in_progress',
           is_completed = 0,
           completed_at = NULL
       WHERE id = ? AND status = 'completed'`,
        [schedule_id]
    );
  }
  
  res.json({ message: '자습 로그 삭제 완료' });
});

module.exports = router;
