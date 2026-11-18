// Autentikasi UD. ULFA: login, lupa password (OTP 6 angka lewat email), reset password.
// Login memakai modul bawaan Node (crypto). Pengiriman email memakai paket nodemailer.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);

const MASA_LOGIN_DETIK = 8 * 60 * 60;   // login berlaku 8 jam
const MASA_RESET_MENIT = 10;            // kode OTP berlaku 10 menit
const MAKS_OTP_SALAH = 5;               // salah memasukkan OTP, lalu kode hangus
const JEDA_KIRIM_OTP_MS = 60 * 1000;    // minimal 60 detik antar permintaan OTP per akun
const MAKS_GAGAL = 5;                   // gagal login berturut-turut
const JENDELA_GAGAL_MS = 15 * 60 * 1000;

let rahasia = process.env.JWT_SECRET;
if (!rahasia || rahasia.length < 16) {
    rahasia = crypto.randomBytes(32).toString('hex');
    console.warn('PERINGATAN: JWT_SECRET belum diisi di .env. Memakai kunci acak sementara (semua login hilang saat server restart).');
}

const httpError = (status, message) => Object.assign(new Error(message), { status });
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const hashOtp = (id, otp) => hashToken(id + ':' + otp);
const samaAman = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- Tabel ----------
async function siapkanTabel() {
    await db.query(
        'CREATE TABLE IF NOT EXISTS users (' +
        'id INT AUTO_INCREMENT PRIMARY KEY, ' +
        'username VARCHAR(50) NOT NULL UNIQUE, ' +
        'email VARCHAR(150) NULL UNIQUE, ' +
        "nama VARCHAR(100) NOT NULL DEFAULT 'Admin', " +
        'password_hash VARCHAR(255) NOT NULL, ' +
        "role VARCHAR(20) NOT NULL DEFAULT 'admin', " +
        'reset_token_hash CHAR(64) NULL, ' +
        'reset_expires DATETIME NULL, ' +
        'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP' +
        ') ENGINE=InnoDB'
    );
    // kolom penghitung OTP salah (ditambahkan jika belum ada; aman untuk MySQL maupun MariaDB)
    const [ada] = await db.query(
        "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'reset_percobaan'"
    );
    if (!ada[0] || !ada[0].n) {
        await db.query('ALTER TABLE users ADD COLUMN reset_percobaan INT NOT NULL DEFAULT 0');
    }
}

// ---------- Pengiriman email (Gmail lewat nodemailer) ----------
async function kirimEmail(tujuan, subjek, isi) {
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!user || !pass) throw new Error('SMTP_USER / SMTP_PASS belum diisi di .env');
    let nodemailer;
    try { nodemailer = require('nodemailer'); }
    catch (e) { throw new Error('paket nodemailer belum terpasang (jalankan: npm install nodemailer)'); }
    const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass: String(pass).replace(/\s+/g, '') } });
    await transport.sendMail({
        from: process.env.SMTP_FROM || '"E-Kasir UD. ULFA" <' + user + '>',
        to: tujuan, subject: subjek, text: isi
    });
}

// ---------- Password (scrypt) ----------
async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const kunci = await scrypt(password, salt, 64);
    return 'scrypt$' + salt.toString('hex') + '$' + kunci.toString('hex');
}
async function cekPassword(password, tersimpan) {
    const bagian = String(tersimpan || '').split('$');
    if (bagian.length !== 3 || bagian[0] !== 'scrypt') return false;
    const salt = Buffer.from(bagian[1], 'hex');
    const asli = Buffer.from(bagian[2], 'hex');
    const kunci = await scrypt(password, salt, asli.length);
    return crypto.timingSafeEqual(kunci, asli);
}
function cekKekuatan(password) {
    if (password.length < 8) throw httpError(400, 'Password minimal 8 karakter');
    if (password.length > 128) throw httpError(400, 'Password maksimal 128 karakter');
}

// ---------- Token login (JWT HS256) ----------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

