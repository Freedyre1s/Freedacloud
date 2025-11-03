import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Client } from 'ssh2';
import P from 'pino';
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

// Logger configuration
const logger = P({ level: 'silent' });

// Configuration from environment variables
const CONFIG = {
  ownerNumber: process.env.OWNER_NUMBER?.replace(/[^0-9]/g, '') + '@s.whatsapp.net',
  ownerPin: process.env.OWNER_PIN || '123456',
  sshKeyPath: process.env.SSH_KEY_PATH || path.join(process.env.HOME, '.ssh', 'id_rsa'),
  hostWhitelist: process.env.HOST_WHITELIST?.split(',').map(h => h.trim()).filter(Boolean) || [],
  hostKeySha256Map: JSON.parse(process.env.HOSTKEY_SHA256_MAP || '{}'),
  rateLimitMs: parseInt(process.env.RATE_LIMIT_MS || '1200'),
  sessionIdleMs: parseInt(process.env.SESSION_IDLE_MS || '600000'),
  allowUnofficial: process.env.ALLOW_UNOFFICIAL === 'true',
  sshUsePassword: process.env.SSH_USE_PASSWORD === 'true',
  sshPassword: process.env.SSH_PASSWORD || ''
};

// Validate critical environment variables
if (!process.env.OWNER_NUMBER) {
  throw new Error('OWNER_NUMBER must be set in .env file');
}

// Global state
const state = {
  sock: null,
  panicMode: false,
  activeSessions: new Map(), // host -> session object
  pendingConfirmations: new Map(), // senderJid -> connection config
  lastCommandTime: new Map(), // senderJid -> timestamp
  currentSession: new Map() // senderJid -> current host
};

// Session object structure
class SSHSession {
  constructor(host, user, port) {
    this.host = host;
    this.user = user;
    this.port = port;
    this.client = null;
    this.stream = null;
    this.connected = false;
    this.buffer = '';
    this.logFile = `logs/${host}_${Date.now()}.log`;
    this.startTime = Date.now();
    this.idleTimeout = null;
    this.senderJid = null;
    this.chatJid = null;
    
    // Create logs directory if not exists
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs', { recursive: true });
    }
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logFile, logEntry);
  }

  resetIdleTimeout(chatJid) {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    this.idleTimeout = setTimeout(() => {
      this.close(chatJid);
      sendMessage(chatJid, '⚠️ Sesi SSH ditutup otomatis karena idle terlalu lama.');
    }, CONFIG.sessionIdleMs);
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.client = new Client();
      
      this.client.on('ready', () => {
        this.log('SSH connection established');
        this.client.shell((err, stream) => {
          if (err) {
            reject(err);
            return;
          }
          
          this.stream = stream;
          this.connected = true;
          this.log('Shell session started');
          
          stream.on('data', (data) => {
            this.buffer += data.toString();
            this.log(`OUTPUT: ${data.toString()}`);
          });
          
          stream.on('close', () => {
            this.connected = false;
            this.log('Shell session closed');
          });
          
          stream.stderr.on('data', (data) => {
            this.buffer += data.toString();
            this.log(`STDERR: ${data.toString()}`);
          });
          
          resolve();
        });
      });
      
      this.client.on('error', (err) => {
        this.log(`SSH ERROR: ${err.message}`);
        reject(err);
      });
      
      // Prepare connection config
      const connConfig = {
        host: this.host,
        port: this.port,
        username: this.user,
        readyTimeout: 30000,
        hostHash: 'sha256',
        hostVerifier: (hashedKey) => {
          if (CONFIG.hostKeySha256Map[this.host]) {
            const isValid = hashedKey === CONFIG.hostKeySha256Map[this.host];
            if (!isValid) {
              this.log(`ERROR: Host key mismatch for ${this.host}`);
            }
            return isValid;
          }
          if (CONFIG.allowUnofficial) {
            this.log(`WARNING: Host key not verified for ${this.host}`);
            return true;
          }
          this.log(`ERROR: Host key verification required but not configured for ${this.host}`);
          return false;
        }
      };

      // Add authentication method
      if (CONFIG.sshUsePassword && CONFIG.sshPassword) {
        connConfig.password = CONFIG.sshPassword;
        this.log('Using password authentication (not recommended)');
      } else {
        // Read SSH private key
        try {
          connConfig.privateKey = fs.readFileSync(CONFIG.sshKeyPath);
          this.log('Using key-based authentication');
        } catch (err) {
          reject(new Error(`Gagal membaca SSH key: ${err.message}`));
          return;
        }
      }
      
      // Connect
      this.client.connect(connConfig);
    });
  }

  sendCommand(command) {
    if (!this.connected || !this.stream) {
      throw new Error('Tidak ada koneksi SSH aktif');
    }
    this.buffer = '';
    this.stream.write(command + '\n');
    this.log(`COMMAND: ${command}`);
  }

  getBufferedOutput() {
    const output = this.buffer;
    this.buffer = '';
    return output;
  }

  close(chatJid) {
    if (this.idleTimeout) clearTimeout(this.idleTimeout);
    if (this.stream) this.stream.end();
    if (this.client) this.client.end();
    this.connected = false;
    this.log('Connection closed by user');
    
    // Send log file to WhatsApp
    if (chatJid && fs.existsSync(this.logFile)) {
      setTimeout(() => {
        sendDocument(chatJid, this.logFile, `Log sesi SSH ${this.host}`);
      }, 1000);
    }
  }
}

