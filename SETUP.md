# Setup Guide - Pterodactyl WhatsApp Bot

## 🚀 Quick Start

### Step 1: Configure Environment Variables

**Important**: Never hardcode sensitive information. Create your own `.env` file:

```bash
cp .env.example .env
```

Then edit `.env` and add your configuration:

```env
# REQUIRED: Your WhatsApp number (no + symbol)
OWNER_NUMBER=6281234567890

# REQUIRED: A secure 6-digit PIN
OWNER_PIN=123456

# RECOMMENDED: Path to your SSH private key
SSH_KEY_PATH=/home/user/.ssh/id_ed25519

# OPTIONAL: Whitelist specific hosts (comma-separated)
# Leave empty to allow all hosts
HOST_WHITELIST=

# OPTIONAL: Host key verification (recommended for production)
HOSTKEY_SHA256_MAP={}

# OPTIONAL: Security settings
ALLOW_UNOFFICIAL=true
RATE_LIMIT_MS=1200
SESSION_IDLE_MS=600000

# NOT RECOMMENDED: Password authentication
SSH_USE_PASSWORD=false
SSH_PASSWORD=
```

### Step 2: Generate SSH Key (if you don't have one)

**ED25519 (Recommended):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "pterodactyl-bot"
```

**RSA (Alternative):**
```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -C "pterodactyl-bot"
```

**Copy public key to your VPS:**
```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@YOUR_VPS_IP
```

**Test the connection:**
```bash
ssh -i ~/.ssh/id_ed25519 root@YOUR_VPS_IP
```

If you can login without password, you're ready!

### Step 3: Start the Bot

```bash
npm start
```

You'll see a QR code in the terminal. Scan it with WhatsApp on your phone:

1. Open WhatsApp on your phone
2. Go to: Settings → Linked Devices → Link a Device
3. Scan the QR code

### Step 4: Test the Bot

Send a message to your bot (the WhatsApp number you scanned with):

```
.help
```

You should receive the help menu!

## 🔐 Security Configuration

### Host Whitelist (Production Recommended)

To restrict which servers the bot can connect to:

```env
HOST_WHITELIST=103.12.45.99,panel.example.com,192.168.1.100
```

### Host Key Pinning (Production Recommended)

To prevent MITM attacks, pin SSH host keys:

1. Get the host key fingerprint:
```bash
ssh-keyscan -H YOUR_VPS_IP | ssh-keygen -lf - -E sha256
```

2. Add to `.env`:
```env
HOSTKEY_SHA256_MAP={"YOUR_VPS_IP":"base64_sha256_fingerprint_here"}
```

3. Disable unofficial hosts:
```env
ALLOW_UNOFFICIAL=false
```

### Strong PIN

Use a strong, random 6-digit PIN:

```bash
# Generate random PIN
echo $((100000 + RANDOM % 900000))
```

## 📝 Usage Examples

### Connect to VPS

```
.connect 123456 103.12.45.99 root 22
```

Then confirm:
```
YA
```

### Install Pterodactyl Panel

```
.install panel
```

### Safe Install (with verification)

```
.safeinstall both
```

This will:
1. Download script to `/tmp/ptero.sh`
2. Show first 50 lines
3. Show SHA256 checksum
4. Execute with selected mode

### Configure Firewall

```
.ufw open panel
.ufw open wings
```

**Note**: 
- Panel opens: 80, 443 (HTTP/HTTPS only)
- Wings opens: 8080, 2022 (Wings daemon only)
- MySQL port 3306 is NOT opened publicly for security

### Send Custom Commands

```
.send systemctl status nginx
.send df -h
.send free -m
```

### Close Session

```
.close
```

You'll receive the audit log file via WhatsApp.

## 🛡️ Security Best Practices

### ✅ DO

- ✅ Use SSH key-based authentication
- ✅ Use strong, random PINs
- ✅ Enable host whitelist in production
- ✅ Enable host key pinning in production
- ✅ Review audit logs regularly
- ✅ Keep `.env` file secure and never commit it
- ✅ Use `ALLOW_UNOFFICIAL=false` in production

### ❌ DON'T

- ❌ Don't use password-based SSH authentication
- ❌ Don't share your SSH private key
- ❌ Don't commit `.env` file to git
- ❌ Don't use weak or obvious PINs
- ❌ Don't disable host verification in production
- ❌ Don't expose MySQL port 3306 publicly

## 🔧 Troubleshooting

### Bot won't start - "OWNER_NUMBER must be set"

**Solution**: Create `.env` file with your WhatsApp number:
```bash
cp .env.example .env
# Edit .env and set OWNER_NUMBER
```

### SSH connection fails

**Solution**: Check SSH key setup:
```bash
# Test SSH connection manually
ssh -i ~/.ssh/id_ed25519 root@YOUR_VPS_IP

# If fails, copy key again
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@YOUR_VPS_IP
```

### "Host not in whitelist"

**Solution**: Add host to whitelist in `.env`:
```env
HOST_WHITELIST=YOUR_VPS_IP
```

Or leave empty to allow all:
```env
HOST_WHITELIST=
```

### WhatsApp disconnects

**Solution**: Delete session and rescan:
```bash
rm -rf auth_info/
npm start
# Scan QR code again
```

### Bot doesn't respond in groups

**Solution**: The bot now properly supports groups! It checks the sender's JID (not the group's JID) for owner verification. Make sure your personal number matches `OWNER_NUMBER`.

## 📊 Understanding Owner Verification

The bot uses **senderJid** for security checks:

- **In Direct Messages**: `senderJid = your WhatsApp number`
- **In Group Chats**: `senderJid = your WhatsApp number` (not the group's number)

This means the bot works correctly in both DMs and groups, always checking who actually sent the message.

## 🎯 Next Steps

1. ✅ Configure `.env` with your settings
2. ✅ Generate SSH key and copy to VPS
3. ✅ Start bot and scan QR code
4. ✅ Test with `.help` command
5. ✅ Connect to VPS with `.connect`
6. ✅ Install Pterodactyl Panel

## 📞 Support

If you encounter issues:

1. Check the workflow logs in Replit console
2. Review `logs/` directory for SSH session logs
3. Verify `.env` configuration
4. Test SSH connection manually
5. Check WhatsApp connection status

---

**Security Reminder**: This bot provides remote server access. Always:
- Use strong authentication
- Review audit logs
- Keep credentials secure
- Follow security best practices

Happy automating! 🚀
