const fs = require('fs');
const { execFileSync } = require('child_process');

const berkas = 'server.js';
const asli = fs.readFileSync(berkas, 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');

if (s.includes('/* DAFTAR-ENDPOINT */')) {
    console.log('Daftar endpoint sudah ada, tidak ada yang diubah.');
    process.exit(0);
}

const penanda = '// Daftar transaksi. Filter opsional';
if (!s.includes(penanda)) {
    console.error('GAGAL: titik penyisipan tidak ditemukan. server.js tidak diubah.');
    process.exit(1);
}

const tambahan = `/* DAFTAR-ENDPOINT */
app.get('/api', (req, res) => {
    res.json({
        nama: 'API E-Kasir UD. ULFA',
        status: 'berjalan',
        endpoint: [
            'GET /api/produk (filter: ?kategori= &stok_maks= &cari=)',
            'GET /api/kategori',
            'GET /api/dashboard',
            'GET /api/dashboard/grafik?hari=7',
            'GET /api/transaksi',
            'GET /api/laporan?dari=YYYY-MM-DD&sampai=YYYY-MM-DD',
            'GET /api/documentation'
        ]
    });
});

`;

s = s.replace(penanda, () => tambahan + penanda);

fs.writeFileSync('server.js.bak2', asli);
fs.writeFileSync(berkas, s.replace(/\n/g, eol));

try {
    execFileSync(process.execPath, ['--check', berkas], { stdio: 'pipe' });
} catch (e) {
    fs.writeFileSync(berkas, asli);
    console.error('GAGAL: hasil perubahan tidak valid, server.js dikembalikan seperti semula.');
    process.exit(1);
}
console.log('Selesai. Alamat /api sekarang menampilkan daftar endpoint (cadangan: server.js.bak2).');
