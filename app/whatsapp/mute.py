import time
from typing import Dict, Tuple

class MuteManager:
    def __init__(self):
        # Maps (chat_id, target_user) -> expiration_timestamp
        self.mutes: Dict[Tuple[str, str], float] = {}

    def _normalize(self, user: str) -> str:
        if not user:
            return ""
        # Remove leading '~' which WhatsApp adds for unsaved contacts
        if user.startswith('~'):
            user = user[1:]
        # Remove invisible Unicode directional marks and formatting characters
        import re
        user = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', user)
        # Normalize non-breaking spaces
        user = user.replace('\xa0', ' ')
        return user.strip().lower()

    def mute(self, chat_id: str, target_user: str, duration_seconds: int):
        self.mutes[(chat_id, self._normalize(target_user))] = time.time() + duration_seconds

    def is_muted(self, chat_id: str, target_user: str) -> bool:
        key = (chat_id, self._normalize(target_user))
        if key in self.mutes:
            if time.time() < self.mutes[key]:
                return True
            else:
                del self.mutes[key]
        return False

    def unmute(self, chat_id: str, target_user: str) -> bool:
        key = (chat_id, self._normalize(target_user))
        if key in self.mutes:
            del self.mutes[key]
            return True
        return False
