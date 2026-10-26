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
    const { date, season_id } = req.query
    
    let whereClause = 'WHERE 1=1'
    const params = []
    
    if (date) {
        whereClause += ' AND DATE(sl.start_time) = ?'
        params.push(date)
    } else if (season_id) {
        const [seasons] = await pool.query('SELECT start_date, end_date FROM seasons WHERE id = ?', [season_id])
        if (seasons.length) {
            const { start_date, end_date } = seasons[0]
            whereClause += ' AND DATE(sl.start_time) BETWEEN ? AND ?'
            params.push(start_date, end_date)
        }
    }
    
    const [rows] = await pool.query(`
    SELECT sl.*,
           s.name   AS student_name,
           s.school AS student_school,
           s.grade  AS student_grade,
           sc.required_minutes,
           sc.done_minutes
    FROM study_logs sl
    JOIN students s ON sl.student_id = s.id
    LEFT JOIN schedules sc ON sl.schedule_id = sc.id
    ${whereClause}
    ORDER BY sl.start_time DESC
  `, params)
    
    res.json(rows)
})

// POST /api/study-logs/start
router.post('/start', authMiddleware, async (req, res) => {
    const { student_id, schedule_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'student_id 필요' });
    
    const todayStr = kstDateStr();
    
    const [active] = await pool.query(
        `SELECT id FROM study_logs
     WHERE student_id = ? AND DATE(start_time) = ? AND end_time IS NULL`,
        [student_id, todayStr]
    );
    if (active.length) return res.status(409).json({ error: '이미 자습이 진행 중입니다.' });
    
    const nowKST = kstDateTimeStr();
    const [result] = await pool.query(
        `INSERT INTO study_logs (student_id, schedule_id, log_date, start_time)
     VALUES (?, ?, ?, ?)`,
        [student_id, schedule_id || null, todayStr, nowKST]
    );
    
    if (schedule_id) {
        await pool.query(
            `UPDATE schedules SET status = 'in_progress' WHERE id = ? AND status = 'pending'`,
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
        `SELECT sl.*, sc.required_minutes, sc.done_minutes, sc.status AS schedule_status
     FROM study_logs sl
     LEFT JOIN schedules sc ON sl.schedule_id = sc.id
     WHERE sl.id = ?`,
        [req.params.id]
    );
    if (!logs.length) return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
    const log = logs[0];
    if (log.end_time) return res.status(409).json({ error: '이미 종료된 자습입니다.' });
    
    const nowKST = kstDateTimeStr();
    const startStr = log.start_time.replace(' ', 'T');
    const endStr   = nowKST.replace(' ', 'T');
    const actualMinutes = Math.max(Math.floor((new Date(endStr) - new Date(startStr)) / 60000), 0);
    const [[remainRow]] = await pool.query(
        `SELECT GREATEST(sc.required_minutes - sc.done_minutes - ?, 0) AS remain_minutes
     FROM schedules sc
     JOIN study_logs sl ON sc.id = sl.schedule_id
     WHERE sl.id = ?`,
        [actualMinutes, req.params.id]
    );
    
    const remainMinutes = remainRow?.remain_minutes ?? 0;
    
    await pool.query(
        `UPDATE study_logs SET end_time = ?, actual_minutes = ?, remain_minutes = ? WHERE id = ?`,
        [nowKST, actualMinutes, remainMinutes, req.params.id]
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
           completed_at = IF(?, ?, NULL)
       WHERE id = ?`,
            [
                newDone,
                scheduleCompleted ? 'completed' : 'in_progress',
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

// PATCH /api/study-logs/:id  시작·종료 시간 수정
// body: { start_time?, end_time? }  형식 'YYYY-MM-DD HH:mm:ss'
// 끝난 자습이면 자습 시간이 바뀐 만큼 일정의 완료 시간·남은 시간·완료 여부를 다시 계산
router.patch('/:id', authMiddleware, async (req, res) => {
    const { start_time, end_time } = req.body;
    const DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
    if (start_time !== undefined && !DT.test(start_time)) return res.status(400).json({ error: '시작 시간 형식이 올바르지 않습니다.' });
    if (end_time !== undefined && end_time !== null && !DT.test(end_time)) return res.status(400).json({ error: '종료 시간 형식이 올바르지 않습니다.' });
    
    const [logs] = await pool.query(
        `SELECT sl.*, sc.required_minutes, sc.done_minutes, sc.status AS schedule_status
         FROM study_logs sl
                  LEFT JOIN schedules sc ON sl.schedule_id = sc.id
         WHERE sl.id = ?`,
        [req.params.id]
    );
    if (!logs.length) return res.status(404).json({ error: '로그를 찾을 수 없습니다.' });
    const log = logs[0];
    
    const newStart = start_time ?? log.start_time;
    const newEnd   = end_time !== undefined ? end_time : log.end_time;
    const toDate = (s) => new Date(s.replace(' ', 'T'));
    
    if (toDate(newStart) > toDate(kstDateTimeStr())) return res.status(400).json({ error: '시작 시간이 지금보다 늦을 수 없습니다.' });
    if (newEnd && toDate(newEnd) <= toDate(newStart)) return res.status(400).json({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    if (!newEnd && log.end_time) return res.status(400).json({ error: '끝난 자습의 종료 시간은 지울 수 없습니다.' });
    
    // 진행 중인 자습: 시작 시간만 바꿈 (종료 버튼을 누를 때 계산됨)
    if (!newEnd) {
        await pool.query(`UPDATE study_logs SET start_time = ? WHERE id = ?`, [newStart, req.params.id]);
        return res.json({ message: '자습 시간 수정 완료' });
    }
    
    const newActual = Math.max(Math.floor((toDate(newEnd) - toDate(newStart)) / 60000), 0);
    const oldActual = Number(log.actual_minutes) || 0;   // 진행 중이던 자습이면 0
    const delta = newActual - oldActual;
    
    let remainMinutes = null;
    let scheduleCompleted = false;
    if (log.schedule_id && log.required_minutes != null) {
        const oldDone = Number(log.done_minutes) || 0;
        const newDone = Math.max(oldDone + delta, 0);
        // 시간을 다 안 채웠는데 완료였다면 관리자가 직접 완료 처리한 것 → 완료 유지
        const manuallyCompleted = log.schedule_status === 'completed' && oldDone < log.required_minutes;
        scheduleCompleted = manuallyCompleted || newDone >= log.required_minutes;
        remainMinutes = scheduleCompleted ? 0 : Math.max(log.required_minutes - newDone, 0);
        
        // 만료된 일정은 다 채우지 못했으면 만료 상태 그대로 둠
        const newStatus = scheduleCompleted
            ? 'completed'
            : (log.schedule_status === 'expired' ? 'expired' : 'in_progress');
        await pool.query(
            `UPDATE schedules
             SET done_minutes = ?,
                 status = ?,
                 completed_at = CASE WHEN ? THEN COALESCE(completed_at, ?) ELSE NULL END
             WHERE id = ?`,
            [newDone, newStatus, scheduleCompleted ? 1 : 0, kstDateTimeStr(), log.schedule_id]
        );
    }
    
    await pool.query(
        `UPDATE study_logs SET start_time = ?, end_time = ?, actual_minutes = ?, remain_minutes = ? WHERE id = ?`,
        [newStart, newEnd, newActual, remainMinutes, req.params.id]
    );
    
    res.json({
        message: '자습 시간 수정 완료',
        actual_minutes: newActual,
        remain_minutes: remainMinutes,
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
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
    const [logs] = await pool.query(
        'SELECT schedule_id, actual_minutes FROM study_logs WHERE id = ?',
        [req.params.id]
    );
    await pool.query('DELETE FROM study_logs WHERE id = ?', [req.params.id]);
    
    if (logs.length && logs[0].schedule_id && logs[0].actual_minutes) {
        const { schedule_id, actual_minutes } = logs[0];
        await pool.query(
            `UPDATE schedules SET done_minutes = GREATEST(done_minutes - ?, 0) WHERE id = ?`,
            [actual_minutes, schedule_id]
        );
        await pool.query(
            `UPDATE schedules SET status = 'in_progress', completed_at = NULL
       WHERE id = ? AND status = 'completed'`,
            [schedule_id]
        );
    }
    
    res.json({ message: '자습 로그 삭제 완료' });
});

module.exports = router;
