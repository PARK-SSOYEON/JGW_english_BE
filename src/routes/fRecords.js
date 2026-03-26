// ── F 기록 ──────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { pool } = require('../db');
const { authMiddleware, superOnly } = require('../middleware/auth');

// GET /api/f-records?student_id=1
router.get('/', authMiddleware, async (req, res) => {
  const { student_id } = req.query;
  let sql = `
    SELECT f.*, s.name AS student_name
    FROM f_records f JOIN students s ON f.student_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (student_id) { sql += ' AND f.student_id = ?'; params.push(student_id); }
  sql += ' ORDER BY f.class_date DESC';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

// POST /api/f-records
router.post('/', authMiddleware, async (req, res) => {
  const { student_id, type, class_date, note } = req.body;
  if (!student_id || !type || !class_date)
    return res.status(400).json({ error: '필수 항목 누락' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO f_records (student_id, type, class_date, note) VALUES (?, ?, ?, ?)',
      [student_id, type, class_date, note || null]
    );

    // 해당 학생의 미처리 F 개수 확인 후 자습 부여 (같은 class_date 기준)
    const [fCount] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM f_records
       WHERE student_id = ? AND class_date = ?`,
      [student_id, class_date]
    );
    const cnt = fCount[0].cnt;
    let requiredMinutes = 0;
    if (cnt === 1) requiredMinutes = 180;
    else if (cnt >= 2) requiredMinutes = 420;

    if (requiredMinutes > 0) {
      // 기존 자습 일정 업데이트 또는 신규 생성
      const [existing] = await conn.query(
        `SELECT id FROM schedules
         WHERE student_id = ? AND type = 'study' AND deadline_date IS NULL AND is_completed = FALSE
         AND DATE(created_at) >= ?`,
        [student_id, class_date]
      );
      if (existing.length) {
        await conn.query(
          'UPDATE schedules SET required_minutes = ? WHERE id = ?',
          [requiredMinutes, existing[0].id]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ id: result.insertId, message: 'F 기록 완료' });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

// DELETE /api/f-records/:id  (슈퍼 관리자 전용)
router.delete('/:id', authMiddleware, superOnly, async (req, res) => {
  await pool.query('DELETE FROM f_records WHERE id = ?', [req.params.id]);
  res.json({ message: '삭제 완료' });
});

module.exports = router;