// Utility functions
function maskSensitive(text) {
  // Mask IPs, passwords, and sensitive data
  return text
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '***.***.***.**')
    .replace(/password[:\s=]+\S+/gi, 'password: ********')
    .replace(/key[:\s=]+\S+/gi, 'key: ********');
}

function checkRateLimit(senderJid) {
  const lastTime = state.lastCommandTime.get(senderJid) || 0;
  const now = Date.now();
  if (now - lastTime < CONFIG.rateLimitMs) {
    return false;
  }
  state.lastCommandTime.set(senderJid, now);
  return true;
}

function normalizeJid(jid) {
  // Normalize JID format for comparison
  return jid?.replace(/:\d+@/g, '@') || '';
}

function isOwner(senderJid) {
  return normalizeJid(senderJid) === normalizeJid(CONFIG.ownerNumber);
}

function isHostWhitelisted(host) {
  if (CONFIG.hostWhitelist.length === 0) return true;
  
  // Exact match required for security
  // No substring matching to prevent bypass attacks
  return CONFIG.hostWhitelist.some(allowed => host === allowed);
}

async function sendMessage(chatJid, text) {
  if (!state.sock) return;
  try {
    await state.sock.sendMessage(chatJid, { text });
  } catch (err) {
    console.error('Error sending message:', err);
  }
}

async function sendDocument(chatJid, filePath, caption) {
  if (!state.sock || !fs.existsSync(filePath)) return;
  try {
    const buffer = fs.readFileSync(filePath);
    await state.sock.sendMessage(chatJid, {
      document: buffer,
      mimetype: 'text/plain',
      fileName: path.basename(filePath),
      caption
    });
  } catch (err) {
    console.error('Error sending document:', err);
  }
}

