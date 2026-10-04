const { createClient } = require('@supabase/supabase-js');

class Database {
    constructor() {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_KEY;
        if (!url || !key) {
            this.client = null;
            console.warn("SUPABASE_URL or SUPABASE_KEY is missing from environment.");
        } else {
            this.client = createClient(url, key);
            console.log("Database initialized successfully (Supabase).");
        }
    }

    async ping() {
        if (!this.client) return false;
        try {
            const { data, error } = await this.client.from('users').select('id').limit(1);
            if (error) throw error;
            return true;
        } catch (e) {
            console.error(`Supabase ping failed: ${e.message}`);
            return false;
        }
    }

    async add_user(user_id) {
        if (!this.client) return;
        try {
            await this.client.from('users').upsert({ id: user_id }, { onConflict: 'id', ignoreDuplicates: true });
        } catch (e) {
            console.error(`Error adding user: ${e.message}`);
        }
    }

    async add_group(group_id) {
        if (!this.client) return;
        try {
            await this.client.from('groups').upsert({ id: group_id }, { onConflict: 'id', ignoreDuplicates: true });
        } catch (e) {
            console.error(`Error adding group: ${e.message}`);
        }
    }

    async get_spotify_connection(user_id) {
        if (!this.client) return null;
        try {
            const { data, error } = await this.client.from('spotify_connections').select('*').eq('user_id', user_id);
            if (error) throw error;
            return data && data.length > 0 ? data[0] : null;
        } catch (e) {
            console.error(`Error getting spotify connection: ${e.message}`);
            return null;
        }
    }

    async set_spotify_connection(user_id, spotify_id, display_name, access_token, refresh_token, expires_at) {
        if (!this.client) return;
        try {
            const data = { user_id, spotify_id, display_name, access_token, refresh_token, expires_at };
            await this.client.from('spotify_connections').upsert(data);
        } catch (e) {
            console.error(`Error setting spotify connection: ${e.message}`);
        }
    }

    async delete_spotify_connection(user_id) {
        if (!this.client) return false;
        try {
            const { data, error } = await this.client.from('spotify_connections').delete().eq('user_id', user_id).select();
            if (error) throw error;
            return data && data.length > 0;
        } catch (e) {
            console.error(`Error deleting spotify connection: ${e.message}`);
            return false;
        }
    }
}

module.exports = Database;
