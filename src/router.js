const SpotifyAuth = require('./spotify');
const Translator = require('./translator');
const MuteManager = require('./mute');

class CommandRouter {
    constructor(db, wa_client) {
        this.db = db;
        this.wa_client = wa_client;
        this.spotify_auth = new SpotifyAuth(db);
        this.translator = new Translator();
        this.mute_manager = new MuteManager();
        
        this.commands = {
            ".ping": this.cmd_ping.bind(this),
            ".help": this.cmd_help.bind(this),
            ".spotify": this.cmd_spotify.bind(this),
            ".translate": this.cmd_translate.bind(this),
            ".mute": this.cmd_mute.bind(this),
            ".unmute": this.cmd_unmute.bind(this),
            ".ex": this.cmd_extract.bind(this)
        };
    }

    async _resolveTarget(chat_id, target) {
        let resolved_target = target;
        try {
            if (this.wa_client.sock && this.wa_client.getCanonicalJid) {
                const metadata = await this.wa_client.sock.groupMetadata(chat_id);
                const isLid = metadata.participants.some(p => p.id && p.id.split('@')[0].split(':')[0] === target && p.id.endsWith('@lid'));
                
                const lookupTarget = isLid ? target + '@lid' : target;
                const canonical = await this.wa_client.getCanonicalJid(lookupTarget);
                if (canonical && !canonical.includes('@lid')) {
                    resolved_target = canonical.split('@')[0];
                }
            } else if (this.wa_client.getCanonicalJid) {
                const canonical = await this.wa_client.getCanonicalJid(target);
                if (canonical && !canonical.includes('@lid')) {
                    resolved_target = canonical.split('@')[0];
                }
            }
        } catch (e) {
            if (this.wa_client.getCanonicalJid) {
                const canonical = await this.wa_client.getCanonicalJid(target);
                if (canonical && !canonical.includes('@lid')) {
                    resolved_target = canonical.split('@')[0];
                }
            }
        }
        return resolved_target;
    }

    async process_message(sender_id, chat_id, is_group, chat_type, message, quoted_text = null, row_testid = null, raw_message = null) {
        await this.db.add_user(sender_id);
        if (is_group) {
            await this.db.add_group(chat_id);
        }

        if (is_group && this.mute_manager.is_muted(chat_id, sender_id)) {
            if (row_testid) {
                await this.wa_client.delete_message(chat_id, row_testid);
            }
            return;
        }

        const msg = message.trim();
        if (!msg) return;

        const command = msg.split(" ")[0].toLowerCase();
        if (this.commands[command]) {
            await this.commands[command](sender_id, chat_id, is_group, chat_type, msg, quoted_text, raw_message);
        }
    }

    async cmd_ping(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        const startTime = Date.now();
        const db_ok = await this.db.ping();
        const elapsed = Date.now() - startTime;
        
        const dbStatus = db_ok ? "OK" : "ERROR";
        const response = `🏓 Pong!\n\n🟢 Bot: Online\n⚡ Response: ${elapsed}ms\n💾 Database: ${dbStatus}`;
        await this.wa_client.send_message(chat_id, response);
    }

    async cmd_help(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        const response = "Available Commands:\n.ping - Check bot status\n.help - Show this message\n.spotify - Manage Spotify connection\n.translate - Translate text to English";
        await this.wa_client.send_message(chat_id, response);
    }

    async cmd_spotify(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        const parts = message.split(" ");
        const subcmd = parts.length > 1 ? parts[1].toLowerCase() : null;

        if (subcmd === "connect") {
            try {
                const url = this.spotify_auth.get_auth_url(sender_id);
                const response = `🎵 Connect Spotify\n\nOpen this link to authorize your Spotify account:\n\n${url}\n\nAfter authorization, your Spotify account will be connected automatically.`;
                await this.wa_client.send_message(chat_id, response);
            } catch (e) {
                const response = "🎵 Spotify\n❌ Spotify is not configured on the server.";
                await this.wa_client.send_message(chat_id, response);
            }
        } else if (subcmd === "disconnect") {
            const disconnected = await this.spotify_auth.disconnect(sender_id);
            const response = disconnected 
                ? "🎵 Spotify\n🔴 Spotify account disconnected." 
                : "🎵 Spotify\nℹ️ No Spotify account is currently connected.";
            await this.wa_client.send_message(chat_id, response);
        } else {
            const info = await this.spotify_auth.get_user_info(sender_id);
            if (info) {
                await this.wa_client.send_message(chat_id, `🎵 Spotify\n🟢 Connected\n👤 Spotify account: ${info.display_name}`);
            } else {
                await this.wa_client.send_message(chat_id, "🎵 Spotify\n🔴 Not connected\n\nUse .spotify connect to connect your Spotify account.");
            }
        }
    }

