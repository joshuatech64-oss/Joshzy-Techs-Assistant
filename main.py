import os
import logging
from dotenv import load_dotenv
from app.database.db import Database
from app.whatsapp.client import WhatsAppClient
from app.commands.router import CommandRouter

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    load_dotenv()
    db_path = os.getenv("DATABASE_PATH", "data/bot.db")
    session_path = os.getenv("WHATSAPP_SESSION_PATH", "sessions/")

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
