const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const pasangDokumentasi = require('./docs');

// --- Setup Cloudinary (untuk simpan gambar di cloud, bukan lokal) ---
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// multer-storage-cloudinary: upload langsung ke Cloudinary tanpa simpan lokal
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary,
    params: {
        folder: 'ud-ulfa',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation: [{ width: 800, crop: 'limit' }]
    }
});

const app = express();

// CORS: izinkan semua origin (aman untuk API publik tanpa auth sensitif)
// Jika AUTH_WAJIB=true, token JWT tetap melindungi endpoint yang butuh login
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Bypass halaman peringatan ngrok untuk semua request API
// (ngrok free plan menampilkan warning page jika header ini tidak ada)
app.use((req, res, next) => {
    res.setHeader('ngrok-skip-browser-warning', 'true');
    next();
});

/* AUTH-API */
const pasangAuth = require('./auth');
pasangAuth(app);

// --- Folder upload lokal (hanya dipakai saat development / ngrok, bukan Vercel) ---
const uploadDir = path.join(__dirname, 'uploads');
if (!process.env.VERCEL) {
    fs.mkdirSync(uploadDir, { recursive: true });
    app.use('/uploads', express.static(uploadDir));
}

// Pilih storage: Cloudinary jika credentials tersedia, lokal jika tidak
const gunakanCloudinary = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

const upload = multer({
    storage: gunakanCloudinary
        ? cloudinaryStorage
        : multer.diskStorage({
            destination: (req, file, cb) => cb(null, uploadDir),
            filename: (req, file, cb) =>
                cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + path.extname(file.originalname).toLowerCase())
        }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
        const err = new Error('File harus berupa gambar (jpg, png, webp, gif)');
        err.status = 400;
        cb(err);
    }
});

