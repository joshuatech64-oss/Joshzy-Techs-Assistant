class MuteManager {
    constructor() {
        // Maps "chat_id,target_user" -> expiration_timestamp
        this.mutes = new Map();
    }

    _normalize(user) {
        if (!user) return "";
        let u = user;
        if (u.startsWith('~')) {
            u = u.substring(1);
        }
        // Remove invisible Unicode directional marks and formatting characters
        u = u.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '');
        // Normalize non-breaking spaces
        u = u.replace(/\xa0/g, ' ');
        return u.trim().toLowerCase();
    }

    mute(chat_id, target_user, duration_seconds) {
        const key = `${chat_id},${this._normalize(target_user)}`;
        const expiresAt = Date.now() / 1000 + duration_seconds;
        this.mutes.set(key, expiresAt);
    }

    is_muted(chat_id, target_user) {
        const key = `${chat_id},${this._normalize(target_user)}`;
        if (this.mutes.has(key)) {
            const expiresAt = this.mutes.get(key);
            if (Date.now() / 1000 < expiresAt) {
                return true;
            } else {
                this.mutes.delete(key);
            }
        }
        return false;
    }

    unmute(chat_id, target_user) {
        const key = `${chat_id},${this._normalize(target_user)}`;
        if (this.mutes.has(key)) {
            this.mutes.delete(key);
            return true;
        }
        return false;
    }
}

module.exports = MuteManager;