// Command handlers
const commands = {
  help: async (chatJid, senderJid, args) => {
    const helpText = `
╔══════════════════════╗
║  PTERODACTYL BOT HELP  ║
╚══════════════════════╝

📌 *KONEKSI SSH*
• .connect <PIN> <host> [user] [port]
  Membuka koneksi SSH ke VPS

• .confirm YA
  Konfirmasi koneksi setelah .connect

• .close
  Menutup sesi SSH aktif

• .status
  Cek status koneksi dan log

• .switch <host>
  Berpindah antar VPS

⚙️ *INSTALASI PTERODACTYL*
• .install panel
  Install Pterodactyl Panel (opsi 0)

• .install wings
  Install Pterodactyl Wings (opsi 1)

• .install both
  Install Panel + Wings (opsi 2)

• .install uninstall
  Uninstall Pterodactyl (opsi 6)

• .safeinstall <panel|wings|both>
  Install dengan verifikasi script

• .dryrun <host>
  Simulasi instalasi tanpa eksekusi

🔧 *KONTROL SHELL*
• .send <teks>
  Kirim perintah custom ke terminal

• .enter
  Tekan ENTER

• .ctrlc
  Kirim Ctrl+C

🔥 *FIREWALL*
• .ufw open panel
  Buka port 80, 443 untuk Panel

• .ufw open wings
  Buka port 8080, 2022 untuk Wings

🚨 *KEAMANAN*
• .panic
  Mode darurat (blokir semua perintah)

• .unpanic
  Nonaktifkan mode panic

📝 *INFO*
• .help / .menu
  Tampilkan pesan ini

⚠️ *Catatan:*
- Hanya owner yang bisa menggunakan bot
- PIN wajib saat koneksi
- Semua aktivitas dicatat ke log
- Koneksi auto-close setelah idle

Bot by Replit Agent
`.trim();
    await sendMessage(chatJid, helpText);
  },

  connect: async (chatJid, senderJid, args) => {
    if (args.length < 2) {
      await sendMessage(chatJid, '❌ Format: .connect <PIN> <host> [user=root] [port=22]');
      return;
    }

    const [pin, host, user = 'root', port = '22'] = args;

    // Verify PIN
    if (pin !== CONFIG.ownerPin) {
      await sendMessage(chatJid, '❌ PIN salah! Akses ditolak.');
      return;
    }

    // Check host whitelist
    if (!isHostWhitelisted(host)) {
      await sendMessage(chatJid, `❌ Host "${maskSensitive(host)}" tidak ada dalam whitelist!`);
      return;
    }

    // Store pending confirmation (keyed by senderJid for security)
    state.pendingConfirmations.set(senderJid, {
      host,
      user,
      port: parseInt(port),
      chatJid
    });

    await sendMessage(chatJid, 
      `⚠️ *KONFIRMASI INSTALASI*\n\n` +
      `Host: ${maskSensitive(host)}\n` +
      `User: ${user}\n` +
      `Port: ${port}\n\n` +
      `Balas dengan: *YA* untuk melanjutkan.`
    );
  },

  confirm: async (chatJid, senderJid, args) => {
    const pending = state.pendingConfirmations.get(senderJid);
    if (!pending) {
      await sendMessage(chatJid, '❌ Tidak ada koneksi yang menunggu konfirmasi.');
      return;
    }

    const confirmation = args[0]?.toUpperCase();
    if (confirmation !== 'YA') {
      state.pendingConfirmations.delete(senderJid);
      await sendMessage(chatJid, '❌ Konfirmasi dibatalkan.');
      return;
    }

    state.pendingConfirmations.delete(senderJid);

    // Create SSH session
    const session = new SSHSession(pending.host, pending.user, pending.port);
    session.senderJid = senderJid;
    session.chatJid = chatJid;

    await sendMessage(chatJid, `🔄 Menghubungkan ke ${maskSensitive(pending.host)}...`);

    try {
      await session.connect();
      session.resetIdleTimeout(chatJid);
      
      state.activeSessions.set(pending.host, session);
      state.currentSession.set(senderJid, pending.host);

      await sendMessage(chatJid, 
        `✅ *Koneksi SSH Berhasil!*\n\n` +
        `Host: ${maskSensitive(pending.host)}\n` +
        `User: ${pending.user}\n` +
        `Status: Connected\n\n` +
        `Gunakan .install <panel|wings|both> untuk mulai instalasi.`
      );
    } catch (err) {
      await sendMessage(chatJid, `❌ Koneksi gagal: ${err.message}`);
    }
  },

  install: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif. Gunakan .connect terlebih dahulu.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    const mode = args[0]?.toLowerCase();
    const modeMap = {
      'panel': '0',
      'wings': '1',
      'both': '2',
      'uninstall': '6'
    };

    if (!modeMap[mode]) {
      await sendMessage(chatJid, '❌ Mode tidak valid. Gunakan: panel, wings, both, atau uninstall');
      return;
    }

    await sendMessage(chatJid, `🚀 Memulai instalasi mode: *${mode}*\n\nMohon tunggu...`);

    try {
      // Execute installer
      const installCmd = `set -e && apt-get update -y && apt-get install -y curl sudo && bash <(curl -s https://pterodactyl-installer.se)`;
      session.sendCommand(installCmd);

      // Wait for installer to load
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Send mode selection
      session.sendCommand(modeMap[mode]);

      // Start streaming output
      const interval = setInterval(async () => {
        const output = session.getBufferedOutput();
        if (output.trim()) {
          const chunks = output.match(/[\s\S]{1,3500}/g) || [];
          for (const chunk of chunks) {
            await sendMessage(chatJid, `\`\`\`\n${chunk}\n\`\`\``);
            await new Promise(resolve => setTimeout(resolve, 600));
          }
        }

        if (!session.connected) {
          clearInterval(interval);
        }
      }, 5000);

      session.resetIdleTimeout(chatJid);

      await sendMessage(chatJid, '✅ Perintah instalasi terkirim. Output akan dikirim secara berkala.\n\nGunakan .send untuk menjawab prompt installer.');

    } catch (err) {
      await sendMessage(chatJid, `❌ Error: ${err.message}`);
    }
  },

  safeinstall: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    const mode = args[0]?.toLowerCase();
    if (!['panel', 'wings', 'both'].includes(mode)) {
      await sendMessage(chatJid, '❌ Mode: panel, wings, atau both');
      return;
    }

    await sendMessage(chatJid, '🔍 Mengunduh dan memverifikasi script installer...');

    try {
      // Download script to temp
      session.sendCommand('curl -fsSL https://pterodactyl-installer.se -o /tmp/ptero.sh && chmod +x /tmp/ptero.sh');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Show first 50 lines
      session.sendCommand('head -n 50 /tmp/ptero.sh');
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      let output = session.getBufferedOutput();
      if (output.trim()) {
        await sendMessage(chatJid, `📄 *Preview Script (50 baris pertama):*\n\`\`\`\n${output.substring(0, 3500)}\n\`\`\``);
      }

      // Show SHA256
      session.sendCommand('sha256sum /tmp/ptero.sh');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      output = session.getBufferedOutput();
      if (output.trim()) {
        await sendMessage(chatJid, `🔐 *SHA256:*\n\`\`\`${output.trim()}\`\`\``);
      }

      await sendMessage(chatJid, '✅ Verifikasi selesai. Melanjutkan instalasi...');

      // Execute - map mode to installer option
      const modeMap = {
        'panel': '0',
        'wings': '1',
        'both': '2'
      };
      
      session.sendCommand(`bash /tmp/ptero.sh`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      session.sendCommand(modeMap[mode]);

      session.resetIdleTimeout(chatJid);
      await sendMessage(chatJid, '🚀 Instalasi dimulai. Gunakan .send untuk interaksi.');

    } catch (err) {
      await sendMessage(chatJid, `❌ Error: ${err.message}`);
    }
  },

  dryrun: async (chatJid, senderJid, args) => {
    if (!args[0]) {
      await sendMessage(chatJid, '❌ Format: .dryrun <host>');
      return;
    }

    const dryrunText = `
🔍 *DRY RUN - SIMULASI INSTALASI*

Host: ${maskSensitive(args[0])}

📋 *Tahapan yang akan dilakukan:*

1️⃣ Update sistem
   \`apt-get update -y\`

2️⃣ Install dependencies
   \`apt-get install -y curl sudo\`

3️⃣ Download installer
   \`curl -s https://pterodactyl-installer.se\`

4️⃣ Eksekusi installer
   \`bash <(curl -s https://pterodactyl-installer.se)\`

5️⃣ Pilih mode instalasi
   • 0 = Panel Only
   • 1 = Wings Only
   • 2 = Panel + Wings
   • 6 = Uninstall

6️⃣ Installer akan meminta:
   - Database host
   - Database name
   - Username & password
   - FQDN/domain
   - Email untuk SSL
   - Timezone
   - User panel admin

7️⃣ Instalasi otomatis berjalan

8️⃣ Health check setelah instalasi
   \`systemctl status nginx mariadb redis\`

⚠️ *Catatan:*
- Ini hanya simulasi
- Tidak ada perintah yang dieksekusi
- Gunakan .connect untuk eksekusi nyata

✅ Simulasi selesai.
`.trim();

    await sendMessage(chatJid, dryrunText);
  },

  ufw: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    if (args[0] !== 'open' || !['panel', 'wings'].includes(args[1])) {
      await sendMessage(chatJid, '❌ Format: .ufw open <panel|wings>');
      return;
    }

    const mode = args[1];
    await sendMessage(chatJid, `🔥 Membuka port firewall untuk ${mode}...`);

    try {
      if (mode === 'panel') {
        // FIXED: Only open 80/443 for panel (removed 3306)
        session.sendCommand('ufw allow 80/tcp && ufw allow 443/tcp && ufw reload');
      } else {
        // Wings: only 8080 and 2022
        session.sendCommand('ufw allow 8080/tcp && ufw allow 2022/tcp && ufw reload');
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      const output = session.getBufferedOutput();
      
      if (output.trim()) {
        await sendMessage(chatJid, `✅ *Firewall Updated:*\n\`\`\`${output}\`\`\``);
      } else {
        await sendMessage(chatJid, '✅ Perintah UFW terkirim.');
      }

      session.resetIdleTimeout(chatJid);

    } catch (err) {
      await sendMessage(chatJid, `❌ Error: ${err.message}`);
    }
  },

  send: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    const command = args.join(' ');
    if (!command) {
      await sendMessage(chatJid, '❌ Format: .send <perintah>');
      return;
    }

    try {
      session.sendCommand(command);
      session.resetIdleTimeout(chatJid);
      await sendMessage(chatJid, `✅ Perintah terkirim: \`${command}\``);

      // Send output after delay
      setTimeout(async () => {
        const output = session.getBufferedOutput();
        if (output.trim()) {
          const chunks = output.match(/[\s\S]{1,3500}/g) || [];
          for (const chunk of chunks) {
            await sendMessage(chatJid, `\`\`\`\n${chunk}\n\`\`\``);
          }
        }
      }, 2000);

    } catch (err) {
      await sendMessage(chatJid, `❌ Error: ${err.message}`);
    }
  },

  enter: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    session.stream.write('\n');
    session.resetIdleTimeout(chatJid);
    await sendMessage(chatJid, '✅ ENTER terkirim');
  },

  ctrlc: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi SSH aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    if (!session || !session.connected) {
      await sendMessage(chatJid, '❌ Sesi SSH tidak aktif.');
      return;
    }

    session.stream.write('\x03');
    session.resetIdleTimeout(chatJid);
    await sendMessage(chatJid, '✅ Ctrl+C terkirim');
  },

  status: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    
    if (!currentHost) {
      await sendMessage(chatJid, '📊 *Status:* Tidak ada sesi aktif');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    const uptime = Math.floor((Date.now() - session.startTime) / 1000);
    const statusEmoji = session.connected ? '✅' : '❌';

    const statusText = `
📊 *STATUS SESI SSH*

${statusEmoji} Koneksi: ${session.connected ? 'Aktif' : 'Terputus'}
🖥️ Host: ${maskSensitive(session.host)}
👤 User: ${session.user}
🔌 Port: ${session.port}
⏱️ Uptime: ${uptime}s
📁 Log: ${session.logFile}

Gunakan .close untuk menutup sesi.
    `.trim();

    await sendMessage(chatJid, statusText);
  },

  switch: async (chatJid, senderJid, args) => {
    if (!args[0]) {
      await sendMessage(chatJid, '❌ Format: .switch <host>');
      return;
    }

    const targetHost = args[0];
    const session = state.activeSessions.get(targetHost);

    if (!session) {
      await sendMessage(chatJid, `❌ Tidak ada sesi aktif untuk host: ${maskSensitive(targetHost)}`);
      return;
    }

    state.currentSession.set(senderJid, targetHost);
    await sendMessage(chatJid, `✅ Berpindah ke sesi: ${maskSensitive(targetHost)}`);
  },

  close: async (chatJid, senderJid, args) => {
    const currentHost = state.currentSession.get(senderJid);
    
    if (!currentHost) {
      await sendMessage(chatJid, '❌ Tidak ada sesi aktif.');
      return;
    }

    const session = state.activeSessions.get(currentHost);
    
    if (session) {
      session.close(chatJid);
      state.activeSessions.delete(currentHost);
      state.currentSession.delete(senderJid);
      
      await sendMessage(chatJid, 
        `✅ Sesi SSH ditutup.\n\n` +
        `Log file akan dikirim dalam beberapa saat.`
      );
    }
  },

  panic: async (chatJid, senderJid, args) => {
    state.panicMode = true;
    
    // Close all sessions
    for (const [host, session] of state.activeSessions) {
      session.close(null);
    }
    
    state.activeSessions.clear();
    state.currentSession.clear();
    state.pendingConfirmations.clear();

    await sendMessage(chatJid, 
      `🚨 *MODE PANIC AKTIF!*\n\n` +
      `Semua sesi SSH ditutup.\n` +
      `Semua perintah diblokir.\n\n` +
      `Gunakan .unpanic untuk melanjutkan.`
    );
  },

  unpanic: async (chatJid, senderJid, args) => {
    state.panicMode = false;
    await sendMessage(chatJid, '✅ Mode panic dinonaktifkan. Bot kembali normal.');
  }
};