// --- Helper ---
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Ubah path relatif /uploads/xxx menjadi URL absolut jika BASE_URL diisi di .env
const urlGambarPublik = (req, pathGambar) => {
    if (!pathGambar || !pathGambar.startsWith('/uploads/')) return pathGambar;
    const base = process.env.BASE_URL
        ? process.env.BASE_URL.replace(/\/$/, '').replace(/^http:\/\//, 'https://')
        : (req ? `${req.protocol}://${req.get('host')}` : '');
    return base + pathGambar;
};

// Hapus file: dari Cloudinary jika pakai cloud, dari lokal jika tidak
const hapusFile = (urlGambar) => {
    if (!urlGambar) return;
    if (gunakanCloudinary) {
        // URL Cloudinary: https://res.cloudinary.com/cloud/image/upload/v123/ud-ulfa/namafile.jpg
        // Public ID yang perlu dihapus: ud-ulfa/namafile
        const cocok = urlGambar.match(/\/ud-ulfa\/([^/.]+)/);
        if (cocok) cloudinary.uploader.destroy('ud-ulfa/' + cocok[1]).catch(() => {});
    } else if (urlGambar.startsWith('/uploads/')) {
        fs.unlink(path.join(uploadDir, path.basename(urlGambar)), () => {});
    }
};

// URL gambar dari multer: Cloudinary langsung kasih URL absolut, lokal kasih path relatif
const ambilUrlGambar = (req, file) => {
    if (!file) return null;
    if (gunakanCloudinary) return file.path; // Cloudinary: file.path = URL lengkap
    return `/uploads/${file.filename}`;      // Lokal: path relatif
};

// =====================================================
// 1. PRODUK
// =====================================================
app.get('/api/produk', async (req, res) => {
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
    res.json(rows.map(r => ({ ...r, gambar: urlGambarPublik(req, r.gambar) })));
});

app.get('/api/produk/:id', async (req, res) => {
    const [rows] = await db.query('SELECT * FROM produk WHERE id = ?', [req.params.id]);
    if (rows.length === 0) throw httpError(404, 'Produk tidak ditemukan');
    const r = rows[0];
    res.json({ ...r, gambar: urlGambarPublik(req, r.gambar) });
});

app.post('/api/produk', upload.single('gambar'), async (req, res) => {
    const { nama, kategori, deskripsi } = req.body;
    const harga = Number(req.body.harga);
    const stok = Number(req.body.stok);
    const gambar = ambilUrlGambar(req, req.file) || 'https://placehold.co/150';

    if (!nama || !nama.trim() || !kategori || !kategori.trim() ||
        !Number.isFinite(harga) || harga < 0 || !Number.isInteger(stok) || stok < 0) {
        if (req.file) hapusFile(gambar);
        throw httpError(400, 'Nama, kategori, harga (>= 0) dan stok (bilangan bulat >= 0) wajib diisi dengan benar');
    }

    const [result] = await db.query(
        'INSERT INTO produk (nama, kategori, harga, stok, deskripsi, gambar) VALUES (?, ?, ?, ?, ?, ?)',
        [nama.trim(), kategori.trim(), harga, stok, deskripsi || '-', gambar]
    );
    res.status(201).json({ message: 'Produk berhasil ditambahkan', id: result.insertId });
});

// Edit produk (gambar opsional)
app.put('/api/produk/:id', upload.single('gambar'), async (req, res) => {
    const { id } = req.params;
    const [rows] = await db.query('SELECT * FROM produk WHERE id = ?', [id]);
    if (rows.length === 0) {
        if (req.file) hapusFile(`/uploads/${req.file.filename}`);
        throw httpError(404, 'Produk tidak ditemukan');
    }
    const lama = rows[0];
    const nama = req.body.nama ?? lama.nama;
    const kategori = req.body.kategori ?? lama.kategori;
    const harga = req.body.harga !== undefined ? Number(req.body.harga) : lama.harga;
    const stok = req.body.stok !== undefined ? Number(req.body.stok) : lama.stok;
    const deskripsi = req.body.deskripsi ?? lama.deskripsi;
    const gambar = ambilUrlGambar(req, req.file) || lama.gambar;

    if (!Number.isFinite(harga) || harga < 0 || !Number.isInteger(stok) || stok < 0) {
        if (req.file) hapusFile(gambar);
        throw httpError(400, 'Harga atau stok tidak valid');
    }

    await db.query(
        'UPDATE produk SET nama=?, kategori=?, harga=?, stok=?, deskripsi=?, gambar=? WHERE id=?',
        [nama, kategori, harga, stok, deskripsi, gambar, id]
    );
    if (req.file) hapusFile(lama.gambar);
    res.json({ message: 'Produk berhasil diperbarui' });
});

app.delete('/api/produk/:id', async (req, res) => {
    const { id } = req.params;
    const [rows] = await db.query('SELECT gambar FROM produk WHERE id = ?', [id]);
    if (rows.length === 0) throw httpError(404, 'Produk tidak ditemukan');

    try {
        await db.query('DELETE FROM produk WHERE id = ?', [id]);
    } catch (err) {
        // Produk sudah ada di riwayat transaksi -> jangan dihapus agar laporan tetap utuh
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            throw httpError(409, 'Produk sudah pernah terjual sehingga tidak bisa dihapus');
        }
        throw err;
    }
    hapusFile(rows[0].gambar);
    res.json({ message: 'Produk berhasil dihapus' });
});

// Tambah / kurangi stok
app.put('/api/produk/:id/stok', async (req, res) => {
    const { id } = req.params;
    const { aksi } = req.body;
    const jumlah = Number(req.body.jumlah);

    if (!['tambah', 'kurang'].includes(aksi)) throw httpError(400, "Aksi harus 'tambah' atau 'kurang'");
    if (!Number.isInteger(jumlah) || jumlah <= 0) throw httpError(400, 'Jumlah harus bilangan bulat lebih dari 0');

    // Satu query atomik -> tidak ada race condition, stok tidak bisa minus
    const sql = aksi === 'tambah'
        ? 'UPDATE produk SET stok = stok + ? WHERE id = ?'
        : 'UPDATE produk SET stok = stok - ? WHERE id = ? AND stok >= ?';
    const params = aksi === 'tambah' ? [jumlah, id] : [jumlah, id, jumlah];
    const [result] = await db.query(sql, params);

    if (result.affectedRows === 0) {
        const [cek] = await db.query('SELECT id FROM produk WHERE id = ?', [id]);
        if (cek.length === 0) throw httpError(404, 'Produk tidak ditemukan');
        throw httpError(400, 'Stok tidak boleh kurang dari 0!');
    }

    const [[row]] = await db.query('SELECT stok FROM produk WHERE id = ?', [id]);
    res.json({ message: 'Stok berhasil diperbarui', stokBaru: row.stok });
});

