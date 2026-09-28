import time
from typing import Dict, Tuple

class MuteManager:
    def __init__(self):
        # Maps (chat_id, target_user) -> expiration_timestamp
        self.mutes: Dict[Tuple[str, str], float] = {}

    def mute(self, chat_id: str, target_user: str, duration_seconds: int):
        self.mutes[(chat_id, target_user)] = time.time() + duration_seconds

    def is_muted(self, chat_id: str, target_user: str) -> bool:
        key = (chat_id, target_user)
        if key in self.mutes:
            if time.time() < self.mutes[key]:
                return True
            else:
                del self.mutes[key]
        return False
