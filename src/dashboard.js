const express = require('express');
const crypto = require('crypto');
const qrcode = require('qrcode');

class DashboardServer {
    constructor(wa_client) {
        this.wa_client = wa_client;
        this.app = express();
        
        this.web_password = process.env.BOT_WEB_PASSWORD;
        this.secure_cookie = null;
        if (this.web_password) {
            this.secure_cookie = crypto.randomBytes(32).toString('hex');
        } else {
            console.warn("BOT_WEB_PASSWORD is not set. Dashboard is unprotected!");
        }

        this.app.use(express.urlencoded({ extended: true }));

        this.app.get('/health', (req, res) => {
            res.send("Joshzy Tech's Assistant is running");
        });

        this.app.get('/logout', (req, res) => {
            res.cookie('auth', '', { httpOnly: true, maxAge: 0, sameSite: 'Lax' });
            res.redirect('/');
        });

        this.app.get('/', (req, res) => {
            if (!this.isAuthenticated(req)) {
                res.send(this.getLoginHtml());
            } else {
                res.send(this.getDashboardHtml());
            }
        });

        this.app.post('/login', (req, res) => {
            const password = req.body.password || '';
            if (this.web_password && password === this.web_password) {
                const isSecure = req.headers['x-forwarded-proto'] === 'https';
                res.cookie('auth', this.secure_cookie, {
                    httpOnly: true,
                    maxAge: 86400000,
                    sameSite: 'Lax',
                    secure: isSecure
                });
                res.redirect('/');
            } else {
                res.send(this.getLoginHtml("Invalid password"));
            }
        });

        this.app.get('/api/status', async (req, res) => {
            if (!this.isAuthenticated(req)) {
                return res.status(401).send();
            }

            const status_data = this.wa_client.get_status_dict();
            
            if (status_data.qr_data && !status_data.is_authenticated) {
                try {
                    status_data.qr = await qrcode.toDataURL(status_data.qr_data);
                } catch (e) {
                    status_data.qr = null;
                }
            }
            
            res.json({
                status: status_data.state,
                qr: status_data.qr,
                authenticated: status_data.is_authenticated
            });
        });
    }

    isAuthenticated(req) {
        if (!this.web_password) return true;
        const cookie = req.headers.cookie;
        if (!cookie) return false;
        const match = cookie.match(/auth=([^;]+)/);
        if (!match) return false;
        const token = match[1];
        if (!this.secure_cookie) return false;
        
        try {
            return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(this.secure_cookie));
        } catch {
            return false;
        }
    }

    getLoginHtml(error = "") {
        const err_msg = error ? `<p style="color:red; margin-bottom:15px;">${error}</p>` : "";
        return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login - Joshzy Tech's Assistant</title>
<style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .login-box { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); width: 100%; max-width: 350px; text-align: center; }
    h2 { color: #1c1e21; margin-top: 0; }
    input[type="password"] { width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 16px; transition: border-color 0.2s; }
    input[type="password"]:focus { outline: none; border-color: #25D366; }
    button { width: 100%; padding: 12px; background: #25D366; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; transition: background 0.2s; }
    button:hover { background: #128C7E; }
</style>
</head>
<body>
    <div class="login-box">
        <h2>Dashboard Login</h2>
        ${err_msg}
        <form method="POST" action="/login">
            <input type="password" name="password" placeholder="Enter password" required>
            <button type="submit">Login</button>
        </form>
    </div>
</body>
</html>`;
    }

    getDashboardHtml() {
        return `<!DOCTYPE html>
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
                });
        }
        
        setInterval(updateStatus, 3000);
        updateStatus();
    </script>
</body>
</html>`;
    }

    start() {
        const port = parseInt(process.env.PORT || '10000', 10);
        this.app.listen(port, '0.0.0.0', () => {
            console.log(`Dashboard server listening on 0.0.0.0:${port}`);
        });
    }
}

module.exports = DashboardServer;