// =====================================================
// 2. TRANSAKSI (KASIR)
// =====================================================
app.post('/api/transaksi', async (req, res) => {
    const { items } = req.body;
    const metode = req.body.metode_pembayaran || 'Tunai';
    const noTransaksi = req.body.no_transaksi || 'TRX-' + Date.now();

    if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'Item transaksi tidak boleh kosong');

    // Gabungkan item duplikat & validasi
    const gabungan = new Map();
    for (const it of items) {
        const pid = Number(it.produk_id);
        const jml = Number(it.jumlah);
        if (!Number.isInteger(pid) || !Number.isInteger(jml) || jml <= 0) {
            throw httpError(400, 'Data item tidak valid');
        }
        gabungan.set(pid, (gabungan.get(pid) || 0) + jml);
    }
    // Urutkan id agar tidak terjadi deadlock antar transaksi bersamaan
    const daftar = [...gabungan.entries()].sort((a, b) => a[0] - b[0]);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        let total = 0;
        const detail = [];
        for (const [produkId, jumlah] of daftar) {
            // Kunci baris produk, ambil harga & stok terbaru dari database
            const [rows] = await conn.query('SELECT nama, harga, stok FROM produk WHERE id = ? FOR UPDATE', [produkId]);
            if (rows.length === 0) throw httpError(404, `Produk dengan id ${produkId} tidak ditemukan`);
            const p = rows[0];
            if (p.stok < jumlah) throw httpError(400, `Stok ${p.nama} tidak mencukupi (sisa ${p.stok})`);

            const subtotal = p.harga * jumlah; // dihitung server, bukan percaya kiriman client
            total += subtotal;
            detail.push([produkId, jumlah, subtotal]);
            await conn.query('UPDATE produk SET stok = stok - ? WHERE id = ?', [jumlah, produkId]);
        }

        const [trx] = await conn.query(
            'INSERT INTO transaksi (no_transaksi, total_harga, metode_pembayaran) VALUES (?, ?, ?)',
            [noTransaksi, total, metode]
        );
        await conn.query(
            'INSERT INTO detail_transaksi (transaksi_id, produk_id, jumlah, subtotal) VALUES ?',
            [detail.map(d => [trx.insertId, ...d])]
        );

        await conn.commit();
        res.status(201).json({
            message: 'Transaksi berhasil disimpan & stok diperbarui!',
            id: trx.insertId,
            no_transaksi: noTransaksi,
            total_harga: total
        });
    } catch (err) {
        await conn.rollback();
        if (err.code === 'ER_DUP_ENTRY') throw httpError(409, 'Nomor transaksi sudah dipakai');
        throw err;
    } finally {
        conn.release();
    }
});

// =====================================================
// 3. DASHBOARD & LAPORAN
// =====================================================
app.get('/api/dashboard', async (req, res) => {
    const [[produk], [menipis], [hariIni]] = await Promise.all([
        db.query('SELECT COUNT(*) AS total_produk FROM produk'),
        db.query('SELECT COUNT(*) AS stok_menipis FROM produk WHERE stok <= 5'),
        db.query(`SELECT COALESCE(SUM(total_harga), 0) AS pendapatan_hari_ini, COUNT(id) AS transaksi_hari_ini
                  FROM transaksi
                  WHERE tanggal >= CURDATE() AND tanggal < CURDATE() + INTERVAL 1 DAY`)
    ]);
    res.json({
        total_produk: produk[0].total_produk,
        stok_menipis: menipis[0].stok_menipis,
        transaksi_hari_ini: hariIni[0].transaksi_hari_ini,
        pendapatan_hari_ini: hariIni[0].pendapatan_hari_ini
    });
});

/* DAFTAR-ENDPOINT */
app.get('/api', (req, res) => {
    res.json({
        nama: 'API E-Kasir UD. ULFA',
        status: 'berjalan',
        endpoint: [
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
            'GET /api/docs (Swagger UI)',
            'POST /api/auth/login',
            'GET /api/auth/me (Bearer)',
            'POST /api/auth/logout (Bearer)',
            'POST /api/auth/lupa-password',
            'POST /api/auth/reset-password',
            'GET /api/documentation'
        ]
    });
});

