# Pterodactyl WhatsApp Installer Bot

## Overview

This is a WhatsApp bot that automates the installation of Pterodactyl Panel (a game server management panel) on remote VPS servers via SSH connections. The bot provides a conversational interface through WhatsApp, allowing authorized users to remotely execute installation scripts on their servers with real-time terminal output streamed back to the chat.

The system prioritizes security through multiple authentication layers including owner-only access (using **senderJid for proper group support**), PIN verification, host whitelisting (exact match), and SSH key-based authentication (password-less connections). It supports managing multiple concurrent SSH sessions to different servers and includes safety features like panic mode and activity logging.

**Status**: ✅ Complete and fully tested. All security features implemented and verified.

**Last Updated**: November 3, 2025

## Recent Changes

### November 3, 2025 - Complete Rewrite with Security Fixes

**Critical Security Fixes:**

1. ✅ **Fixed owner verification** - Now uses `senderJid` instead of `remoteJid`
   - In groups: Checks `message.key.participant` (the actual sender)
   - In DMs: Checks `message.key.remoteJid` (the chat)
   - Replies always go to `chatJid` (remoteJid) for proper group/DM support

2. ✅ **Fixed .safeinstall command** - Now supports all 3 modes:
   - `panel` (mode 0)
   - `wings` (mode 1)
   - `both` (mode 2) - **NEWLY ADDED**

3. ✅ **Fixed UFW firewall rules**:
   - Panel: Only opens ports **80** and **443** (HTTP/HTTPS)
   - Wings: Only opens ports **8080** and **2022** (Wings daemon)
   - **Removed MySQL port 3306** from public access (security improvement)

4. ✅ **Improved help text** - Updated to show `.safeinstall <panel|wings|both>`

**Implementation Details:**

- All commands now receive both `chatJid` and `senderJid` parameters
- Security checks use `senderJid` for owner verification
- All responses are sent to `chatJid` for proper routing
- State management uses `senderJid` for session tracking
- Multi-session support with proper isolation

## User Preferences

- **Communication style**: Simple, everyday language in Bahasa Indonesia
- **Security first**: All sensitive operations require explicit confirmation
- **No placeholders**: Only real, authenticated connections allowed

## System Architecture

### Authentication & Security Model

The application implements a multi-layered security approach:

**Owner Verification (FIXED)**: Uses `message.key.participant || message.key.remoteJid` as `senderJid` to identify the actual sender, especially important in group chats. Only the WhatsApp number configured in `OWNER_NUMBER` is authorized.

**PIN Authentication**: Users must provide a 6-digit PIN before executing sensitive operations.

**Host Whitelisting**: Optional whitelist restricts which VPS IP addresses/domains can be connected to.

**SSH Key-Based Authentication**: Exclusively uses SSH private keys for server connections (password auth is optional but disabled by default).

**Host Key Pinning**: Optional verification of SSH host fingerprints to prevent MITM attacks.

**Confirmation Prompts**: Critical operations require explicit "YA" confirmation before execution.

**Panic Mode**: Emergency kill switch that terminates all SSH sessions and blocks commands.

**Rate Limiting**: Prevents command flooding with configurable cooldown periods.

**Audit Logging**: All SSH activities are logged to files and sent to owner when sessions close.

### WhatsApp Integration Architecture

**Baileys Library**: Uses `@whiskeysockets/baileys` as the core WhatsApp Web client.

**Multi-File Auth State**: Implements persistent authentication to avoid repeated QR scanning.

**QR Code Authentication**: On first run, generates a terminal QR code for linking.

**Message Event Handling**: Processes text-based commands with proper sender identification:
- `chatJid = message.key.remoteJid` (where to reply)
- `senderJid = message.key.participant || message.key.remoteJid` (who sent it)

**Real-time Streaming**: SSH terminal output is debounced and chunked before sending to WhatsApp.

### SSH Session Management

**Session Pooling**: Maintains a map of active SSH connections indexed by hostname.

**Multi-User Support**: Each user (`senderJid`) can have their own active session.

**Idle Timeout**: Automatically disconnects SSH sessions after configured inactivity period.

**Stream Multiplexing**: Uses SSH2 shell streams with separate stdout/stderr handling.

**Audit Trail**: Each session creates a timestamped log file sent to owner on close.

### Command Processing Architecture

**Dual JID Handling**: Commands receive both `chatJid` (reply target) and `senderJid` (security check).

**Command Routing**: Text commands are parsed and routed to appropriate handlers.

**Interactive Flow**: Multi-step interactions (confirmation, PIN) use state maps keyed by `senderJid`.

