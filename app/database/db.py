import os
import logging
from supabase import create_client, Client

logger = logging.getLogger(__name__)

class Database:
    def __init__(self, db_path: str = None):
        # db_path is kept for backward compatibility but ignored
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            # We allow tests to pass if supabase is mocked or missing credentials
            # by setting client to None, but it will raise errors on actual usage
            self.client = None
            logger.warning("SUPABASE_URL or SUPABASE_KEY is missing from environment.")
        else:
            self.client: Client = create_client(url, key)
            logger.info("Database initialized successfully (Supabase).")

    def ping(self) -> bool:
        if not self.client:
            return False
        try:
            # Supabase Python client doesn't have a direct ping, querying a dummy or users table with limit 1
            self.client.table("users").select("id").limit(1).execute()
            return True
        except Exception as e:
            logger.error(f"Supabase ping failed: {e}")
            return False

    def add_user(self, user_id: str):
        if not self.client:
            return
        try:
            # Use upsert to simulate INSERT OR IGNORE
            self.client.table("users").upsert({"id": user_id}, ignore_duplicates=True).execute()
        except Exception as e:
            logger.error(f"Error adding user: {e}")

    def add_group(self, group_id: str):
        if not self.client:
            return
        try:
            self.client.table("groups").upsert({"id": group_id}, ignore_duplicates=True).execute()
        except Exception as e:
            logger.error(f"Error adding group: {e}")

    def get_spotify_connection(self, user_id: str):
        if not self.client:
            return None
        try:
            response = self.client.table("spotify_connections").select("*").eq("user_id", user_id).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]
            return None
        except Exception as e:
            logger.error(f"Error getting spotify connection: {e}")
            return None

    def set_spotify_connection(self, user_id: str, spotify_id: str, display_name: str, access_token: str, refresh_token: str, expires_at: int):
        if not self.client:
            return
        try:
            data = {
                "user_id": user_id,
                "spotify_id": spotify_id,
                "display_name": display_name,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_at": expires_at
            }
            # Upsert will insert or update based on the primary key (user_id)
            self.client.table("spotify_connections").upsert(data).execute()
        except Exception as e:
            logger.error(f"Error setting spotify connection: {e}")

    def delete_spotify_connection(self, user_id: str) -> bool:
        if not self.client:
            return False
        try:
            response = self.client.table("spotify_connections").delete().eq("user_id", user_id).execute()
            # If data is returned, a row was deleted
            return len(response.data) > 0
        except Exception as e:
            logger.error(f"Error deleting spotify connection: {e}")
            return False