// Grafik pendapatan per hari: /api/dashboard/grafik?hari=7
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
});

/* SWAGGER-DOCS */
const jsonRes = (deskripsi, schema) => ({ description: deskripsi, content: { 'application/json': { schema } } });
const errRes = (deskripsi) => jsonRes(deskripsi, { $ref: '#/components/schemas/Error' });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'ID' };

const openapiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'API E-Kasir UD. ULFA',
        version: '1.0.0',
        description: 'Backend aplikasi kasir dan stok UD. ULFA (Node.js, Express, MySQL). Semua response berformat JSON.'
    },
    servers: [{ url: '/api', description: 'Server saat ini' }],
    tags: [
        { name: 'Produk' }, { name: 'Kategori' }, { name: 'Transaksi' },
        { name: 'Dashboard' }, { name: 'Laporan' }
    ],
    paths: {
        '/produk': {
            get: {
                tags: ['Produk'], summary: 'Daftar produk (terbaru di atas)',
                parameters: [
                    { name: 'kategori', in: 'query', schema: { type: 'string' }, description: 'Filter kategori, contoh: ATK' },
                    { name: 'stok_maks', in: 'query', schema: { type: 'integer' }, description: 'Hanya produk dengan stok kurang dari atau sama dengan nilai ini' },
                    { name: 'cari', in: 'query', schema: { type: 'string' }, description: 'Cari berdasarkan nama' }
                ],
                responses: {
                    200: jsonRes('Daftar produk', { type: 'array', items: { $ref: '#/components/schemas/Produk' } }),
                    400: errRes('Parameter tidak valid')
                }
            },
            post: {
                tags: ['Produk'], summary: 'Tambah produk baru (gambar opsional)',
                requestBody: {
                    required: true,
                    content: { 'multipart/form-data': { schema: {
                        type: 'object', required: ['nama', 'kategori', 'harga', 'stok'],
                        properties: {
                            nama: { type: 'string' }, kategori: { type: 'string' },
                            harga: { type: 'number', minimum: 0 }, stok: { type: 'integer', minimum: 0 },
                            deskripsi: { type: 'string' },
                            gambar: { type: 'string', format: 'binary', description: 'jpg/png/webp/gif, maks 2 MB' }
                        }
                    } } }
                },
                responses: {
                    201: jsonRes('Produk ditambahkan', { type: 'object', properties: { message: { type: 'string' }, id: { type: 'integer' } } }),
                    400: errRes('Data tidak valid')
                }
            }
        },
        '/produk/{id}': {
            get: {
                tags: ['Produk'], summary: 'Detail satu produk', parameters: [idParam],
                responses: { 200: jsonRes('Produk', { $ref: '#/components/schemas/Produk' }), 404: errRes('Produk tidak ditemukan') }
            },
            put: {
                tags: ['Produk'], summary: 'Ubah produk (field yang tidak dikirim tetap)', parameters: [idParam],
                requestBody: {
                    content: { 'multipart/form-data': { schema: {
                        type: 'object',
                        properties: {
                            nama: { type: 'string' }, kategori: { type: 'string' },
                            harga: { type: 'number' }, stok: { type: 'integer' },
                            deskripsi: { type: 'string' }, gambar: { type: 'string', format: 'binary' }
                        }
                    } } }
                },
                responses: {
                    200: jsonRes('Berhasil', { type: 'object', properties: { message: { type: 'string' } } }),
                    400: errRes('Data tidak valid'), 404: errRes('Produk tidak ditemukan')
                }
            },
            delete: {
                tags: ['Produk'], summary: 'Hapus produk (yang sudah pernah terjual tidak bisa dihapus)', parameters: [idParam],
                responses: {
                    200: jsonRes('Berhasil', { type: 'object', properties: { message: { type: 'string' } } }),
                    404: errRes('Produk tidak ditemukan'), 409: errRes('Produk sudah pernah terjual')
                }
            }
        },
        '/produk/{id}/stok': {
            put: {
                tags: ['Produk'], summary: 'Tambah atau kurangi stok', parameters: [idParam],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                        type: 'object', required: ['aksi', 'jumlah'],
                        properties: { aksi: { type: 'string', enum: ['tambah', 'kurang'] }, jumlah: { type: 'integer', minimum: 1 } }
                    } } }
                },
                responses: {
                    200: jsonRes('Stok diperbarui', { type: 'object', properties: { message: { type: 'string' }, stokBaru: { type: 'integer' } } }),
                    400: errRes('Stok tidak boleh kurang dari 0'), 404: errRes('Produk tidak ditemukan')
                }
            }
        },
        '/kategori': {
            get: {
                tags: ['Kategori'], summary: 'Ringkasan jumlah produk dan stok per kategori',
                responses: { 200: jsonRes('Daftar kategori', { type: 'array', items: {
                    type: 'object',
                    properties: { nama: { type: 'string' }, jumlah_produk: { type: 'integer' }, total_stok: { type: 'integer' } }
                } }) }
            }
        },
        '/transaksi': {
            post: {
                tags: ['Transaksi'], summary: 'Simpan transaksi kasir (harga dihitung server, stok berkurang otomatis)',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: {
                        type: 'object', required: ['items'],
                        properties: {
                            items: { type: 'array', items: {
                                type: 'object', required: ['produk_id', 'jumlah'],
                                properties: { produk_id: { type: 'integer' }, jumlah: { type: 'integer', minimum: 1 } }
                            } },
                            metode_pembayaran: { type: 'string', default: 'Tunai' },
                            no_transaksi: { type: 'string', description: 'Opsional, default TRX-timestamp' }
                        }
                    } } }
                },
                responses: {
                    201: jsonRes('Transaksi tersimpan', { type: 'object', properties: {
                        message: { type: 'string' }, id: { type: 'integer' },
                        no_transaksi: { type: 'string' }, total_harga: { type: 'number' }
                    } }),
                    400: errRes('Stok tidak mencukupi atau data tidak valid'),
                    404: errRes('Produk tidak ditemukan'), 409: errRes('Nomor transaksi sudah dipakai')
                }
            }
        },
        '/dashboard': {
            get: {
                tags: ['Dashboard'], summary: 'Ringkasan: total produk, stok menipis, transaksi dan pendapatan hari ini',
                responses: { 200: jsonRes('Ringkasan', { type: 'object', properties: {
                    total_produk: { type: 'integer' }, stok_menipis: { type: 'integer' },
                    transaksi_hari_ini: { type: 'integer' }, pendapatan_hari_ini: { type: 'number' }
                } }) }
            }
        },
        '/dashboard/grafik': {
            get: {
                tags: ['Dashboard'], summary: 'Pendapatan per hari (hari tanpa transaksi bernilai 0)',
                parameters: [{ name: 'hari', in: 'query', schema: { type: 'integer', default: 7, minimum: 1, maximum: 90 } }],
                responses: { 200: jsonRes('Data grafik', { type: 'array', items: {
                    type: 'object',
                    properties: { tanggal: { type: 'string', example: '2026-11-06' }, pendapatan: { type: 'number' }, jumlah_transaksi: { type: 'integer' } }
                } }) }
            }
        },
        '/laporan': {
            get: {
                tags: ['Laporan'], summary: 'Riwayat transaksi (filter tanggal opsional)',
                parameters: [
                    { name: 'dari', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD' },
                    { name: 'sampai', in: 'query', schema: { type: 'string', format: 'date' }, description: 'YYYY-MM-DD' }
                ],
                responses: { 200: jsonRes('Daftar transaksi', { type: 'array', items: { $ref: '#/components/schemas/Transaksi' } }) }
            }
        },
        '/laporan/{id}': {
            get: {
                tags: ['Laporan'], summary: 'Detail satu transaksi beserta barang yang dibeli', parameters: [idParam],
                responses: { 200: jsonRes('Detail transaksi', { $ref: '#/components/schemas/Transaksi' }), 404: errRes('Transaksi tidak ditemukan') }
            }
        }
    },
    components: {
        schemas: {
            Error: { type: 'object', properties: { error: { type: 'string' } } },
            Produk: {
                type: 'object',
                properties: {
                    id: { type: 'integer' }, nama: { type: 'string' }, kategori: { type: 'string' },
                    harga: { type: 'number' }, stok: { type: 'integer' }, deskripsi: { type: 'string' },
                    gambar: { type: 'string' }, created_at: { type: 'string', format: 'date-time' }
                }
            },
            Transaksi: {
                type: 'object',
                properties: {
                    id: { type: 'integer' }, no_transaksi: { type: 'string' }, tanggal: { type: 'string', format: 'date-time' },
                    total_harga: { type: 'number' }, metode_pembayaran: { type: 'string' },
                    items: { type: 'array', items: { type: 'object', properties: {
                        produk_id: { type: 'integer' }, nama: { type: 'string' }, jumlah: { type: 'integer' }, subtotal: { type: 'number' }
                    } } }
                }
            }
        }
    }
};