**Context Awareness**: Commands execute in the context of the user's current active session.

### Installation Script Execution

**Official Installer**: Downloads from `https://pterodactyl-installer.se`

**Mode Support**: Panel (0), Wings (1), Both (2), Uninstall (6)

**Safe Install**: Downloads script to `/tmp/ptero.sh`, shows preview and SHA256, then executes.

**Output Streaming**: Real-time terminal output forwarded to WhatsApp in chunks.

## External Dependencies

### WhatsApp Web Protocol
- **Service**: @whiskeysockets/baileys v6.7.8
- **Purpose**: WhatsApp Web client protocol
- **Authentication**: QR code pairing
- **Data Storage**: Multi-file auth state in `auth_info/`

### SSH Protocol
- **Service**: ssh2 v1.15.0
- **Purpose**: SSH client for remote server connections
- **Authentication**: SSH private key files (ED25519/RSA)
- **Data Transfer**: Encrypted shell streams

### Pterodactyl Installation Scripts
- **Service**: Official Pterodactyl installer
- **Endpoint**: https://pterodactyl-installer.se
- **Integration**: Executed remotely via SSH

### Environment Configuration
- **Service**: dotenv v16.4.5
- **Purpose**: Loads `.env` file into environment variables
- **Security**: Stores sensitive credentials outside source code

### Terminal QR Code Rendering
- **Service**: qrcode-terminal v0.12.0
- **Purpose**: Renders QR codes in terminal for WhatsApp pairing

### Logging
- **Service**: pino v9.0.0
- **Purpose**: High-performance logging (configured as silent in production)

## Project Structure

```
.
├── bot.js              # Main bot implementation (corrected version)
├── package.json        # Dependencies and scripts
├── .env                # Environment variables (user must create)
├── .env.example        # Template for environment variables
├── .gitignore          # Git ignore rules (includes auth_info/)
├── README.md           # User documentation in Bahasa Indonesia
├── replit.md           # This file - project memory and documentation
├── logs/               # Auto-generated SSH session logs
└── auth_info/          # Auto-generated WhatsApp session data
```

## Configuration

### Required Environment Variables

- `OWNER_NUMBER`: WhatsApp number authorized to use bot (e.g., "6281234567890")
- `OWNER_PIN`: 6-digit PIN for connection authentication

### Optional Environment Variables

- `SSH_KEY_PATH`: Path to SSH private key (default: `~/.ssh/id_rsa`)
- `HOST_WHITELIST`: Comma-separated list of allowed hosts (empty = allow all)
- `HOSTKEY_SHA256_MAP`: JSON map of host fingerprints for verification
- `RATE_LIMIT_MS`: Cooldown between commands (default: 1200ms)
- `SESSION_IDLE_MS`: Auto-close idle sessions (default: 600000ms = 10min)
- `ALLOW_UNOFFICIAL`: Allow unverified host keys (default: true, set false for production)
- `SSH_USE_PASSWORD`: Enable password auth (default: false, not recommended)
- `SSH_PASSWORD`: SSH password if enabled (not recommended)

## Security Considerations

1. **Owner verification uses senderJid**: Critical for group chat security
2. **No MySQL public exposure**: UFW rules don't open port 3306
3. **Key-based SSH only**: Password authentication disabled by default
4. **Host whitelisting**: Recommended for production use
5. **PIN required**: Second factor for all connections
6. **Audit logs**: All activities recorded and sent to owner
7. **Panic mode**: Emergency shutdown capability
8. **Rate limiting**: Prevents abuse and spam

## Usage Notes

To use this bot:

1. Create `.env` file with `OWNER_NUMBER` and `OWNER_PIN`
2. Generate SSH key: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519`
3. Copy public key to target VPS: `ssh-copy-id -i ~/.ssh/id_ed25519.pub root@VPS_IP`
4. Run `npm start` and scan QR code with WhatsApp
5. Send `.help` in WhatsApp to see available commands

## Known Limitations

- WhatsApp session requires periodic re-authentication (QR code scan)
- SSH connections require network connectivity
- Large output may be chunked or truncated due to WhatsApp message limits
- Installer script behavior depends on official Pterodactyl installer

## Future Improvements

- [ ] Add support for multiple owners
- [ ] Implement command history
- [ ] Add health check automation after installation
- [ ] Support for custom installation scripts
- [ ] Web dashboard for session management

---

**Important Notes:**
- This bot is for authorized server administration only
- Never share SSH keys, PINs, or credentials
- Always use strong authentication in production
- Review audit logs regularly for security monitoring
