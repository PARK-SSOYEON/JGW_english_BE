const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'academy',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: '+09:00',
  dateStrings: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+09:00'");
});

setInterval(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    console.error('DB ping 오류:', e.message);
  }
}, 5 * 60 * 1000);

async function initDB() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: '+09:00',
  });
  await conn.query("SET time_zone = '+09:00'");
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);
  await conn.end();
  console.log('✅ DB 초기화 완료');
}

module.exports = { pool, initDB };
