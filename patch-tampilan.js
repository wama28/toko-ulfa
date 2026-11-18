// Mengubah tampilan /api/docs: tema gelap, grup (tag) tertutup, kolom "Filter by tag".
const fs = require('fs');
const { execFileSync } = require('child_process');

const asli = fs.readFileSync('server.js', 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');

if (s.includes('/* docs-gelap */')) {
    console.log('Tampilan sudah terpasang, tidak ada yang diubah.');
    process.exit(0);
}
const lama = 'docExpansion: "list" });</script>';
const kepala = "'</head><body><div id=\"swagger-ui\"></div>' +";
if (!s.includes(lama) || !s.includes(kepala)) {
    console.error('GAGAL: Swagger (patch-swagger.js) belum terpasang atau bentuknya berbeda. server.js tidak diubah.');
    process.exit(1);
}
s = s.replace(lama, () => 'docExpansion: "none", filter: true, tagsSorter: "alpha", displayRequestDuration: true });</script>');
const css =
    "'<style>/* docs-gelap */ html{background:#fff;filter:invert(90%) hue-rotate(180deg)} " +
        ".swagger-ui .topbar{display:none}</style>' +\n        ";
s = s.replace(kepala, () => css + kepala);

fs.writeFileSync('server.js.bak6', asli);
fs.writeFileSync('server.js', s.replace(/\n/g, eol));
try {
    execFileSync(process.execPath, ['--check', 'server.js'], { stdio: 'pipe' });
} catch (e) {
    fs.writeFileSync('server.js', asli);
    console.error('GAGAL: hasil tidak valid, server.js dikembalikan seperti semula.');
    process.exit(1);
}
console.log('Selesai. Restart server, lalu buka /api/docs.');