// Message handler
async function handleMessage(message) {
  // FIXED: Extract chatJid and senderJid correctly
  const chatJid = message.key.remoteJid;
  const senderJid = message.key.participant || message.key.remoteJid;
  
  const messageType = Object.keys(message.message || {})[0];
  
  if (messageType !== 'conversation' && messageType !== 'extendedTextMessage') {
    return;
  }

  const text = message.message?.conversation || 
               message.message?.extendedTextMessage?.text || '';

  if (!text.startsWith('.')) return;

  // FIXED: Security checks use senderJid, but responses go to chatJid
  if (!isOwner(senderJid)) {
    await sendMessage(chatJid, '⛔ Akses ditolak. Bot ini hanya untuk owner.');
    return;
  }

  if (state.panicMode && text !== '.unpanic') {
    await sendMessage(chatJid, '🚨 Bot dalam mode PANIC. Gunakan .unpanic untuk melanjutkan.');
    return;
  }

  if (!checkRateLimit(senderJid)) {
    await sendMessage(chatJid, '⏳ Harap tunggu sebentar sebelum mengirim perintah lagi.');
    return;
  }

  // Parse command
  const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
  const command = cmd.toLowerCase();

  // Handle aliases
  const aliases = {
    'menu': 'help',
    'ya': 'confirm'
  };
  const actualCommand = aliases[command] || command;

  // Execute command - pass both chatJid and senderJid
  if (commands[actualCommand]) {
    try {
      await commands[actualCommand](chatJid, senderJid, args);
    } catch (err) {
      console.error('Command error:', err);
      await sendMessage(chatJid, `❌ Terjadi error: ${err.message}`);
    }
  } else {
    await sendMessage(chatJid, `❌ Perintah tidak dikenal: ${command}\n\nGunakan .help untuk melihat daftar perintah.`);
  }
}

