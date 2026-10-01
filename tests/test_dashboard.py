import pytest
import os
import hashlib
from main import DashboardHandler

# Create a mock for the DashboardHandler
class MockRequest:
    def makefile(self, *args, **kwargs):
        import io
        return io.BytesIO(b"")
        
    def sendall(self, data):
        pass

class MockServer:
    pass

class MockHandler(DashboardHandler):
    def __init__(self, path="/", method="GET", body="", headers=None):
        self.path = path
        self.command = method
        self.headers = headers or {}
        
        import io
        self.rfile = io.BytesIO(body.encode('utf-8'))
        self.wfile = io.BytesIO()
        
        self.responses = []
        self.headers_sent = []
        
    def send_response(self, code, message=None):
        self.responses.append(code)
        
    def send_header(self, keyword, value):
        self.headers_sent.append((keyword, value))
        
    def end_headers(self):
        pass

def setup_module(module):
    import main
    main.WEB_PASSWORD = "test_password"
    main.SECURE_COOKIE = hashlib.sha256(b"test_password").hexdigest()
    
    class MockLoop:
        def is_running(self):
            return False
            
    class MockWA:
        def __init__(self):
            self._loop = MockLoop()
        
        async def get_status_dict(self):
            return {"authenticated": True, "qr": None}
            
    main.wa_client_instance = MockWA()

def test_health_endpoint():
    handler = MockHandler(path="/health")
    handler.do_GET()
    assert handler.responses[0] == 200
    assert b"Joshzy Tech's Assistant is running" in handler.wfile.getvalue()

def test_unauthenticated_dashboard():
    handler = MockHandler(path="/")
    handler.do_GET()
    assert handler.responses[0] == 200
    assert b"Login" in handler.wfile.getvalue()
    assert b"Dashboard Login" in handler.wfile.getvalue()

def test_unauthenticated_api():
    handler = MockHandler(path="/api/status")
    handler.do_GET()
    assert handler.responses[0] == 401

def test_login_success():
    body = "password=test_password"
    headers = {"Content-Length": str(len(body))}
    handler = MockHandler(path="/login", method="POST", body=body, headers=headers)
    handler.do_POST()
    assert handler.responses[0] == 302
    cookie_header = next(h for h in handler.headers_sent if h[0] == "Set-Cookie")
    import main
    assert main.SECURE_COOKIE in cookie_header[1]

def test_login_failure():
    body = "password=wrong"
    headers = {"Content-Length": str(len(body))}
    handler = MockHandler(path="/login", method="POST", body=body, headers=headers)
    handler.do_POST()
    assert handler.responses[0] == 200
    assert b"Invalid password" in handler.wfile.getvalue()

def test_authenticated_dashboard():
    import main
    headers = {"Cookie": f"auth={main.SECURE_COOKIE}"}
    handler = MockHandler(path="/", headers=headers)
    handler.do_GET()
    assert handler.responses[0] == 200
    assert b"WhatsApp Status" in handler.wfile.getvalue()

def test_authenticated_api():
    import main
    headers = {"Cookie": f"auth={main.SECURE_COOKIE}"}
    handler = MockHandler(path="/api/status", headers=headers)
    handler.do_GET()
    assert handler.responses[0] == 200
    assert b"starting" in handler.wfile.getvalue() or b"authenticated" in handler.wfile.getvalue()
