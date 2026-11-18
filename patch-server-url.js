// Kolom "Servers" di Swagger menampilkan alamat lengkap (mengikuti alamat yang dipakai membuka halaman).
const fs = require('fs');
const { execFileSync } = require('child_process');

const asli = fs.readFileSync('server.js', 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');

if (s.includes('/* server-url */')) {
    console.log('Sudah terpasang, tidak ada yang diubah.');
    process.exit(0);
}
const lama = "app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));";
if (!s.includes(lama)) {
    console.error('GAGAL: baris /api/openapi.json tidak ditemukan. server.js tidak diubah.');
    process.exit(1);
}
const baru =
"/* server-url */\n" +
"app.get('/api/openapi.json', (req, res) => {\n" +
"    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();\n" +
"    const alamat = proto + '://' + req.get('host') + '/api';\n" +
"    res.json(Object.assign({}, openapiSpec, { servers: [{ url: alamat, description: 'API Server' }] }));\n" +
"});";
s = s.replace(lama, () => baru);

fs.writeFileSync('server.js.bak7', asli);
fs.writeFileSync('server.js', s.replace(/\n/g, eol));
try {
    execFileSync(process.execPath, ['--check', 'server.js'], { stdio: 'pipe' });
} catch (e) {
    fs.writeFileSync('server.js', asli);
    console.error('GAGAL: hasil tidak valid, server.js dikembalikan seperti semula.');
    process.exit(1);
}
console.log('Selesai. Restart server, lalu buka /api/docs.');
