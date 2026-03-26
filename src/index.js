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
      const [result] = await pool.query(
          `UPDATE schedules
         SET status = 'expired',
             is_completed = 0
         WHERE status IN ('pending', 'in_progress')
           AND deadline_date < ?`,
          [todayStr]
      )
      console.log(`✅ 만료 처리 완료 (${todayStr}) - ${result.affectedRows}건`)
    } catch (e) {
      console.error('만료 처리 오류:', e)
    }
    scheduleExpiry()
  }, msUntil7am)

  const next7amKST = new Date(next7am.getTime() + 9 * 60 * 60 * 1000)
  console.log(`⏰ 다음 만료 처리: ${next7amKST.toISOString().replace('T', ' ').slice(0, 16)} KST`)
}

scheduleExpiry();