if (pasangAuth.openapiPaths) {
    Object.assign(openapiSpec.paths, pasangAuth.openapiPaths);
    openapiSpec.tags.push({ name: 'Autentikasi' });
    openapiSpec.components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };
}

/* SWAGGER-AUTH-UI */
const deskripsiTag = {
    Autentikasi: 'Login, logout, profil, dan reset password admin',
    Produk: 'Kelola data produk dan stok',
    Kategori: 'Ringkasan produk per kategori',
    Transaksi: 'Transaksi kasir',
    Dashboard: 'Ringkasan dan grafik pendapatan',
    Laporan: 'Riwayat transaksi'
};
openapiSpec.tags.forEach((t) => { if (deskripsiTag[t.name]) t.description = deskripsiTag[t.name]; });

if (process.env.KONTAK_EMAIL) {
    openapiSpec.info.contact = { name: 'Hubungi pengembang', email: process.env.KONTAK_EMAIL };
}

if (process.env.AUTH_WAJIB === 'true') {
    openapiSpec.security = [{ bearerAuth: [] }];
    for (const p of ['/auth/login', '/auth/lupa-password', '/auth/reset-password']) {
        const op = openapiSpec.paths[p] && openapiSpec.paths[p].post;
        if (op) op.security = [];
    }
}

