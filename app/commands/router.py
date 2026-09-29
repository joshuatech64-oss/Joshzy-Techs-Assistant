import time
from app.database.db import Database
from app.whatsapp.client import WhatsAppClient
from app.spotify.auth import SpotifyAuth
from app.translation.translator import Translator
from app.whatsapp.mute import MuteManager

class CommandRouter:
    def __init__(self, db: Database, wa_client: WhatsAppClient):
        self.db = db
        self.wa_client = wa_client
        self.spotify_auth = SpotifyAuth(db)
        self.translator = Translator()
        self.mute_manager = MuteManager()
        self.commands = {
            ".ping": self.cmd_ping,
            ".help": self.cmd_help,
            ".spotify": self.cmd_spotify,
            ".translate": self.cmd_translate,
            ".mute": self.cmd_mute,
            ".unmute": self.cmd_unmute,
        }

    def process_message(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None, row_testid: str = None):
        self.db.add_user(sender_id)
        if is_group:
            self.db.add_group(chat_id)

        # Check if user is muted in this group
        if is_group and self.mute_manager.is_muted(chat_id, sender_id):
            if row_testid:
                self.wa_client.delete_message(row_testid)
            return

        msg = message.strip()
        if not msg:
            return

        command = msg.split(" ")[0].lower()

        if command in self.commands:
            self.commands[command](sender_id, chat_id, is_group, msg, quoted_text)

    def cmd_ping(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        start_time = time.time()
        db_ok = self.db.ping()
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        db_status = "OK" if db_ok else "ERROR"
        response = f"🏓 Pong!\n\n🟢 Bot: Online\n⚡ Response: {elapsed_ms}ms\n💾 Database: {db_status}"
        self.wa_client.send_message(chat_id, response)

    def cmd_help(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        response = "Available Commands:\n.ping - Check bot status\n.help - Show this message\n.spotify - Manage Spotify connection\n.translate - Translate text to English"
        self.wa_client.send_message(chat_id, response)

    def cmd_spotify(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        parts = message.split(" ")
        subcmd = parts[1].lower() if len(parts) > 1 else None

        if subcmd == "connect":
            try:
                url = self.spotify_auth.get_auth_url(sender_id)
                response = f"🎵 Connect Spotify\n\nOpen this link to authorize your Spotify account:\n\n{url}\n\nAfter authorization, your Spotify account will be connected automatically."
            except ValueError:
                response = "🎵 Spotify\n❌ Spotify is not configured on the server."
            self.wa_client.send_message(chat_id, response)
        elif subcmd == "disconnect":
            disconnected = self.spotify_auth.disconnect(sender_id)
            if disconnected:
                response = "🎵 Spotify\n🔴 Spotify account disconnected."
            else:
                response = "🎵 Spotify\nℹ️ No Spotify account is currently connected."
            self.wa_client.send_message(chat_id, response)
        else:
            info = self.spotify_auth.get_user_info(sender_id)
            if info:
                response = f"🎵 Spotify\n🟢 Connected\n👤 Spotify account: {info['display_name']}"
            else:
                response = "🎵 Spotify\n🔴 Not connected\n\nUse .spotify connect to connect your Spotify account."
            self.wa_client.send_message(chat_id, response)

    def cmd_translate(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        text_to_translate = message[len(".translate"):].strip()
        
        if not text_to_translate and quoted_text:
            text_to_translate = quoted_text
            
        if not text_to_translate:
            self.wa_client.send_message(chat_id, "Usage: .translate <text> OR reply to a message with .translate")
            return
            
        response = self.translator.translate(text_to_translate)
        self.wa_client.send_message(chat_id, response)

    def cmd_mute(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        if not is_group:
            self.wa_client.send_message(chat_id, "❌ .mute can only be used in a WhatsApp group.")
            return

        parts = message.split()
        if len(parts) != 3 or not parts[1].startswith("@"):
            self.wa_client.send_message(chat_id, "Usage: .mute @username <duration>\nExample: .mute @john 2m")
            return

        target = parts[1][1:] # remove @
        duration_str = parts[2].lower()

        if target == sender_id or target.lower() == "bot":
            self.wa_client.send_message(chat_id, "❌ Cannot mute this user.")
            return

        # Check admin
        if not self.wa_client.is_admin(chat_id, sender_id):
            self.wa_client.send_message(chat_id, "❌ You must be a group admin to use .mute.")
            return

        if not self.wa_client.is_admin(chat_id, "bot"):
            self.wa_client.send_message(chat_id, "❌ Bot must be a group admin to mute.")
            return

        duration_seconds = 0
        if duration_str.endswith('s'):
            duration_seconds = int(duration_str[:-1])
        elif duration_str.endswith('m'):
            duration_seconds = int(duration_str[:-1]) * 60
        elif duration_str.endswith('h'):
            duration_seconds = int(duration_str[:-1]) * 3600
        else:
            self.wa_client.send_message(chat_id, "❌ Invalid duration. Use s, m, or h.")
            return

        self.mute_manager.mute(chat_id, target, duration_seconds)
        self.wa_client.send_message(chat_id, f"✅ @{target} has been muted for {duration_str}.")

    def cmd_unmute(self, sender_id: str, chat_id: str, is_group: bool, message: str, quoted_text: str = None):
        if not is_group:
            self.wa_client.send_message(chat_id, "❌ .unmute can only be used in a WhatsApp group.")
            return

        parts = message.split()
        if len(parts) != 2 or not parts[1].startswith("@"):
            self.wa_client.send_message(chat_id, "Usage: .unmute @username\nExample: .unmute @john")
            return

        target = parts[1][1:] # remove @

        # Check admin
        if not self.wa_client.is_admin(chat_id, sender_id):
            self.wa_client.send_message(chat_id, "❌ You must be a group admin to use .unmute.")
            return

        if not self.wa_client.is_admin(chat_id, "bot"):
            self.wa_client.send_message(chat_id, "❌ Bot must be a group admin to unmute.")
            return

        if self.mute_manager.unmute(chat_id, target):
            self.wa_client.send_message(chat_id, f"✅ @{target} has been unmuted.")
        else:
            self.wa_client.send_message(chat_id, f"ℹ️ @{target} is not currently muted.")
