-- Jalankan sekali di MySQL / phpMyAdmin (tab SQL)
CREATE DATABASE IF NOT EXISTS db_ud_ulfa CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE db_ud_ulfa;

CREATE TABLE IF NOT EXISTS produk (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    nama       VARCHAR(150) NOT NULL,
    kategori   VARCHAR(100) NOT NULL,
    harga      DECIMAL(12,2) NOT NULL DEFAULT 0,
    stok       INT NOT NULL DEFAULT 0,
    deskripsi  TEXT,
    gambar     VARCHAR(255) DEFAULT 'https://placehold.co/150',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_produk_harga CHECK (harga >= 0),
    CONSTRAINT chk_produk_stok  CHECK (stok >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transaksi (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    no_transaksi      VARCHAR(50) NOT NULL UNIQUE,
    tanggal           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_harga       DECIMAL(14,2) NOT NULL,
    metode_pembayaran VARCHAR(30) NOT NULL DEFAULT 'Tunai',
    INDEX idx_transaksi_tanggal (tanggal)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_transaksi (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    transaksi_id INT NOT NULL,
    produk_id    INT NOT NULL,
    jumlah       INT NOT NULL,
    subtotal     DECIMAL(14,2) NOT NULL,
    FOREIGN KEY (transaksi_id) REFERENCES transaksi(id) ON DELETE CASCADE,
    FOREIGN KEY (produk_id)    REFERENCES produk(id)    ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Data contoh (opsional)
INSERT INTO produk (nama, kategori, harga, stok, deskripsi) VALUES
('Beras 5 Kg',     'Sembako',  68000, 40, '-'),
('Minyak Goreng 1L','Sembako', 17000, 25, '-'),
('Gula Pasir 1 Kg', 'Sembako', 16500,  4, '-');

CREATE TABLE IF NOT EXISTS pengeluaran (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    keterangan  VARCHAR(255) NOT NULL,
    jumlah      DECIMAL(14,2) NOT NULL,
    tanggal     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pengeluaran_jumlah CHECK (jumlah > 0)
) ENGINE=InnoDB;
