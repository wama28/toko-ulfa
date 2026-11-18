// Dokumentasi API UD. ULFA
// Menyediakan:
//   GET /api/documentation       -> halaman HTML yang bisa dibuka di browser
//   GET /api/documentation.json  -> daftar endpoint dalam format JSON

const endpoints = [
    // ---------------- PRODUK ----------------
    {
        grup: 'Produk',
        method: 'GET',
        path: '/api/produk',
        deskripsi: 'Ambil semua produk (terbaru di atas).',
        response: [{ id: 1, nama: 'Beras 5 Kg', kategori: 'Sembako', harga: 68000, stok: 40, deskripsi: '-', gambar: 'https://placehold.co/150', created_at: '2026-10-29T10:00:00.000Z' }]
    },
    {
        grup: 'Produk',
        method: 'GET',
        path: '/api/produk/:id',
        deskripsi: 'Ambil satu produk berdasarkan id.',
        response: { id: 1, nama: 'Beras 5 Kg', kategori: 'Sembako', harga: 68000, stok: 40 },
        error: '404 { "error": "Produk tidak ditemukan" }'
    },
    {
        grup: 'Produk',
        method: 'POST',
        path: '/api/produk',
        deskripsi: 'Tambah produk baru. Dikirim sebagai multipart/form-data. Gambar opsional (jpg/png/webp/gif, maks 2 MB).',
        body: { nama: 'string (wajib)', kategori: 'string (wajib)', harga: 'angka >= 0 (wajib)', stok: 'bilangan bulat >= 0 (wajib)', deskripsi: 'string (opsional)', gambar: 'file (opsional)' },
        response: { message: 'Produk berhasil ditambahkan', id: 4 },
        error: '400 { "error": "Nama, kategori, harga (>= 0) dan stok ... wajib diisi dengan benar" }'
    },
    {
        grup: 'Produk',
        method: 'PUT',
        path: '/api/produk/:id',
        deskripsi: 'Edit produk. Semua field opsional; yang tidak dikirim tetap memakai nilai lama. multipart/form-data.',
        body: { nama: 'string', kategori: 'string', harga: 'angka', stok: 'bilangan bulat', deskripsi: 'string', gambar: 'file' },
        response: { message: 'Produk berhasil diperbarui' },
        error: '404 { "error": "Produk tidak ditemukan" }'
    },
    {
        grup: 'Produk',
        method: 'DELETE',
        path: '/api/produk/:id',
        deskripsi: 'Hapus produk. Produk yang sudah pernah terjual tidak bisa dihapus.',
        response: { message: 'Produk berhasil dihapus' },
        error: '409 { "error": "Produk sudah pernah terjual sehingga tidak bisa dihapus" }'
    },
    {
        grup: 'Produk',
        method: 'PUT',
        path: '/api/produk/:id/stok',
        deskripsi: 'Tambah atau kurangi stok. Stok tidak bisa kurang dari 0. Body JSON.',
        body: { aksi: "'tambah' atau 'kurang'", jumlah: 'bilangan bulat > 0' },
        response: { message: 'Stok berhasil diperbarui', stokBaru: 45 },
        error: '400 { "error": "Stok tidak boleh kurang dari 0!" }'
    },

    // ---------------- TRANSAKSI ----------------
    {
        grup: 'Transaksi',
        method: 'POST',
        path: '/api/transaksi',
        deskripsi: 'Simpan transaksi kasir. Harga dihitung server dari database dan stok otomatis berkurang. Body JSON.',
        body: {
            items: [{ produk_id: 1, jumlah: 2 }],
            metode_pembayaran: "string (opsional, default 'Tunai')",
            no_transaksi: "string (opsional, default 'TRX-<timestamp>')"
        },
        response: { message: 'Transaksi berhasil disimpan & stok diperbarui!', id: 7, no_transaksi: 'TRX-1761753600000', total_harga: 136000 },
        error: '400 { "error": "Stok Beras 5 Kg tidak mencukupi (sisa 1)" }'
    },

    // ---------------- DASHBOARD & LAPORAN ----------------
    {
        grup: 'Dashboard & Laporan',
        method: 'GET',
        path: '/api/dashboard',
        deskripsi: 'Ringkasan: total produk, jumlah stok menipis (<= 5), transaksi dan pendapatan hari ini.',
        response: { total_produk: 3, stok_menipis: 1, transaksi_hari_ini: 4, pendapatan_hari_ini: 250000 }
    },
    {
        grup: 'Dashboard & Laporan',
        method: 'GET',
        path: '/api/laporan',
        deskripsi: 'Daftar transaksi. Filter tanggal opsional lewat query string: ?dari=2026-10-01&sampai=2026-10-31',
        response: [{ id: 7, no_transaksi: 'TRX-1761753600000', tanggal: '2026-10-29T16:00:00.000Z', total_harga: 136000, metode_pembayaran: 'Tunai' }]
    },
    {
        grup: 'Dashboard & Laporan',
        method: 'GET',
        path: '/api/laporan/:id',
        deskripsi: 'Detail satu transaksi beserta barang yang dibeli.',
        response: {
            id: 7, no_transaksi: 'TRX-1761753600000', total_harga: 136000, metode_pembayaran: 'Tunai',
            items: [{ produk_id: 1, nama: 'Beras 5 Kg', jumlah: 2, subtotal: 136000 }]
        },
        error: '404 { "error": "Transaksi tidak ditemukan" }'
    }
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const json = (o) => esc(JSON.stringify(o, null, 2));

function renderHtml(baseUrl) {
    const grupList = [...new Set(endpoints.map((e) => e.grup))];

    const bagian = grupList.map((g) => {
        const kartu = endpoints.filter((e) => e.grup === g).map((e) => `
        <details class="card">
            <summary>
                <span class="m ${e.method}">${e.method}</span>
                <code>${esc(e.path)}</code>
                <span class="desc">${esc(e.deskripsi)}</span>
            </summary>
            <div class="isi">
                ${e.body ? `<h4>Body</h4><pre>${json(e.body)}</pre>` : ''}
                <h4>Contoh response sukses</h4><pre>${json(e.response)}</pre>
                ${e.error ? `<h4>Contoh error</h4><pre>${esc(e.error)}</pre>` : ''}
            </div>
        </details>`).join('');
        return `<h2>${esc(g)}</h2>${kartu}`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dokumentasi API - UD. ULFA</title>
<style>
    :root { --bg:#f6f7f9; --card:#fff; --text:#1c1f24; --muted:#5f6b7a; --line:#dde1e7; --code:#f0f2f5; }
    @media (prefers-color-scheme: dark) {
        :root { --bg:#14171c; --card:#1c2027; --text:#e8eaed; --muted:#9aa4b2; --line:#2d333d; --code:#12151a; }
    }
    * { box-sizing: border-box; }
    body { margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; }
    main { max-width: 860px; margin: 0 auto; }
    h1 { margin:0 0 4px; font-size:24px; }
    h2 { margin:32px 0 10px; font-size:18px; }
    h4 { margin:14px 0 6px; font-size:13px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    p.sub { margin:0 0 16px; color:var(--muted); }
    .base { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 14px; word-break:break-all; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:8px; margin-bottom:8px; }
    summary { cursor:pointer; padding:10px 14px; display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; }
    .desc { color:var(--muted); flex-basis:100%; font-size:14px; }
    .isi { padding:0 14px 14px; border-top:1px solid var(--line); }
    pre { margin:0; padding:10px 12px; background:var(--code); border-radius:6px; overflow-x:auto; font-size:13px; }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size:14px; word-break:break-all; }
    .m { font-size:12px; font-weight:700; padding:2px 8px; border-radius:4px; color:#fff; min-width:62px; text-align:center; }
    .GET{background:#2e7d32} .POST{background:#1565c0} .PUT{background:#ef6c00} .DELETE{background:#c62828}
    .note { margin-top:28px; font-size:14px; color:var(--muted); }
</style>
</head>
<body>
<main>
    <h1>Dokumentasi API UD. ULFA</h1>
    <p class="sub">Aplikasi kasir &amp; stok. Semua response berformat JSON.</p>
    <div class="base"><strong>Base URL:</strong> <code>${esc(baseUrl)}</code></div>
    ${bagian}
    <p class="note">Error selalu berbentuk <code>{ "error": "pesan" }</code> dengan status HTTP yang sesuai (400, 404, 409, 500).
    Versi JSON halaman ini: <a href="${esc(baseUrl)}/api/documentation.json">/api/documentation.json</a></p>
</main>
</body>
</html>`;
}

module.exports = function pasangDokumentasi(app) {
    // Base URL dibaca dari request supaya otomatis benar saat lewat ngrok (https)
    const baseUrl = (req) => {
        const proto = req.get('x-forwarded-proto') || req.protocol;
        return `${proto}://${req.get('host')}`;
    };

    app.get('/api/documentation', (req, res) => {
        res.type('html').send(renderHtml(baseUrl(req)));
    });

    app.get('/api/documentation.json', (req, res) => {
        res.json({ nama: 'API UD. ULFA', base_url: baseUrl(req), endpoints });
    });
};