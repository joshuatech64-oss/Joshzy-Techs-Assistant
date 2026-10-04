const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, areJidsSameUser, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class WhatsAppClient {
    constructor(db, router) {
        this.db = db;
        this.router = router;
        
        this.profileDir = path.join(process.cwd(), 'sessions');
        this.authDir = path.join(this.profileDir, 'baileys_auth');
        this.zipPath = path.join(this.profileDir, 'session.zip');
        
        this._startup_state = "bootstrapping";
        this._qr_data = null;
        this._is_authenticated = false;
        
        this.sock = null;
        
        if (!fs.existsSync(this.profileDir)) {
            fs.mkdirSync(this.profileDir, { recursive: true });
        }
    }

    get_status_dict() {
        return {
            state: this._startup_state,
            qr_data: this._qr_data,
            is_authenticated: this._is_authenticated
        };
    }

    async _restore_session_from_supabase() {
        if (!this.db || !this.db.client) return;
        
        try {
            console.log("Attempting to restore session from Supabase Storage...");
            const { data, error } = await this.db.client.storage.from("whatsapp-sessions").download("session.zip");
            if (error) {
                if (error.message.includes("not found") || error.message.includes("NoSuchKey") || error.message.includes("Object not found")) {
                    console.log("No saved session found in Supabase. A new session will be created.");
                } else {
                    console.error(`Failed to restore session: ${error.message}`);
                }
                return;
            }
            
            const buffer = Buffer.from(await data.arrayBuffer());
            fs.writeFileSync(this.zipPath, buffer);
            
            if (fs.existsSync(this.authDir)) {
                fs.rmSync(this.authDir, { recursive: true, force: true });
            }
            fs.mkdirSync(this.authDir, { recursive: true });
            
            const zip = new AdmZip(this.zipPath);
            zip.extractAllTo(this.profileDir, true);
            
            console.log("Successfully restored Baileys session from Supabase!");
        } catch (error) {
            console.error(`Error accessing Supabase storage: ${error.message}`);
        }
    }

    async _save_session_to_supabase() {
        if (!this.db || !this.db.client) return;
        
        try {
            if (!fs.existsSync(this.authDir)) return;
            
            console.log("Saving Baileys session to Supabase Storage...");
            
            const zip = new AdmZip();
            zip.addLocalFolder(this.authDir, "baileys_auth");
            zip.writeZip(this.zipPath);
            
            const fileBuffer = fs.readFileSync(this.zipPath);
            
            await this.db.client.storage.from("whatsapp-sessions").remove(["session.zip"]).catch(() => {});
            
            const { error } = await this.db.client.storage.from("whatsapp-sessions").upload("session.zip", fileBuffer, {
                contentType: 'application/zip',
                upsert: true
            });
            
            if (error) throw error;
            console.log("Successfully saved Baileys session to Supabase!");
        } catch (error) {
            console.error(`Failed to save session to Supabase: ${error.message}`);
        }
    }

    async start() {
        await this._restore_session_from_supabase();
        
        console.log("Starting Baileys Node.js process...");
        
        const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
        
        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }),
            browser: ['Joshzy Tech Assistant', 'Chrome', '1.0.0'],
        });

        this.sock.ev.on('creds.update', async () => {
            await saveCreds();
            if (this._is_authenticated && process.env.HEADLESS === "true") {
                await this._save_session_to_supabase();
            }
        });

        this.sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                this._qr_data = qr;
                this._startup_state = "qr_available";
                this._is_authenticated = false;
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    this.start();
                } else {
                    console.error('Logged out. Please delete the session folder and restart.');
                    process.exit(1);
                }
            } else if (connection === 'open') {
                this._qr_data = null;
                this._startup_state = "authenticated";
                this._is_authenticated = true;
                console.log("Successfully authenticated to WhatsApp Web! (Baileys)");
                if (process.env.HEADLESS === "true") {
                    this._save_session_to_supabase();
                }
            }
        });

        this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
            
