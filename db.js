const mysql = require('mysql2/promise');
require('dotenv').config();

// Pool koneksi: aman untuk banyak request sekaligus & transaksi (getConnection)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'db_ud_ulfa',
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: true // kolom DECIMAL dikembalikan sebagai angka, bukan string
});

// Cek koneksi saat server start
pool.query('SELECT 1')
    .then(() => console.log('Berhasil terhubung ke database MySQL UD. ULFA.'))
    .catch((err) => console.error('Koneksi ke database gagal:', err.message));

module.exports = pool;