function buatToken(user) {
    const sekarang = Math.floor(Date.now() / 1000);
    const kepala = b64({ alg: 'HS256', typ: 'JWT' });
    const isi = b64({ sub: user.id, username: user.username, role: user.role, iat: sekarang, exp: sekarang + MASA_LOGIN_DETIK });
    const tanda = crypto.createHmac('sha256', rahasia).update(kepala + '.' + isi).digest('base64url');
    return kepala + '.' + isi + '.' + tanda;
}

function bacaToken(token) {
    const bagian = String(token || '').split('.');
    if (bagian.length !== 3) return null;
    const benar = crypto.createHmac('sha256', rahasia).update(bagian[0] + '.' + bagian[1]).digest();
    const kirim = Buffer.from(bagian[2], 'base64url');
    if (kirim.length !== benar.length || !crypto.timingSafeEqual(kirim, benar)) return null;
    let isi;
    try { isi = JSON.parse(Buffer.from(bagian[1], 'base64url').toString('utf8')); } catch (e) { return null; }
    if (!isi || !isi.exp || isi.exp < Math.floor(Date.now() / 1000)) return null;
    return isi;
}

function wajibLogin(req, res, next) {
    const cocok = (req.get('authorization') || '').match(/^Bearer (.+)$/i);
    const isi = cocok ? bacaToken(cocok[1]) : null;
    if (!isi) return next(httpError(401, 'Silakan login terlebih dahulu'));
    req.user = { id: isi.sub, username: isi.username, role: isi.role };
    next();
}

// ---------- Pembatas percobaan login gagal (per username) ----------
const gagal = new Map();
function terblokir(kunci) {
    const sekarang = Date.now();
    const daftar = (gagal.get(kunci) || []).filter((t) => sekarang - t < JENDELA_GAGAL_MS);
    if (daftar.length === 0) gagal.delete(kunci); else gagal.set(kunci, daftar);
    return daftar.length >= MAKS_GAGAL;
}
function catatGagal(kunci) {
    const daftar = gagal.get(kunci) || [];
    daftar.push(Date.now());
    gagal.set(kunci, daftar);
}

// ---------- Dokumentasi Swagger untuk endpoint auth ----------
const json = (deskripsi, schema) => ({ description: deskripsi, content: { 'application/json': { schema } } });
const galat = (deskripsi) => json(deskripsi, { type: 'object', properties: { error: { type: 'string' } } });
const bearer = [{ bearerAuth: [] }];
const openapiPaths = {
    '/auth/login': { post: {
        tags: ['Autentikasi'], summary: 'Login admin (username atau email)',
        requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['username', 'password'],
            properties: { username: { type: 'string', example: 'admin' }, password: { type: 'string' } }
        } } } },
        responses: {
            200: json('Login berhasil', { type: 'object', properties: {
                token: { type: 'string' }, tipe: { type: 'string', example: 'Bearer' }, berlaku_detik: { type: 'integer', example: 28800 },
                user: { type: 'object', properties: { id: { type: 'integer' }, username: { type: 'string' }, nama: { type: 'string' }, role: { type: 'string' } } }
            } }),
            400: galat('Username atau password kosong'), 401: galat('Username atau password salah'),
            429: galat('Terlalu banyak percobaan gagal (tunggu 15 menit)')
        }
    } },
    '/auth/me': { get: {
        tags: ['Autentikasi'], summary: 'Profil admin yang sedang login', security: bearer,
        responses: { 200: json('Profil', { type: 'object', properties: {
            id: { type: 'integer' }, username: { type: 'string' }, email: { type: 'string' }, nama: { type: 'string' }, role: { type: 'string' }
        } }), 401: galat('Belum login atau token kedaluwarsa') }
    } },
    '/auth/logout': { post: {
        tags: ['Autentikasi'], summary: 'Logout (client menghapus token)', security: bearer,
        responses: { 200: json('Berhasil', { type: 'object', properties: { message: { type: 'string' } } }), 401: galat('Belum login') }
    } },
    '/auth/lupa-password': { post: {
        tags: ['Autentikasi'], summary: 'Minta kode OTP reset password (dikirim ke email akun)',
        description: 'Kode OTP 6 angka dikirim ke email akun (berlaku 10 menit). Jawaban selalu sama, baik akun ada maupun tidak. Maksimal 1 permintaan per 60 detik per akun. Field otp hanya ikut di response jika RESET_TOKEN_DI_RESPONSE=true (untuk pengujian).',
        requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['akun'], properties: { akun: { type: 'string', description: 'Username atau email' } }
        } } } },
        responses: {
            200: json('Permintaan diterima', { type: 'object', properties: { message: { type: 'string' }, otp: { type: 'string', description: 'Hanya mode pengujian' } } }),
            400: galat('Akun kosong')
        }
    } },
    '/auth/reset-password': { post: {
        tags: ['Autentikasi'], summary: 'Ganti password memakai kode OTP',
        description: 'OTP salah 5 kali: kode hangus dan harus minta OTP baru.',
        requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['akun', 'otp', 'password_baru'],
            properties: {
                akun: { type: 'string', description: 'Username atau email (sama seperti saat minta OTP)' },
                otp: { type: 'string', example: '123456', description: 'Kode 6 angka dari email' },
                password_baru: { type: 'string', minLength: 8 }
            }
        } } } },
        responses: { 200: json('Password diganti', { type: 'object', properties: { message: { type: 'string' } } }), 400: galat('OTP tidak valid/kedaluwarsa, atau password terlalu pendek') }
    } }
};

