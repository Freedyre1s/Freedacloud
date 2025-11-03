# Pterodactyl WhatsApp Installer Bot

Bot WhatsApp untuk instalasi otomatis Pterodactyl Panel via SSH dengan keamanan berlapis.

## 🎯 Fitur Utama

- ✅ **Owner-only access** dengan verifikasi senderJid (aman di grup)
- ✅ **PIN verification** untuk setiap koneksi
- ✅ **SSH key-based authentication** (tidak pakai password)
- ✅ **Host whitelist** untuk kontrol akses server
- ✅ **Host key pinning** untuk mencegah MITM
- ✅ **Konfirmasi "YA"** sebelum koneksi
- ✅ **Multi-session support** - bisa kelola beberapa VPS sekaligus
- ✅ **Audit logging** - semua aktivitas tercatat dan dikirim ke owner
- ✅ **Panic mode** untuk keadaan darurat
- ✅ **Rate limiting** anti spam
- ✅ **Auto idle timeout** - koneksi ditutup otomatis jika idle

## 🚀 Instalasi

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment Variables

Copy `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

Edit `.env` dan isi dengan konfigurasi Anda:

```env
OWNER_NUMBER=6281234567890        # Nomor WA Anda (tanpa +)
OWNER_PIN=123456                  # PIN 6 digit
SSH_KEY_PATH=/root/.ssh/id_rsa   # Path ke SSH private key
HOST_WHITELIST=                   # Kosongkan untuk allow all
ALLOW_UNOFFICIAL=true             # false untuk produksi
```

### 3. Generate SSH Key (jika belum punya)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@YOUR_VPS_IP
```

### 4. Jalankan Bot

```bash
npm start
```

Scan QR code yang muncul dengan WhatsApp Anda.

## 📱 Cara Penggunaan

### Koneksi ke VPS

```
.connect <PIN> <host> [user] [port]
```

Contoh:
```
.connect 123456 103.12.45.99 root 22
```

Bot akan meminta konfirmasi:
```
YA
```

### Instalasi Pterodactyl

**Install Panel:**
```
.install panel
```

**Install Wings:**
```
.install wings
```

**Install Panel + Wings:**
```
.install both
```

**Safe Install (dengan verifikasi script):**
```
.safeinstall panel
.safeinstall wings
.safeinstall both
```

### Firewall Management

**Buka port untuk Panel (80, 443):**
```
.ufw open panel
```

**Buka port untuk Wings (8080, 2022):**
```
.ufw open wings
```

### Kontrol Shell

**Kirim perintah custom:**
```
.send systemctl status nginx
```

**Tekan ENTER:**
```
.enter
```

**Kirim Ctrl+C:**
```
.ctrlc
```

### Management

**Cek status:**
```
.status
```

**Tutup sesi:**
```
.close
```

**Mode Panic:**
```
.panic
```

**Nonaktifkan panic:**
```
.unpanic
```

**Help:**
```
.help
```

## 🔐 Keamanan

### Owner Verification (FIXED)

Bot menggunakan `senderJid` untuk verifikasi owner, bukan `remoteJid`. Ini penting untuk keamanan di grup:

- **Di DM**: `senderJid = remoteJid` (nomor pengirim)
- **Di Grup**: `senderJid = participant` (nomor member yang ngirim)
- **Balasan**: Selalu ke `chatJid (remoteJid)` biar bisa reply di grup/DM

### UFW Rules (FIXED)

- **Panel**: Hanya buka port **80** dan **443** (HTTP/HTTPS)
- **Wings**: Hanya buka port **8080** dan **2022** (Wings daemon)
- **MySQL 3306**: TIDAK dibuka secara publik (keamanan)

### Safe Install (FIXED)

Mendukung 3 mode: `panel`, `wings`, `both`

```
.safeinstall both
```

Script akan:
1. Download ke `/tmp/ptero.sh`
2. Tampilkan 50 baris pertama
3. Tampilkan SHA256 checksum
4. Eksekusi dengan mode yang dipilih

## 📁 Struktur Project

```
.
├── bot.js              # Main bot code
├── package.json        # Dependencies
├── .env                # Environment variables (jangan commit!)
├── .env.example        # Template environment
├── .gitignore          # Git ignore rules
├── README.md           # Dokumentasi
├── logs/               # Log files (auto-generated)
└── auth_info/          # WhatsApp session (auto-generated)
```

## ⚠️ Security Best Practices

1. **Jangan commit file `.env`**
2. **Gunakan SSH key yang kuat** (ED25519 atau RSA 4096)
3. **Aktifkan HOST_WHITELIST di produksi**
4. **Set ALLOW_UNOFFICIAL=false di produksi**
5. **Gunakan PIN yang kuat** (minimal 6 digit)
6. **Backup SSH key secara aman**
7. **Review log files secara berkala**

## 🐛 Troubleshooting

### Bot tidak connect ke WhatsApp
- Pastikan QR code sudah di-scan
- Cek koneksi internet
- Hapus folder `auth_info/` dan scan ulang

### Koneksi SSH gagal
- Pastikan SSH key sudah di-copy ke VPS
- Cek path SSH key di `.env`
- Coba koneksi manual: `ssh -i ~/.ssh/id_rsa root@IP`
- Pastikan host ada di whitelist

### Output tidak muncul
- Tunggu beberapa detik (output dikirim berkala)
- Gunakan `.status` untuk cek koneksi
- Gunakan `.send` untuk perintah manual

## 📝 Changelog

### v1.0.0

✅ **Fixed owner verification** - Menggunakan `senderJid` untuk cek owner (aman di grup)  
✅ **Fixed .safeinstall** - Mendukung mode `both` (panel + wings)  
✅ **Fixed UFW rules** - Panel hanya buka 80/443 (tidak buka MySQL 3306)  
✅ **Improved security** - Multi-layer authentication  
✅ **Complete implementation** - Semua fitur sesuai spesifikasi

## ⚖️ License

MIT License - Gunakan dengan bijak dan tanggung jawab.

## ⚠️ Disclaimer

Bot ini adalah tool untuk memudahkan instalasi Pterodactyl Panel. Pengguna bertanggung jawab penuh atas penggunaan bot ini. Pastikan Anda memahami risiko keamanan sebelum menggunakan di lingkungan produksi.

**JANGAN** share SSH key, PIN, atau credential apapun!

---

Made with ❤️ using Baileys & SSH2
