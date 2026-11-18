// Membuat (atau mengatur ulang password) akun admin.
// Cara pakai: node buat-admin.js <username> <password> [email] [nama...]
const auth = require('./auth');
const db = require('./db');

(async () => {
    const [username, password, email, ...namaBagian] = process.argv.slice(2);
    if (!username || !password) {
        console.log('Cara pakai: node buat-admin.js <username> <password> [email] [nama...]');
        process.exit(1);
    }
    if (password.length < 8) {
        console.log('Password minimal 8 karakter.');
        process.exit(1);
    }
    try {
        await auth.siapkanTabel();
        const hash = await auth.hashPassword(password);
        await db.query(
            'INSERT INTO users (username, email, nama, password_hash, role) VALUES (?, ?, ?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), email = COALESCE(VALUES(email), email)',
            [username, email || null, namaBagian.join(' ') || 'Admin', hash, 'admin']
        );
        console.log('Akun siap dipakai. Username: ' + username + (email ? ' | Email: ' + email : ''));
        process.exit(0);
    } catch (err) {
        console.error('GAGAL membuat akun:', err.message);
        process.exit(1);
    }
})();