    async cmd_translate(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        let text_to_translate = message.substring(".translate".length).trim();
        
        if (!text_to_translate && quoted_text) {
            text_to_translate = quoted_text;
        }
        
        if (!text_to_translate) {
            await this.wa_client.send_message(chat_id, "Usage: .translate <text> OR reply to a message with .translate");
            return;
        }
        
        const response = await this.translator.translate(text_to_translate);
        await this.wa_client.send_message(chat_id, response);
    }

    async cmd_mute(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        if (!is_group) {
            await this.wa_client.send_message(chat_id, "❌ .mute can only be used in a WhatsApp group.");
            return;
        }

        const match = message.match(/^\.mute\s+@(.+?)\s+(\S+)$/i);
        if (!match) {
            await this.wa_client.send_message(chat_id, "Usage: .mute @username <duration>\nExample: .mute @john 2m");
            return;
        }

        const target = match[1].trim();
        const duration_str = match[2].toLowerCase();

        if (target === sender_id || target.toLowerCase() === "bot") {
            await this.wa_client.send_message(chat_id, "❌ Cannot mute this user.");
            return;
        }

        if (!(await this.wa_client.is_admin(chat_id, sender_id))) {
            await this.wa_client.send_message(chat_id, "❌ You must be a group admin to use .mute.");
            return;
        }

        if (!(await this.wa_client.is_admin(chat_id, "bot"))) {
            await this.wa_client.send_message(chat_id, "❌ Bot must be a group admin to mute.");
            return;
        }

        let duration_seconds = 0;
        if (duration_str.endsWith('s')) {
            duration_seconds = parseInt(duration_str.slice(0, -1));
        } else if (duration_str.endsWith('m')) {
            duration_seconds = parseInt(duration_str.slice(0, -1)) * 60;
        } else if (duration_str.endsWith('h')) {
            duration_seconds = parseInt(duration_str.slice(0, -1)) * 3600;
        } else {
            await this.wa_client.send_message(chat_id, "❌ Invalid duration. Use s, m, or h.");
            return;
        }

        let resolved_target = await this._resolveTarget(chat_id, target);

        this.mute_manager.mute(chat_id, resolved_target, duration_seconds);
        await this.wa_client.send_message(chat_id, `✅ @${resolved_target} has been muted for ${duration_str}.`);
    }

    async cmd_unmute(sender_id, chat_id, is_group, chat_type, message, quoted_text) {
        if (!is_group) {
            await this.wa_client.send_message(chat_id, "❌ .unmute can only be used in a WhatsApp group.");
            return;
        }

        const match = message.match(/^\.unmute\s+@(.+)$/i);
        if (!match) {
            await this.wa_client.send_message(chat_id, "Usage: .unmute @username\nExample: .unmute @john");
            return;
        }

        const target = match[1].trim();

        if (!(await this.wa_client.is_admin(chat_id, sender_id))) {
            await this.wa_client.send_message(chat_id, "❌ You must be a group admin to use .unmute.");
            return;
        }

        if (!(await this.wa_client.is_admin(chat_id, "bot"))) {
            await this.wa_client.send_message(chat_id, "❌ Bot must be a group admin to unmute.");
            return;
        }

        let resolved_target = await this._resolveTarget(chat_id, target);

        if (this.mute_manager.unmute(chat_id, resolved_target)) {
            await this.wa_client.send_message(chat_id, `✅ @${resolved_target} has been unmuted.`);
        } else {
            await this.wa_client.send_message(chat_id, `ℹ️ @${resolved_target} is not currently muted.`);
        }
    }

    async cmd_extract(sender_id, chat_id, is_group, chat_type, message, quoted_text, raw_message) {
        if (!raw_message) return;
        if (this.wa_client.extract_view_once) {
            await this.wa_client.extract_view_once(raw_message, sender_id);
        }
    }
}

module.exports = CommandRouter;
