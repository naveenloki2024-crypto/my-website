require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: Number(process.env.DB_PORT) || 3306
    });
    const [o] = await c.query('SELECT * FROM `Order`');
    console.log('order:', JSON.stringify(o, null, 2));
    const [i] = await c.query('SELECT * FROM `OrderItem`');
    console.log('items:', JSON.stringify(i, null, 2));
    await c.end();
})().catch(e => { console.error('DB ERROR:', e.code, e.message); process.exit(1); });