import os
import logging
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

from dotenv import load_dotenv
from app.database.db import Database
from app.whatsapp.client import WhatsAppClient
from app.commands.router import CommandRouter

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"Joshzy Tech's Assistant is running")

    def log_message(self, format, *args):
        pass


def start_health_server():
    port = int(os.getenv("PORT", "10000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), HealthHandler)
    logger.info(f"Health server listening on 0.0.0.0:{port}")
    server.serve_forever()


def main():
    load_dotenv()

    db_path = os.getenv("DATABASE_PATH", "data/bot.db")
    session_path = os.getenv("WHATSAPP_SESSION_PATH", "sessions/")

    # Render Web Service health endpoint
    health_thread = threading.Thread(
        target=start_health_server,
        daemon=True
    )
    health_thread.start()

    logger.info("Initializing database...")
    db = Database(db_path)

    logger.info("Initializing WhatsApp Client...")
    wa_client = WhatsAppClient(session_path)

    logger.info("Initializing Command Router...")
    router = CommandRouter(db, wa_client)
    wa_client.add_message_handler(router.process_message)

    wa_client.start()
    logger.info("Bot is running!")


if __name__ == "__main__":
    main()