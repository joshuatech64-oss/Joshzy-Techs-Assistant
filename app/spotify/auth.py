import os
import json
import base64
import time
import logging
import threading
import ssl
import secrets
from urllib import parse
from urllib.request import Request, urlopen
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

# Constants
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
SPOTIFY_API_BASE = "https://api.spotify.com/v1"

class SpotifyAuth:
    def __init__(self, db):
        self.db = db
        self.client_id = os.environ.get("SPOTIFY_CLIENT_ID")
        self.client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
        self.redirect_uri = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback")
        self.pending_states = {}
        
        # Start local callback server in a background thread if enabled
        if self.client_id and self.client_secret:
            self._start_server()

    def _start_server(self):
        try:
            parsed_uri = parse.urlparse(self.redirect_uri)
            host = parsed_uri.hostname or "127.0.0.1"
            port = parsed_uri.port or 8888
            
            # Prevent starting multiple servers in tests/reloads
            server = HTTPServer((host, port), self._create_handler())
            logger.info(f"DIAGNOSTIC (OAuth Server Start): class={server.__class__.__name__}, address={host}:{port}")
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            logger.info(f"Started Spotify OAuth callback server on {host}:{port}")
        except Exception as e:
            logger.error(f"Failed to start Spotify callback server: {e}")

    def _create_handler(self):
        auth_instance = self
        
        class CallbackHandler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass  # Suppress default HTTP logging
                
            def do_GET(self):
                try:
                    logger.info("DIAGNOSTIC (OAuth Callback): === ENTRY ===")
                    logger.info(f"DIAGNOSTIC (OAuth Callback): client_address={getattr(self, 'client_address', 'unknown')}")
                    logger.info(f"DIAGNOSTIC (OAuth Callback): requestline='{getattr(self, 'requestline', 'unknown')}'")
                    logger.info(f"DIAGNOSTIC (OAuth Callback): path='{self.path}'")
                    
                    headers_str = ""
                    if hasattr(self, 'headers'):
                        for k, v in self.headers.items():
                            headers_str += f"\\n  {k}: {v}"
                    logger.info(f"DIAGNOSTIC (OAuth Callback): Headers: {headers_str}")

                    parsed_path = parse.urlparse(self.path)
                    
                    query = parse.parse_qs(parsed_path.query)
                    code = query.get("code", [None])[0]
                    state = query.get("state", [None])[0]
                    error = query.get("error", [None])[0]
                    
                    logger.info(f"DIAGNOSTIC (OAuth Callback): code_present={bool(code)}, state_present={bool(state)}, error_present={bool(error)}")
                    
                    logger.info(f"DIAGNOSTIC (OAuth Callback): full_state_value='{state}'")
                    logger.info(f"DIAGNOSTIC (OAuth Callback): has_code={bool(code)}")
                    
                    # Validate against pending state storage
                    has_pending_match = hasattr(auth_instance, 'pending_states') and state in auth_instance.pending_states
                    
                    if has_pending_match:
                        logger.info("DIAGNOSTIC: REAL OAuth state MATCH")
                    else:
                        logger.info("DIAGNOSTIC: OAuth state NOT FOUND")
                        self._respond("Invalid or missing OAuth state.")
                        return
                        
                    if parsed_path.path != "/callback":
                        self.send_response(404)
                        self.end_headers()
                        return
                        
                    if error:
                        self._respond(f"Error: {error}")
                        return
                        
                    if not code or not state:
                        self._respond("Missing code or state")
                        return
                        
                    # Retrieve the user_id associated with this state
                    user_id = auth_instance.pending_states.pop(state)
                    try:
                        auth_instance.exchange_code(user_id, code)
                        self._respond("Successfully connected to Spotify! You can close this window and return to WhatsApp.")
                    except Exception as e:
                        logger.error(f"OAuth callback error: {e}")
                        self._respond(f"Failed to connect: {str(e)}")
                except Exception as fatal_e:
                    logger.error(f"DIAGNOSTIC (OAuth Callback Fatal): {fatal_e}", exc_info=True)
                    self._respond("Internal Server Error")
                    
            def _respond(self, message):
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                html = f"<html><body><h3>{message}</h3></body></html>"
                self.wfile.write(html.encode("utf-8"))
                
        return CallbackHandler

    def get_auth_url(self, user_id: str) -> str:
        if not self.client_id:
            raise ValueError("SPOTIFY_CLIENT_ID is not configured")
            
        state = secrets.token_urlsafe(16)
        self.pending_states[state] = user_id
            
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "state": state,
            "scope": "user-read-private user-read-email"
        }
        return f"{SPOTIFY_AUTH_URL}?{parse.urlencode(params)}"

    def exchange_code(self, user_id: str, code: str):
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri
        }
        token_data = self._request_token(data)
        
        # Get user info
        user_info = self._get_spotify_user(token_data["access_token"])
        
        expires_at = int(time.time()) + token_data["expires_in"]
        
        self.db.set_spotify_connection(
            user_id=user_id,
            spotify_id=user_info["id"],
            display_name=user_info.get("display_name") or user_info["id"],
            access_token=token_data["access_token"],
            refresh_token=token_data["refresh_token"],
            expires_at=expires_at
        )

    def refresh_token(self, user_id: str) -> Optional[str]:
        conn = self.db.get_spotify_connection(user_id)
        if not conn:
            return None
            
        # Check if still valid (with 60s buffer)
        if conn["expires_at"] > int(time.time()) + 60:
            return conn["access_token"]
            
        data = {
            "grant_type": "refresh_token",
            "refresh_token": conn["refresh_token"]
        }
        
        try:
            token_data = self._request_token(data)
            new_access = token_data["access_token"]
            # Spotify might not return a new refresh token
            new_refresh = token_data.get("refresh_token", conn["refresh_token"])
            expires_at = int(time.time()) + token_data["expires_in"]
            
            self.db.set_spotify_connection(
                user_id=user_id,
                spotify_id=conn["spotify_id"],
                display_name=conn["display_name"],
                access_token=new_access,
                refresh_token=new_refresh,
                expires_at=expires_at
            )
            return new_access
        except Exception as e:
            logger.error(f"Failed to refresh token for {user_id}: {e}")
            return None

    def get_user_info(self, user_id: str) -> Optional[Dict[str, Any]]:
        conn = self.db.get_spotify_connection(user_id)
        if not conn:
            return None
        return {
            "spotify_id": conn["spotify_id"],
            "display_name": conn["display_name"]
        }

    def disconnect(self, user_id: str) -> bool:
        return self.db.delete_spotify_connection(user_id)

    def _request_token(self, data: Dict[str, str]) -> Dict[str, Any]:
        auth_string = f"{self.client_id}:{self.client_secret}"
        auth_base64 = base64.b64encode(auth_string.encode("utf-8")).decode("utf-8")
        
        req = Request(SPOTIFY_TOKEN_URL, data=parse.urlencode(data).encode("utf-8"))
        req.add_header("Authorization", f"Basic {auth_base64}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
        
        with urlopen(req, context=ssl._create_unverified_context()) as response:
            return json.loads(response.read())

    def _get_spotify_user(self, access_token: str) -> Dict[str, Any]:
        req = Request(f"{SPOTIFY_API_BASE}/me")
        req.add_header("Authorization", f"Bearer {access_token}")
        
        with urlopen(req, context=ssl._create_unverified_context()) as response:
            return json.loads(response.read())
