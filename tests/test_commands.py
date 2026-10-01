import pytest
from app.database.db import Database
from app.whatsapp.client import WhatsAppClient
from app.commands.router import CommandRouter

class MockWhatsAppClient(WhatsAppClient):
    def __init__(self):
        super().__init__(session_path="test_sessions/")
        self.sent_messages = []

    def send_message(self, to: str, message: str):
        self.sent_messages.append({"to": to, "message": message})

class MockDatabase(Database):
    def __init__(self, *args, **kwargs):
        self.users = set()
        self.groups = set()
        self.client = True # pretend connected

    def ping(self):
        return True

    def add_user(self, user_id):
        self.users.add(user_id)

    def add_group(self, group_id):
        self.groups.add(group_id)

@pytest.fixture
def db():
    return MockDatabase()

@pytest.fixture
def wa_client():
    return MockWhatsAppClient()

@pytest.fixture
def router(db, wa_client):
    r = CommandRouter(db, wa_client)
    wa_client.add_message_handler(r.process_message)
    return r

def test_database_health(db):
    assert db.ping() is True

def test_command_routing_ping(router, wa_client):
    router.process_message("user123", "chat123", False, "Normal/Private Chat", ".ping")
    assert len(wa_client.sent_messages) == 1
    response = wa_client.sent_messages[0]["message"]
    assert "🏓 Pong!" in response
    assert "🟢 Bot: Online" in response
    assert "💾 Database: OK" in response

def test_command_routing_help(router, wa_client):
    router.process_message("user123", "chat123", False, "Normal/Private Chat", ".help")
    assert len(wa_client.sent_messages) == 1
    response = wa_client.sent_messages[0]["message"]
    assert "Available Commands" in response
    assert ".ping" in response
    assert ".help" in response

def test_command_routing_unknown(router, wa_client):
    router.process_message("user123", "chat123", False, "Normal/Private Chat", ".unknown")
    assert len(wa_client.sent_messages) == 0

def test_user_group_creation(router, db):
    router.process_message("user_test", "group_test", True, "WhatsApp Group", ".ping")
    # Verify user and group exist in DB
    assert "user_test" in db.users
    assert "group_test" in db.groups

def test_command_routing_translate(router, wa_client, monkeypatch):
    from unittest.mock import MagicMock
    mock_translator = MagicMock()
    mock_translator.translate.return_value = "Translated!"
    router.translator = mock_translator
    
    # Test direct text
    router.process_message("user", "chat", False, "Normal/Private Chat", ".translate Bonjour")
    assert len(wa_client.sent_messages) == 1
    assert wa_client.sent_messages[-1]["message"] == "Translated!"
    mock_translator.translate.assert_called_with("Bonjour")
    
    # Test quoted text
    router.process_message("user", "chat", False, "Normal/Private Chat", ".translate", quoted_text="Merci")
    assert len(wa_client.sent_messages) == 2
    assert wa_client.sent_messages[-1]["message"] == "Translated!"
    mock_translator.translate.assert_called_with("Merci")
    
    # Test empty request
    router.process_message("user", "chat", False, "Normal/Private Chat", ".translate")
    assert len(wa_client.sent_messages) == 3
    assert "Usage: .translate" in wa_client.sent_messages[-1]["message"]

def test_mute_manager():
    import time
    from app.whatsapp.mute import MuteManager
    manager = MuteManager()
    manager.mute("chat1", "user1", 1) # 1 second
    manager.mute("chat1", "user2", 3600) # 1 hour
    manager.mute("chat2", "user1", 3600) # independent

    assert manager.is_muted("chat1", "user1") is True
    assert manager.is_muted("chat1", "user2") is True
    assert manager.is_muted("chat2", "user1") is True
    assert manager.is_muted("chat1", "user3") is False

    # Wait for expiration
    time.sleep(1.1)
    
    # user1 in chat1 should be expired
    assert manager.is_muted("chat1", "user1") is False
    # Others should still be muted
    assert manager.is_muted("chat1", "user2") is True
    assert manager.is_muted("chat2", "user1") is True

