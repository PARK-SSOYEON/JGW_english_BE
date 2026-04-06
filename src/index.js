require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
      ? process.env.FRONTEND_URL || 'https://your-app.vercel.app'
      : '*',
  credentials: true,
}));
app.use(express.json());

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/students',    require('./routes/students'));
app.use('/api/classes',     require('./routes/classes'));
app.use('/api/schedules',   require('./routes/schedules'));
app.use('/api/study-logs',  require('./routes/studyLogs'));
app.use('/api/f-records',   require('./routes/fRecords'));
app.use('/api/attendance',  require('./routes/attendance'));
app.use('/api/admins',      require('./routes/admins'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/seasons', require('./routes/seasons'));


app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`);
});

function scheduleExpiry() {
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const todayStr = now.toISOString().slice(0, 10)
    
    const next7am = new Date(now)
    next7am.setHours(7, 0, 0, 0)
    if (now >= next7am) next7am.setDate(next7am.getDate() + 1)
    const msUntil7am = next7am - now
    
    setTimeout(async () => {
        try {
            // 1. 만료 처리
            const [result] = await pool.query(
                `UPDATE schedules
                 SET status = 'expired'
                 WHERE status IN ('pending', 'in_progress')
                   AND deadline_date < ?`,
                [todayStr]
            )
            
            // 2. 방금 만료된 스케줄의 학생들 경고 처리
            const [expiredStudents] = await pool.query(
                `SELECT DISTINCT s.id, s.name, s.is_warned, s.warn_count
         FROM schedules sc
         JOIN students s ON sc.student_id = s.id
         WHERE sc.status = 'expired'
           AND sc.deadline_date = DATE_SUB(?, INTERVAL 1 DAY)`,
                [todayStr]
            )
            
            for (const student of expiredStudents) {
                // warn_count 증가 + is_warned 갱신
                await pool.query(
                    `UPDATE students
           SET warn_count = warn_count + 1,
               is_warned = TRUE
           WHERE id = ?`,
                    [student.id]
                )
                
                const newWarnCount = student.warn_count + 1
                
                if (newWarnCount >= 2) {
                    // 2회 이상 → 퇴원 대상 알림
                    await pool.query(
                        `INSERT INTO notifications (type, student_id, message)
             SELECT 'expired', ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM notifications
               WHERE student_id = ? AND message LIKE '%퇴원%'
                 AND DATE(created_at) = ?
             )`,
                        [
                            student.id,
                            `${student.name} - 경고 ${newWarnCount}회. 퇴원 조치 대상입니다.`,
                            student.id,
                            todayStr
                        ]
                    )
                } else {
                    // 1회 → 경고 알림
                    await pool.query(
                        `INSERT INTO notifications (type, student_id, message)
             SELECT 'expired', ?, ?
             WHERE NOT EXISTS (
               SELECT 1 FROM notifications
               WHERE student_id = ? AND message LIKE '%경고%'
                 AND DATE(created_at) = ?
             )`,
                        [
                            student.id,
                            `${student.name} - 자습/재시험 미이행으로 경고 ${newWarnCount}회 처리되었습니다.`,
                            student.id,
                            todayStr
                        ]
                    )
                }
            }
            
            console.log(`✅ 만료 처리 완료 (${todayStr}) - ${result.affectedRows}건, 경고 ${expiredStudents.length}명`)
        } catch (e) {
            console.error('만료 처리 오류:', e)
        }
        scheduleExpiry()
    }, msUntil7am)
    
    const next7amKST = new Date(next7am.getTime() + 9 * 60 * 60 * 1000)
    console.log(`⏰ 다음 만료 처리: ${next7amKST.toISOString().replace('T', ' ').slice(0, 16)} KST`)
}

scheduleExpiry();


// ── 알림 생성 로직 ──────────────────────────────────────────
async function generateNotifications() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayStr = now.toISOString().slice(0, 10);
  const nowTimeStr = now.toISOString().slice(11, 16).replace('T', ''); // HH:mm
  
  try {
    // 1. 예정일 지났는데 미완료인 스케줄 알림
    const [expired] = await pool.query(
        `SELECT sc.*, s.name AS student_name
       FROM schedules sc
       JOIN students s ON sc.student_id = s.id
       WHERE sc.status IN ('pending', 'in_progress')
         AND sc.scheduled_date < ?
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.schedule_id = sc.id AND n.type = 'expired'
         )`,
        [todayStr]
    );
    
    for (const sc of expired) {
      const typeLabel = sc.type === 'study' ? '자습' : '재시험';
      await pool.query(
          `INSERT INTO notifications (type, student_id, schedule_id, message)
         VALUES ('expired', ?, ?, ?)`,
          [
            sc.student_id,
            sc.id,
            `${sc.student_name} - ${typeLabel} 날짜(${sc.deadline_date?.slice(0, 10)})가 지났습니다.`
          ]
      );
    }
    
    // 2. 도착 예정시간 10분 지났는데 등원 기록 없는 경우
    const [noShow] = await pool.query(
        `SELECT sc.*, s.name AS student_name
       FROM schedules sc
       JOIN students s ON sc.student_id = s.id
       WHERE sc.scheduled_date = ?
         AND sc.scheduled_time IS NOT NULL
         AND sc.status IN ('pending', 'in_progress')
         AND ADDTIME(sc.scheduled_time, '00:10:00') < ?
         AND NOT EXISTS (
           SELECT 1 FROM attendance_logs al
           WHERE al.student_id = sc.student_id
             AND al.log_date = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.schedule_id = sc.id AND n.type = 'no_show'
             AND DATE(n.created_at) = ?
         )`,
        [todayStr, nowTimeStr, todayStr, todayStr]
    );
    
    for (const sc of noShow) {
      const typeLabel = sc.type === 'study' ? '자습' : '재시험';
      await pool.query(
          `INSERT INTO notifications (type, student_id, schedule_id, message)
         VALUES ('no_show', ?, ?, ?)`,
          [
            sc.student_id,
            sc.id,
            `${sc.student_name} - ${typeLabel} 예정시간(${sc.scheduled_time?.slice(0, 5)})이 지났는데 등원하지 않았습니다.`
          ]
      );
    }
    
    if (expired.length + noShow.length > 0) {
      console.log(`🔔 알림 생성: 만료 ${expired.length}건, 미등원 ${noShow.length}건`);
    }
  } catch (e) {
    console.error('알림 생성 오류:', e);
  }
}

// 5분마다 알림 체크
setInterval(generateNotifications, 5 * 60 * 1000);
generateNotifications(); // 서버 시작 시 즉시 실행
