require('dotenv').config();
const { initDB } = require('./index');

initDB()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
