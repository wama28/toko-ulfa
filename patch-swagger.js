const fs = require('fs');
const { execFileSync } = require('child_process');

const berkas = 'server.js';
const asli = fs.readFileSync(berkas, 'utf8');
const eol = asli.includes('\r\n') ? '\r\n' : '\n';
let s = asli.replace(/\r\n/g, '\n');

if (s.includes('/* SWAGGER-DOCS */')) {
    console.log('Swagger sudah terpasang, tidak ada yang diubah.');
    process.exit(0);
}

const penanda = '// Daftar transaksi. Filter opsional';
if (!s.includes(penanda)) {
    console.error('GAGAL: titik penyisipan tidak ditemukan. server.js tidak diubah.');
    process.exit(1);
}

const tambahan = `/* SWAGGER-DOCS */
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

app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));

// Halaman Swagger UI: http://localhost:5000/api/docs  (butuh internet untuk memuat tampilan)
app.get('/api/docs', (req, res) => {
    res.type('html').send(
        '<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>Dokumentasi API - UD. ULFA</title>' +
        '<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css">' +
        '</head><body><div id="swagger-ui"></div>' +
        '<script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>' +
        '<script>window.ui = SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui", docExpansion: "list" });</script>' +
        '</body></html>'
    );
});

`;

s = s.replace(penanda, () => tambahan + penanda);

const barisDokumentasi = "            'GET /api/documentation'";
if (s.includes(barisDokumentasi) && !s.includes("'GET /api/docs (Swagger UI)'")) {
    s = s.replace(barisDokumentasi, () => "            'GET /api/docs (Swagger UI)',\n" + barisDokumentasi);
}

fs.writeFileSync('server.js.bak4', asli);
fs.writeFileSync(berkas, s.replace(/\n/g, eol));

try {
    execFileSync(process.execPath, ['--check', berkas], { stdio: 'pipe' });
} catch (e) {
    fs.writeFileSync(berkas, asli);
    console.error('GAGAL: hasil perubahan tidak valid, server.js dikembalikan seperti semula.');
    process.exit(1);
}
console.log('Selesai. Swagger UI terpasang di /api/docs (cadangan: server.js.bak4).');
