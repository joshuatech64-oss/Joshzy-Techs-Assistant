const axios = require('axios');
const crypto = require('crypto');

const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

class SpotifyAuth {
    constructor(db) {
        this.db = db;
        this.client_id = process.env.SPOTIFY_CLIENT_ID;
        this.client_secret = process.env.SPOTIFY_CLIENT_SECRET;
        this.redirect_uri = process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:8888/callback";
        this.pending_states = new Map();
    }

    get_auth_url(user_id) {
        if (!this.client_id) {
            throw new Error("SPOTIFY_CLIENT_ID is not configured");
        }
        
        const state = crypto.randomBytes(12).toString('base64url');
        this.pending_states.set(state, user_id);
        
        const params = new URLSearchParams({
            client_id: this.client_id,
            response_type: "code",
            redirect_uri: this.redirect_uri,
            state: state,
            scope: "user-read-private user-read-email"
        });
        
        return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
    }

    async exchange_code(user_id, code) {
        const data = new URLSearchParams({
            grant_type: "authorization_code",
            code: code,
            redirect_uri: this.redirect_uri
        });
        
        const token_data = await this._request_token(data);
        const user_info = await this._get_spotify_user(token_data.access_token);
        
        const expires_at = Math.floor(Date.now() / 1000) + token_data.expires_in;
        
        await this.db.set_spotify_connection(
            user_id,
            user_info.id,
            user_info.display_name || user_info.id,
            token_data.access_token,
            token_data.refresh_token,
            expires_at
        );
    }

    async refresh_token(user_id) {
        const conn = await this.db.get_spotify_connection(user_id);
        if (!conn) return null;
        
        if (conn.expires_at > Math.floor(Date.now() / 1000) + 60) {
            return conn.access_token;
        }
        
        const data = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: conn.refresh_token
        });
        
        try {
            const token_data = await this._request_token(data);
            const new_access = token_data.access_token;
            const new_refresh = token_data.refresh_token || conn.refresh_token;
            const expires_at = Math.floor(Date.now() / 1000) + token_data.expires_in;
            
            await this.db.set_spotify_connection(
                user_id,
                conn.spotify_id,
                conn.display_name,
                new_access,
                new_refresh,
                expires_at
            );
            return new_access;
        } catch (error) {
            console.error(`Failed to refresh token for ${user_id}: ${error.message}`);
            return null;
        }
    }

    async get_user_info(user_id) {
        const conn = await this.db.get_spotify_connection(user_id);
        if (!conn) return null;
        return {
            spotify_id: conn.spotify_id,
            display_name: conn.display_name
        };
    }

    async disconnect(user_id) {
        return await this.db.delete_spotify_connection(user_id);
    }

    async _request_token(dataParams) {
        const auth_string = `${this.client_id}:${this.client_secret}`;
        const auth_base64 = Buffer.from(auth_string, 'utf-8').toString('base64');
        
        const response = await axios.post(SPOTIFY_TOKEN_URL, dataParams.toString(), {
            headers: {
                'Authorization': `Basic ${auth_base64}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        return response.data;
    }

    async _get_spotify_user(access_token) {
        const response = await axios.get(`${SPOTIFY_API_BASE}/me`, {
            headers: { 'Authorization': `Bearer ${access_token}` }
        });
        return response.data;
    }
}

module.exports = SpotifyAuth;