// ---------- Pemasangan rute ----------
function pasangAuth(app) {
    siapkanTabel().catch((err) => console.error('Gagal menyiapkan tabel users:', err.message));

    // Jika AUTH_WAJIB=true di .env, semua /api butuh login kecuali yang publik.
    app.use('/api', (req, res, next) => {
        if (process.env.AUTH_WAJIB !== 'true' || req.method === 'OPTIONS') return next();
        const publik = ['/', '/auth/login', '/auth/lupa-password', '/auth/reset-password',
                        '/docs', '/openapi.json', '/documentation', '/documentation.json'];
        if (publik.includes(req.path)) return next();
        return wajibLogin(req, res, next);
    });

    app.post('/api/auth/login', async (req, res) => {
        const body = req.body || {};
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (!username || !password) throw httpError(400, 'Username dan password wajib diisi');

        const kunci = username.toLowerCase();
        if (terblokir(kunci)) throw httpError(429, 'Terlalu banyak percobaan gagal. Coba lagi dalam 15 menit');

        const [rows] = await db.query(
            'SELECT id, username, nama, role, password_hash FROM users WHERE username = ? OR email = ? LIMIT 1',
            [username, username]
        );
        const user = rows[0];
        let benar = false;
        if (user) benar = await cekPassword(password, user.password_hash);
        else await scrypt(password, crypto.randomBytes(16), 64); // samakan waktu respons
        if (!benar) {
            catatGagal(kunci);
            throw httpError(401, 'Username atau password salah');
        }
        gagal.delete(kunci);
        res.json({
            token: buatToken(user),
            tipe: 'Bearer',
            berlaku_detik: MASA_LOGIN_DETIK,
            user: { id: user.id, username: user.username, nama: user.nama, role: user.role }
        });
    });

    app.get('/api/auth/me', wajibLogin, async (req, res) => {
        const [rows] = await db.query('SELECT id, username, email, nama, role FROM users WHERE id = ?', [req.user.id]);
        if (!rows[0]) throw httpError(401, 'Akun tidak ditemukan');
        res.json(rows[0]);
    });

    app.post('/api/auth/logout', wajibLogin, (req, res) => {
        res.json({ message: 'Berhasil logout. Hapus token di sisi client.' });
    });

    const terakhirMinta = new Map();

    app.post('/api/auth/lupa-password', async (req, res) => {
        const body = req.body || {};
        const akun = String(body.akun || body.username || body.email || '').trim();
        if (!akun) throw httpError(400, 'Akun (username atau email) wajib diisi');

        const hasil = { message: 'Jika akun terdaftar, kode OTP telah dikirim ke email akun.' };
        const [rows] = await db.query('SELECT id, username, email FROM users WHERE username = ? OR email = ? LIMIT 1', [akun, akun]);
        const user = rows[0];
        if (user) {
            const kunci = String(user.id);
            const sebelumnya = terakhirMinta.get(kunci) || 0;
            if (Date.now() - sebelumnya < JEDA_KIRIM_OTP_MS) return res.json(hasil); // jawaban sama, tidak kirim lagi
            terakhirMinta.set(kunci, Date.now());

            const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
            await db.query(
                'UPDATE users SET reset_token_hash = ?, reset_percobaan = 0, reset_expires = DATE_ADD(NOW(), INTERVAL ' + MASA_RESET_MENIT + ' MINUTE) WHERE id = ?',
                [hashOtp(user.id, otp), user.id]
            );
            const isi = 'Kode OTP reset password E-Kasir UD. ULFA: ' + otp + '\n\n' +
                'Berlaku ' + MASA_RESET_MENIT + ' menit. Jangan berikan kode ini kepada siapa pun.\n' +
                'Abaikan email ini jika Anda tidak meminta reset password.';
            if (user.email) {
                try {
                    await kirimEmail(user.email, 'Kode OTP reset password: ' + otp, isi);
                    console.log('[RESET PASSWORD] OTP dikirim ke email akun "' + user.username + '".');
                } catch (err) {
                    console.error('[RESET PASSWORD] Gagal mengirim email untuk "' + user.username + '": ' + err.message);
                    console.log('[RESET PASSWORD] OTP cadangan untuk "' + user.username + '": ' + otp + ' (berlaku ' + MASA_RESET_MENIT + ' menit)');
                }
            } else {
                console.log('[RESET PASSWORD] Akun "' + user.username + '" belum punya email. OTP: ' + otp + ' (berlaku ' + MASA_RESET_MENIT + ' menit)');
            }
            if (process.env.RESET_TOKEN_DI_RESPONSE === 'true') hasil.otp = otp;
        }
        res.json(hasil);
    });

    app.post('/api/auth/reset-password', async (req, res) => {
        const body = req.body || {};
        const akun = String(body.akun || body.username || body.email || '').trim();
        const otp = String(body.otp || body.token || '').trim();
        const baru = String(body.password_baru || '');
        if (!akun || !otp || !baru) throw httpError(400, 'akun, otp, dan password_baru wajib diisi');
        cekKekuatan(baru);

        const salah = httpError(400, 'Kode OTP tidak valid atau sudah kedaluwarsa');
        const [rows] = await db.query(
            'SELECT id, username, reset_token_hash, reset_percobaan FROM users WHERE (username = ? OR email = ?) AND reset_token_hash IS NOT NULL AND reset_expires > NOW() LIMIT 1',
            [akun, akun]
        );
        const user = rows[0];
        if (!user) throw salah;
        if (!samaAman(hashOtp(user.id, otp), user.reset_token_hash)) {
            await db.query('UPDATE users SET reset_percobaan = reset_percobaan + 1 WHERE id = ?', [user.id]);
            if ((user.reset_percobaan || 0) + 1 >= MAKS_OTP_SALAH) {
                await db.query('UPDATE users SET reset_token_hash = NULL, reset_expires = NULL WHERE id = ?', [user.id]);
            }
            throw salah;
        }

        await db.query(
            'UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_expires = NULL, reset_percobaan = 0 WHERE id = ?',
            [await hashPassword(baru), user.id]
        );
        gagal.delete(user.username.toLowerCase());
        res.json({ message: 'Password berhasil diganti. Silakan login dengan password baru.' });
    });
}

module.exports = pasangAuth;
Object.assign(module.exports, { hashPassword, siapkanTabel, wajibLogin, bacaToken, openapiPaths });