def test_command_routing_mute(router, wa_client):
    # Setup mock admin
    wa_client.is_admin = lambda chat_id, user_id: True
    wa_client.delete_message = lambda row_testid: wa_client.sent_messages.append({"delete": row_testid})

    # Test valid mute
    router.process_message("admin_user", "group_chat", True, "WhatsApp Group", ".mute @spam_user 5m", row_testid="test1")
    assert "muted for 5m" in wa_client.sent_messages[-1]["message"]
    
    # Check mute manager
    assert router.mute_manager.is_muted("group_chat", "spam_user") is True
    
    # Test message deletion when muted
    router.process_message("spam_user", "group_chat", True, "WhatsApp Group", "Hello!", row_testid="msg_to_delete")
    assert {"delete": "msg_to_delete"} in wa_client.sent_messages

    # Test spaces in target name
    router.process_message("admin_user", "group_chat", True, "WhatsApp Group", ".mute @JOSHZY TECH 60s", row_testid="test_spaces")
    assert "muted for 60s" in wa_client.sent_messages[-1]["message"]
    assert router.mute_manager.is_muted("group_chat", "JOSHZY TECH") is True

    # Test invalid duration
    router.process_message("admin_user", "group_chat", True, "WhatsApp Group", ".mute @john 2x")
    assert "Invalid duration" in wa_client.sent_messages[-1]["message"]

    # Test missing target
    router.process_message("admin_user", "group_chat", True, "WhatsApp Group", ".mute 2m")
    assert "Usage: .mute @username" in wa_client.sent_messages[-1]["message"]

def test_admin_permissions(router, wa_client):
    wa_client.delete_message = lambda row_testid: None

    # Test sender not admin
    wa_client.is_admin = lambda chat_id, user_id: user_id == "bot"
    router.process_message("normal_user", "group_chat", True, "WhatsApp Group", ".mute @john 1m")
    assert "must be a group admin" in wa_client.sent_messages[-1]["message"]
    assert router.mute_manager.is_muted("group_chat", "john") is False

    # Test bot not admin
    wa_client.is_admin = lambda chat_id, user_id: user_id != "bot"
    router.process_message("admin_user", "group_chat", True, "WhatsApp Group", ".mute @john 1m")
    assert "Bot must be a group admin" in wa_client.sent_messages[-1]["message"]
    assert router.mute_manager.is_muted("group_chat", "john") is False

    # Test not group
    wa_client.is_admin = lambda chat_id, user_id: True
    router.process_message("admin_user", "private_chat", False, "Normal/Private Chat", ".mute @john 1m")
    assert "only be used in a WhatsApp group" in wa_client.sent_messages[-1]["message"]

def test_automatic_mute_enforcement(router, wa_client):
    import time
    wa_client.sent_messages = []
    wa_client.is_admin = lambda chat_id, user_id: True
    wa_client.delete_message = lambda row_testid: wa_client.sent_messages.append({"delete": row_testid})

    # Mute the user for 1 second
    router.process_message("admin", "group1", True, "WhatsApp Group", ".mute @target 1s")

    # 1. Active muted sender -> message is deleted
    router.process_message("target", "group1", True, "WhatsApp Group", "Hello", row_testid="msg1")
    assert {"delete": "msg1"} in wa_client.sent_messages

    # 2. Unmuted sender -> message is not deleted
    router.process_message("innocent", "group1", True, "WhatsApp Group", "Hi", row_testid="msg2")
    assert {"delete": "msg2"} not in wa_client.sent_messages

    # 3. Expired mute -> message is not deleted
    time.sleep(1.1)
    router.process_message("target", "group1", True, "WhatsApp Group", "I am back", row_testid="msg3")
    assert {"delete": "msg3"} not in wa_client.sent_messages

def test_automatic_mute_enforcement_mismatch(router, wa_client):
    wa_client.sent_messages = []
    wa_client.is_admin = lambda chat_id, user_id: True
    wa_client.delete_message = lambda row_testid: wa_client.sent_messages.append({"delete": row_testid})

    # Admin mutes 'JOSHZY TECH'
    router.process_message("admin", "group1", True, "WhatsApp Group", ".mute @JOSHZY TECH 10s")

    # The incoming sender might have a tilde (unsaved contact) or different casing
    router.process_message("~JOSHZY TECH", "group1", True, "WhatsApp Group", "Hello", row_testid="msg_with_tilde")
    assert {"delete": "msg_with_tilde"} in wa_client.sent_messages