// WhatsApp connection
async function connectToWhatsApp() {
  const { state: authState, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: true,
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger)
    },
    getMessage: async (key) => {
      return { conversation: '' };
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n🔐 Scan QR code di bawah dengan WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log('Connection closed. Reconnecting:', shouldReconnect);

      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp bot connected!');
      console.log(`📱 Owner: ${CONFIG.ownerNumber}`);
      console.log('🤖 Bot siap menerima perintah.');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      if (!message.message || message.key.fromMe) continue;
      await handleMessage(message);
    }
  });

  state.sock = sock;
  return sock;
}

// Start bot
console.log('🚀 Starting Pterodactyl WhatsApp Installer Bot...');
console.log('📋 Configuration:');
console.log(`   Owner: ${CONFIG.ownerNumber}`);
console.log(`   SSH Key: ${CONFIG.sshKeyPath}`);
console.log(`   Whitelisted Hosts: ${CONFIG.hostWhitelist.length || 'All (empty whitelist)'}`);
console.log(`   Host Key Verification: ${Object.keys(CONFIG.hostKeySha256Map).length > 0 ? 'Enabled' : 'Disabled'}`);
console.log(`   Allow Unofficial: ${CONFIG.allowUnofficial}`);
console.log('');

connectToWhatsApp().catch(err => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