/* server-url */
app.get('/api/openapi.json', (req, res) => {
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const alamat = proto + '://' + req.get('host') + '/api';
    res.json(Object.assign({}, openapiSpec, { servers: [{ url: alamat, description: 'API Server' }] }));
});

// Halaman Swagger UI: http://localhost:5000/api/docs  (butuh internet untuk memuat tampilan)
app.get('/api/docs', (req, res) => {
    res.type('html').send(
        '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Dokumentasi API - UD. ULFA</title>' +
        '<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">' +
        '</head><body><div id="swagger-ui"></div>' +
        '<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>' +
        '<script>window.ui = SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui", docExpansion: "none", filter: true, persistAuthorization: true, displayRequestDuration: true });</script>' +
        '</body></html>'
    );
});

// Daftar transaksi. Filter opsional: /api/laporan?dari=2026-10-01&sampai=2026-10-31
app.get('/api/laporan', async (req, res) => {
    const { dari, sampai } = req.query;
    const where = [];
    const params = [];
    if (dari) { where.push('tanggal >= ?'); params.push(dari); }
    if (sampai) { where.push('tanggal < ? + INTERVAL 1 DAY'); params.push(sampai); }

    const [rows] = await db.query(
        `SELECT * FROM transaksi ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY tanggal DESC`,
        params
    );
    res.json(rows);
});

// Detail satu transaksi beserta barang yang dibeli
app.get('/api/laporan/:id', async (req, res) => {
    const [trx] = await db.query('SELECT * FROM transaksi WHERE id = ?', [req.params.id]);
    if (trx.length === 0) throw httpError(404, 'Transaksi tidak ditemukan');
    const [items] = await db.query(
        `SELECT d.produk_id, p.nama, d.jumlah, d.subtotal
         FROM detail_transaksi d JOIN produk p ON p.id = d.produk_id
         WHERE d.transaksi_id = ?`,
        [req.params.id]
    );
    res.json({ ...trx[0], items });
});

// =====================================================
// 404 & Error handler (Express 5 otomatis menangkap error dari fungsi async)
// =====================================================
pasangDokumentasi(app);

app.use((req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const pesan = err.code === 'LIMIT_FILE_SIZE' ? 'Ukuran gambar maksimal 2 MB' : err.message;
        return res.status(400).json({ error: pesan });
    }
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan pada server' : err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server Backend UD. ULFA berjalan di http://localhost:${PORT}`);
});