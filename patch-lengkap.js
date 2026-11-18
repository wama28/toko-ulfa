const fs = require('fs');
const { execFileSync } = require('child_process');

const berkas = 'server.js';
const asli = fs.readFileSync(berkas, 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');
let diubah = [];

const produkLama = `app.get('/api/produk', async (req, res) => {
    const [rows] = await db.query('SELECT * FROM produk ORDER BY id DESC');
    res.json(rows);
});`;
const produkBaru = `app.get('/api/produk', async (req, res) => {
    const { kategori, stok_maks, cari } = req.query;
    const where = [];
    const params = [];
    if (kategori) { where.push('kategori = ?'); params.push(kategori); }
    if (stok_maks !== undefined && stok_maks !== '') {
        const batas = Number(stok_maks);
        if (!Number.isFinite(batas)) throw httpError(400, 'stok_maks harus berupa angka');
        where.push('stok <= ?'); params.push(batas);
    }
    if (cari) { where.push('nama LIKE ?'); params.push('%' + cari + '%'); }

    const sql = 'SELECT * FROM produk' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
});`;
if (!s.includes('const { kategori, stok_maks, cari } = req.query;')) {
    if (!s.includes(produkLama)) {
        console.error("GAGAL: blok app.get('/api/produk') tidak dikenali. server.js tidak diubah.");
        process.exit(1);
    }
    s = s.replace(produkLama, () => produkBaru);
    diubah.push('filter produk');
}

const penanda = '// Daftar transaksi. Filter opsional';
const tambahan = `// Grafik pendapatan per hari: /api/dashboard/grafik?hari=7
app.get('/api/dashboard/grafik', async (req, res) => {
    const hari = Math.min(Math.max(parseInt(req.query.hari) || 7, 1), 90);
    const [rows] = await db.query(
        "SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal, SUM(total_harga) AS pendapatan, COUNT(*) AS jumlah_transaksi " +
        'FROM transaksi WHERE tanggal >= CURDATE() - INTERVAL ? DAY ' +
        "GROUP BY DATE_FORMAT(tanggal, '%Y-%m-%d')",
        [hari - 1]
    );
    const peta = new Map(rows.map((r) => [r.tanggal, r]));
    const pad = (n) => String(n).padStart(2, '0');
    const hasil = [];
    for (let i = hari - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const kunci = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        const r = peta.get(kunci);
        hasil.push({
            tanggal: kunci,
            pendapatan: r ? Number(r.pendapatan) : 0,
            jumlah_transaksi: r ? Number(r.jumlah_transaksi) : 0
        });
    }
    res.json(hasil);
});

// Ringkasan per kategori produk
app.get('/api/kategori', async (req, res) => {
    const [rows] = await db.query(
        'SELECT kategori AS nama, COUNT(*) AS jumlah_produk, COALESCE(SUM(stok), 0) AS total_stok ' +
        'FROM produk GROUP BY kategori ORDER BY kategori'
    );
    res.json(rows);
});`;
if (!s.includes("app.get('/api/dashboard/grafik'")) {
    if (!s.includes(penanda)) {
        console.error('GAGAL: titik penyisipan tidak ditemukan. server.js tidak diubah.');
        process.exit(1);
    }
    s = s.replace(penanda, () => tambahan + '\n\n' + penanda);
    diubah.push('grafik + kategori');
}

const awal = s.indexOf('/* DAFTAR-ENDPOINT */');
if (awal !== -1) {
    const a = s.indexOf('endpoint: [', awal);
    const b = s.indexOf(']', a);
    if (a !== -1 && b !== -1) {
        const daftarBaru = `endpoint: [
            'GET /api/produk (filter: ?kategori= &stok_maks= &cari=)',
            'GET /api/produk/:id',
            'POST /api/produk',
            'PUT /api/produk/:id',
            'DELETE /api/produk/:id',
            'PUT /api/produk/:id/stok',
            'GET /api/kategori',
            'POST /api/transaksi',
            'GET /api/dashboard',
            'GET /api/dashboard/grafik?hari=7',
            'GET /api/laporan?dari=YYYY-MM-DD&sampai=YYYY-MM-DD',
            'GET /api/laporan/:id',
            'GET /api/documentation'
        `;
        const lama = s.slice(a, b);
        if (lama !== daftarBaru) {
            s = s.slice(0, a) + daftarBaru + s.slice(b);
            diubah.push('daftar endpoint /api');
        }
    }
}

if (diubah.length === 0) {
    console.log('Semua sudah terpasang, tidak ada yang diubah.');
    process.exit(0);
}

fs.writeFileSync('server.js.bak3', asli);
fs.writeFileSync(berkas, s.replace(/\n/g, eol));

try {
    execFileSync(process.execPath, ['--check', berkas], { stdio: 'pipe' });
} catch (e) {
    fs.writeFileSync(berkas, asli);
    console.error('GAGAL: hasil perubahan tidak valid, server.js dikembalikan seperti semula.');
    process.exit(1);
}
console.log('Selesai. Diperbarui: ' + diubah.join(', ') + ' (cadangan: server.js.bak3)');