if (type !== 'notify') return;
            
            for (const m of messages) {
                if (!m.message) continue;
                
                const isGroup = m.key.remoteJid.endsWith('@g.us');
                const chat_type = isGroup ? "WhatsApp Group" : "Normal/Private Chat";
                
                let senderId = m.key.participant || m.key.remoteJid;
                let resolvedSenderId = await this.getCanonicalJid(senderId);

                if (m.key.fromMe) {
                    senderId = "bot";
                } else {
                    senderId = resolvedSenderId.split('@')[0];
                }
                
                const messageType = Object.keys(m.message)[0];
let text = "";
let quotedText = "";
                
                if (messageType === 'conversation') {
                    text = m.message.conversation;
                } else if (messageType === 'extendedTextMessage') {
                    text = m.message.extendedTextMessage.text;
                    if (m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.quotedMessage) {
                        const quotedMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
                        quotedText = quotedMsg.conversation || quotedMsg.extendedTextMessage?.text || "";
                    }
                }
                
                if (!text && !quotedText) continue;
                // Self-messages are allowed to be processed.
                
                console.log(`Incoming message from ${senderId} in ${chat_type}: ${text}`);
                
                await this.router.process_message(
                    senderId,
                    m.key.remoteJid,
                    isGroup,
                    chat_type,
                    text,
                    quotedText,
                    JSON.stringify(m.key),
                    m
                );
            }
        });
    }

    async extract_view_once(m, senderId) {
        if (!this.sock) return;
        try {
            const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quotedMsg) {
                await this.send_message(m.key.remoteJid, "❌ Please reply to a view once message.");
                return;
            }

            let innerMessage = quotedMsg;
            if (quotedMsg.viewOnceMessageV2) {
                innerMessage = quotedMsg.viewOnceMessageV2.message;
            } else if (quotedMsg.viewOnceMessageV2Extension) {
                innerMessage = quotedMsg.viewOnceMessageV2Extension.message;
            } else if (quotedMsg.viewOnceMessage) {
                innerMessage = quotedMsg.viewOnceMessage.message;
            }

            const isViewOnce = 
                !!quotedMsg.viewOnceMessageV2 || 
                !!quotedMsg.viewOnceMessageV2Extension || 
                !!quotedMsg.viewOnceMessage ||
                innerMessage?.imageMessage?.viewOnce ||
                innerMessage?.videoMessage?.viewOnce ||
                innerMessage?.audioMessage?.viewOnce;

            if (!isViewOnce) {
                await this.send_message(m.key.remoteJid, "❌ The replied message is not a view once message. Debug: " + Object.keys(quotedMsg).join(', '));
                return;
            }

            const fakeM = {
                key: m.message.extendedTextMessage.contextInfo.stanzaId ? {
                    remoteJid: m.key.remoteJid,
                    id: m.message.extendedTextMessage.contextInfo.stanzaId,
                    participant: m.message.extendedTextMessage.contextInfo.participant
                } : m.key,
                message: innerMessage
            };

            await this.send_message(m.key.remoteJid, "⏳ Extracting view once message, please wait...");

            const buffer = await downloadMediaMessage(
                fakeM,
                'buffer',
                {},
                { logger: pino({ level: 'silent' }), reuploadRequest: this.sock.updateMediaMessage }
            );

            const isImage = !!innerMessage.imageMessage;
            const isVideo = !!innerMessage.videoMessage;
            const isAudio = !!innerMessage.audioMessage;
            
            let caption = innerMessage.imageMessage?.caption || innerMessage.videoMessage?.caption || "";

            let targetJid = senderId;
            if (!targetJid.includes('@')) {
                targetJid = targetJid + '@s.whatsapp.net';
            }

            if (isImage) {
                await this.sock.sendMessage(targetJid, { image: buffer, caption: caption });
            } else if (isVideo) {
                await this.sock.sendMessage(targetJid, { video: buffer, caption: caption });
            } else if (isAudio) {
                await this.sock.sendMessage(targetJid, { audio: buffer, ptt: true });
            } else {
                await this.sock.sendMessage(targetJid, { document: buffer, mimetype: 'application/octet-stream', fileName: 'extracted_file' });
            }
            
            await this.send_message(m.key.remoteJid, "✅ View once media sent to your DM.");

        } catch (e) {
            console.error("Error extracting view once:", e);
            await this.send_message(m.key.remoteJid, "❌ Failed to extract view once message.");
        }
    }

    async getCanonicalJid(jid) {
        if (!jid) return jid;
        let resolved = jid;
        if (jid.includes('@lid') && this.sock?.signalRepository?.lidMapping?.getPNForLID) {
            try {
                const pn = await this.sock.signalRepository.lidMapping.getPNForLID(jid);
                if (pn) resolved = pn;
            } catch (e) {
                // Ignore failure and fallback to lid
            }
        }
        return resolved;
    }

    async send_message(chat_id, text) {
        if (!this.sock) return;
        await this.sock.sendMessage(chat_id, { text: text });
    }

    async delete_message(chat_id, row_testid) {
        if (!this.sock) return;
        try {
            const key = JSON.parse(row_testid);
            await this.sock.sendMessage(chat_id, { delete: key });
        } catch (e) {
            console.error("Error deleting message:", e);
        }
    }

    async is_admin(chat_id, user_id) {
        if (!this.sock || !chat_id.endsWith('@g.us')) return false;
        try {
            const metadata = await this.sock.groupMetadata(chat_id);
            const targetIds = [];
            
            if (user_id === 'bot') {
                if (this.sock.user.id) targetIds.push(await this.getCanonicalJid(this.sock.user.id));
                if (this.sock.user.lid) targetIds.push(await this.getCanonicalJid(this.sock.user.lid));
            } else {
                targetIds.push(await this.getCanonicalJid(user_id + '@s.whatsapp.net'));
                targetIds.push(await this.getCanonicalJid(user_id + '@lid')); // just in case
            }

            let participant = null;
            for (const p of metadata.participants) {
                const canonP = await this.getCanonicalJid(p.id);
                if (targetIds.some(tid => areJidsSameUser(canonP, tid))) {
                    participant = p;
                    break;
                }
            }
            
            if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
                return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }
}

module.exports = WhatsAppClient;







