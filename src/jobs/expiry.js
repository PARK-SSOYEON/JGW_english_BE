const { pool } = require('../db');

// 서버 시간대와 상관없이 한국 날짜(YYYY-MM-DD)를 구함
function kstDateStr() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 자주 돌려도 같은 일정에 경고가 두 번 들어가지 않도록 일정마다 경고 처리 시각을 남김.
// 컬럼이 처음 생길 때 이미 만료돼 있던 일정은 예전 방식으로 처리된 것으로 보고 건너뜀.
async function ensureWarnedAtColumn() {
    const [cols] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schedules' AND COLUMN_NAME = 'warned_at'`
    );
    if (cols.length) return;
    await pool.query(`ALTER TABLE schedules ADD COLUMN warned_at DATETIME DEFAULT NULL COMMENT '만료 경고 처리 시각'`);
    await pool.query(`UPDATE schedules SET warned_at = NOW() WHERE status = 'expired'`);
    console.log('✅ schedules.warned_at 컬럼 추가');
}

let running = false;

async function runExpiry() {
    if (running) return;
    running = true;
    const todayStr = kstDateStr();
    const conn = await pool.getConnection();
    try {
        await conn.query("SET time_zone = '+09:00'");
        await conn.beginTransaction();
        
        // 1. 마감일(deadline_date)이 지난 미완료 일정 만료 처리
        const [result] = await conn.query(
            `UPDATE schedules
             SET status = 'expired'
             WHERE status IN ('pending', 'in_progress')
               AND deadline_date < ?`,
            [todayStr]
        );
        
        // 2. 만료됐는데 아직 경고가 안 들어간 자습 일정 → 학생별로 경고 1회
        //    (서버가 꺼져 있던 날의 일정도 다음 실행 때 빠짐없이 처리됨)
        const [targets] = await conn.query(
            `SELECT sc.id AS schedule_id, s.id AS student_id, s.name
             FROM schedules sc
                      JOIN students s ON sc.student_id = s.id
             WHERE sc.status = 'expired'
               AND sc.type = 'study'
               AND sc.warned_at IS NULL
             FOR UPDATE`
        );
        
        const byStudent = new Map();
        for (const t of targets) {
            if (!byStudent.has(t.student_id)) byStudent.set(t.student_id, { name: t.name, scheduleIds: [] });
            byStudent.get(t.student_id).scheduleIds.push(t.schedule_id);
        }
        
        for (const [studentId, { name, scheduleIds }] of byStudent) {
            await conn.query(`UPDATE schedules SET warned_at = NOW() WHERE id IN (?)`, [scheduleIds]);
            await conn.query(`UPDATE students SET warn_count = warn_count + 1 WHERE id = ?`, [studentId]);
            const [[{ warn_count }]] = await conn.query(`SELECT warn_count FROM students WHERE id = ?`, [studentId]);
            
            const message = warn_count >= 2
                ? `${name} - 경고 ${warn_count}회. 퇴원 조치 대상입니다.`
                : `${name} - 자습 미이행으로 경고 ${warn_count}회 처리되었습니다.`;
            await conn.query(
                `INSERT INTO notifications (type, student_id, message) VALUES ('expired', ?, ?)`,
                [studentId, message]
            );
        }
        
        await conn.commit();
        if (result.affectedRows || byStudent.size) {
            console.log(`✅ 만료 처리 (${todayStr}) - 만료 ${result.affectedRows}건, 경고 ${byStudent.size}명`);
        }
    } catch (e) {
        await conn.rollback().catch(() => {});
        console.error('만료 처리 오류:', e);
    } finally {
        conn.release();
        running = false;
    }
}

// 다음 한국 시각 00:05까지 남은 시간(ms). 서버 시간대와 상관없이 계산함
function msUntilNextRun() {
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const next = new Date(kst);
    next.setUTCHours(0, 5, 0, 0);
    if (kst >= next) next.setUTCDate(next.getUTCDate() + 1);
    return next - kst;
}

function scheduleDaily() {
    setTimeout(async () => {
        await runExpiry();
        scheduleDaily();
    }, msUntilNextRun());
}

// 서버 시작 직후 한 번(재시작으로 놓친 날 보충), 이후 매일 한국 시각 00:05
async function startExpiryJob() {
    try {
        await ensureWarnedAtColumn();
    } catch (e) {
        console.error('warned_at 컬럼 준비 오류:', e);
        return;
    }
    await runExpiry();
    scheduleDaily();
    console.log('⏰ 만료 처리: 서버 시작 시 + 매일 00:05 (KST)');
}

module.exports = { startExpiryJob, runExpiry };
