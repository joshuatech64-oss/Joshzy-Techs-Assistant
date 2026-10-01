import os
import logging
import threading
import json
import urllib.parse
import hashlib
import asyncio
import secrets
import hmac
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

# Global instances for dashboard
wa_client_instance = None
SECURE_COOKIE = None
WEB_PASSWORD = None


class DashboardHandler(BaseHTTPRequestHandler):
    def get_auth_token(self):
        if not self.headers.get('Cookie'): return None
        for cookie in self.headers.get('Cookie').split(';'):
            if 'auth=' in cookie:
                return cookie.split('auth=')[1].strip()
        return None

    def is_authenticated(self):
        # Allow if password is not set (for safety in testing, though it's recommended)
        if not WEB_PASSWORD: return True 
        token = self.get_auth_token()
        if not token or not SECURE_COOKIE: return False
        return hmac.compare_digest(token, SECURE_COOKIE)

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"Joshzy Tech's Assistant is running")
            return
            
        if self.path == "/logout":
            self.send_response(302)
            self.send_header("Set-Cookie", "auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")
            self.send_header("Location", "/")
            self.end_headers()
            return
            
        if self.path == "/":
            if not self.is_authenticated():
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(self.get_login_html().encode())
                return
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(self.get_dashboard_html().encode())
                return
                
        if self.path == "/api/status":
            if not self.is_authenticated():
                self.send_response(401)
                self.end_headers()
                return
                
            status_data = {"status": "starting", "qr": None, "authenticated": False}
            if wa_client_instance and getattr(wa_client_instance, '_loop', None) and wa_client_instance._loop.is_running():
                try:
                    future = asyncio.run_coroutine_threadsafe(wa_client_instance.get_status_dict(), wa_client_instance._loop)
                    status_data = future.result(timeout=5)
                except Exception as e:
                    logger.error(f"Failed to get status: {e}")
                    status_data["status"] = "error"
            
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(status_data).encode())
            return
            
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path == "/login":
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8')
            params = urllib.parse.parse_qs(body)
            password = params.get('password', [''])[0]
            
            if WEB_PASSWORD and hmac.compare_digest(password, WEB_PASSWORD):
                self.send_response(302)
                is_secure = self.headers.get('X-Forwarded-Proto') == 'https'
                secure_flag = "; Secure" if is_secure else ""
                self.send_header("Set-Cookie", f"auth={SECURE_COOKIE}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax{secure_flag}")
                self.send_header("Location", "/")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(self.get_login_html(error="Invalid password").encode())
            return

    def get_login_html(self, error=""):
        err_msg = f'<p style="color:red; margin-bottom:15px;">{error}</p>' if error else ""
        return f'''<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login - Joshzy Tech's Assistant</title>
<style>
    body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }}
    .login-box {{ background: white; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); width: 100%; max-width: 350px; text-align: center; }}
    h2 {{ color: #1c1e21; margin-top: 0; }}
    input[type="password"] {{ width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 16px; transition: border-color 0.2s; }}
    input[type="password"]:focus {{ outline: none; border-color: #25D366; }}
    button {{ width: 100%; padding: 12px; background: #25D366; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; transition: background 0.2s; }}
    button:hover {{ background: #128C7E; }}
</style>
</head>
<body>
    <div class="login-box">
        <h2>Dashboard Login</h2>
        {err_msg}
        <form method="POST" action="/login">
            <input type="password" name="password" placeholder="Enter password" required>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>'''

    def get_dashboard_html(self):
        return '''<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Joshzy Tech's Assistant</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; background: white; padding: 15px 25px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); margin-bottom: 25px; max-width: 600px; margin-left: auto; margin-right: auto; }
    .header h2 { margin: 0; color: #1c1e21; font-size: 20px; }
    .logout-btn { background: #ff4444; color: white; padding: 8px 16px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; transition: background 0.2s; }
    .logout-btn:hover { background: #cc0000; }
    .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); text-align: center; max-width: 600px; margin: 0 auto; }
    h3 { margin-top: 0; color: #1c1e21; }
    #qr-container img { max-width: 100%; border: 1px solid #e4e6eb; border-radius: 8px; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: bold; transition: all 0.3s; }
    .connected { background: #e8f5e9; color: #2e7d32; border: 1px solid #c8e6c9; }
    .disconnected { background: #fff3e0; color: #e65100; border: 1px solid #ffe0b2; }
    .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #25D366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 30px auto; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .scan-text { color: #65676b; margin-top: 20px; font-size: 15px; }
</style>
</head>
<body>
    <div class="header">
        <h2>Joshzy Tech's Assistant</h2>
        <a href="/logout" class="logout-btn">Logout</a>
    </div>
    
    <div class="card">
        <h3>WhatsApp Status</h3>
        <div id="status-badge" class="status-badge disconnected">Loading Status...</div>
        
        <div id="qr-container" style="display:none;">
            <p class="scan-text">Scan this QR code with your WhatsApp app to link the bot.</p>
            <img id="qr-image" src="" alt="WhatsApp QR Code">
        </div>
        <div id="loading" class="spinner"></div>
    </div>

    <script>
        function updateStatus() {
            fetch('/api/status')
                .then(r => {
                    if(r.status === 401) window.location.reload();
                    return r.json();
                })
                .then(data => {
                    document.getElementById('loading').style.display = 'none';
                    let badge = document.getElementById('status-badge');
                    
                    if (data.authenticated) {
                        badge.textContent = 'Connected & Active';
                        badge.className = 'status-badge connected';
                        document.getElementById('qr-container').style.display = 'none';
                    } else if (data.qr) {
                        badge.textContent = 'Awaiting Authentication';
                        badge.className = 'status-badge disconnected';
                        document.getElementById('qr-container').style.display = 'block';
                        document.getElementById('qr-image').src = data.qr;
                    } else {
                        badge.textContent = 'Initializing WhatsApp...';
                        badge.className = 'status-badge disconnected';
                        document.getElementById('qr-container').style.display = 'none';
                    }
                })
                .catch(e => {
                    console.error(e);
                    // Don't show confusing UI if server drops
                });
        }
        
        setInterval(updateStatus, 3000);
        updateStatus();
    </script>
</body>
</html>'''

    def log_message(self, format, *args):
        pass


def start_dashboard_server():
    port = int(os.getenv("PORT", "10000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), DashboardHandler)
    logger.info(f"Dashboard server listening on 0.0.0.0:{port}")
    server.serve_forever()


def main():
    global wa_client_instance, SECURE_COOKIE, WEB_PASSWORD
    load_dotenv()
    
    WEB_PASSWORD = os.getenv("BOT_WEB_PASSWORD")
    if WEB_PASSWORD:
        SECURE_COOKIE = secrets.token_hex(32)
    else:
        logger.warning("BOT_WEB_PASSWORD is not set. Dashboard is unprotected!")

    db_path = os.getenv("DATABASE_PATH", "data/bot.db")
    session_path = os.getenv("WHATSAPP_SESSION_PATH", "sessions/")

    logger.info("Initializing database...")
    db = Database(db_path)

    logger.info("Initializing WhatsApp Client...")
    wa_client = WhatsAppClient(session_path)
    wa_client_instance = wa_client

    logger.info("Initializing Command Router...")
    router = CommandRouter(db, wa_client)
    wa_client.add_message_handler(router.process_message)

    # Render Web Service health endpoint and Dashboard
    dashboard_thread = threading.Thread(
        target=start_dashboard_server,
        daemon=True
    )
    dashboard_thread.start()

    wa_client.start()
    logger.info("Bot is running!")


if __name__ == "__main__":
    main()