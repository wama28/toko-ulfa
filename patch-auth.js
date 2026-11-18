const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const berkas = 'server.js';
if (!fs.existsSync('auth.js')) {
    console.error('GAGAL: auth.js belum ada di folder ini. Buat auth.js dulu.');
    process.exit(1);
}
const asli = fs.readFileSync(berkas, 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');
const diubah = [];

// 1) Pasang rute auth tepat setelah express.json()
if (!s.includes('/* AUTH-API */')) {
    const titik = 'app.use(express.json());';
    if (!s.includes(titik)) {
        console.error('GAGAL: baris app.use(express.json()); tidak ditemukan. server.js tidak diubah.');
        process.exit(1);
    }
    s = s.replace(titik, () => titik + "\n\n/* AUTH-API */\nconst pasangAuth = require('./auth');\npasangAuth(app);");
    diubah.push('rute auth');
}

// 2) Tambahkan endpoint auth ke Swagger (jika Swagger sudah terpasang)
const tSwagger = "app.get('/api/openapi.json'";
if (s.includes(tSwagger) && !s.includes('pasangAuth.openapiPaths')) {
    const blok =
        "if (pasangAuth.openapiPaths) {\n" +
        "    Object.assign(openapiSpec.paths, pasangAuth.openapiPaths);\n" +
        "    openapiSpec.tags.push({ name: 'Autentikasi' });\n" +
        "    openapiSpec.components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };\n" +
        "}\n\n";
    s = s.replace(tSwagger, () => blok + tSwagger);
    diubah.push('Swagger');
}

// 3) Tambahkan ke daftar di halaman /api (jika ada)
const tDaftar = "            'GET /api/documentation'";
if (s.includes(tDaftar) && !s.includes("'POST /api/auth/login")) {
    const baris =
        "            'POST /api/auth/login',\n" +
        "            'GET /api/auth/me (Bearer)',\n" +
        "            'POST /api/auth/logout (Bearer)',\n" +
        "            'POST /api/auth/lupa-password',\n" +
        "            'POST /api/auth/reset-password',\n";
    s = s.replace(tDaftar, () => baris + tDaftar);
    diubah.push('daftar /api');
}

if (diubah.length) {
    fs.writeFileSync('server.js.bak5', asli);
    fs.writeFileSync(berkas, s.replace(/\n/g, eol));
    try {
        execFileSync(process.execPath, ['--check', berkas], { stdio: 'pipe' });
        execFileSync(process.execPath, ['--check', 'auth.js'], { stdio: 'pipe' });
    } catch (e) {
        fs.writeFileSync(berkas, asli);
        console.error('GAGAL: hasil perubahan tidak valid, server.js dikembalikan seperti semula.');
        process.exit(1);
    }
}

// 4) Pengaturan di .env (dilakukan setelah server.js dinyatakan valid)
let env = fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8') : '';
const tambah = [];
if (!/^JWT_SECRET=/m.test(env)) tambah.push('JWT_SECRET=' + crypto.randomBytes(32).toString('hex'));
if (!/^AUTH_WAJIB=/m.test(env)) tambah.push('AUTH_WAJIB=false');
if (!/^RESET_TOKEN_DI_RESPONSE=/m.test(env)) tambah.push('RESET_TOKEN_DI_RESPONSE=false');
if (tambah.length) {
    if (env) fs.writeFileSync('.env.bak', env);
    if (env && !env.endsWith('\n')) env += '\r\n';
    fs.writeFileSync('.env', env + tambah.join('\r\n') + '\r\n');
    diubah.push('.env');
}

console.log(diubah.length
    ? 'Selesai. Diperbarui: ' + diubah.join(', ')
    : 'Semua sudah terpasang, tidak ada yang diubah.');
