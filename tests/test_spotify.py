import pytest
import time
from unittest.mock import patch, MagicMock
from app.database.db import Database
from app.spotify.auth import SpotifyAuth
import os

class MockDatabase(Database):
    def __init__(self, *args, **kwargs):
        self.spotify_connections = {}
        self.client = True

    def get_spotify_connection(self, user_id: str):
        return self.spotify_connections.get(user_id)

    def set_spotify_connection(self, user_id, spotify_id, display_name, access_token, refresh_token, expires_at):
        self.spotify_connections[user_id] = {
            "user_id": user_id,
            "spotify_id": spotify_id,
            "display_name": display_name,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at
        }

    def delete_spotify_connection(self, user_id: str) -> bool:
        if user_id in self.spotify_connections:
            del self.spotify_connections[user_id]
            return True
        return False

@pytest.fixture
def db():
    return MockDatabase()

@pytest.fixture
def spotify_auth(db):
    with patch.dict(os.environ, {
        "SPOTIFY_CLIENT_ID": "test_client_id",
        "SPOTIFY_CLIENT_SECRET": "test_client_secret",
        "SPOTIFY_REDIRECT_URI": "http://127.0.0.1:8888/callback"
    }):
        with patch("app.spotify.auth.SpotifyAuth._start_server"):
            return SpotifyAuth(db)

def test_store_and_retrieve_connection(db):
    # Test storing and retrieving Spotify connection from DB
    db.set_spotify_connection(
        user_id="user1",
        spotify_id="spotify_user_1",
        display_name="User One",
        access_token="access_1",
        refresh_token="refresh_1",
        expires_at=1000
    )
    
    conn = db.get_spotify_connection("user1")
    assert conn is not None
    assert conn["user_id"] == "user1"
    assert conn["spotify_id"] == "spotify_user_1"
    assert conn["display_name"] == "User One"
    assert conn["access_token"] == "access_1"

def test_user_isolation(db):
    db.set_spotify_connection(
        user_id="userA",
        spotify_id="spotifyA",
        display_name="User A",
        access_token="tokenA",
        refresh_token="refreshA",
        expires_at=1000
    )
    
    connB = db.get_spotify_connection("userB")
    assert connB is None
    
    connA = db.get_spotify_connection("userA")
    assert connA is not None
    assert connA["user_id"] == "userA"
    assert connA["access_token"] == "tokenA"

def test_disconnect_connection(db, spotify_auth):
    db.set_spotify_connection(
        user_id="user1",
        spotify_id="spotify1",
        display_name="User One",
        access_token="token1",
        refresh_token="refresh1",
        expires_at=1000
    )
    
    assert spotify_auth.get_user_info("user1") is not None
    
    # Disconnect
    assert spotify_auth.disconnect("user1") is True
    
    # Verify disconnected
    assert spotify_auth.get_user_info("user1") is None
    assert db.get_spotify_connection("user1") is None

def test_oauth_state_generation(spotify_auth):
    url = spotify_auth.get_auth_url("user123")
    assert "client_id=test_client_id" in url
    assert "state=" in url
    assert "redirect_uri" in url
    
    # State should be generated and stored
    state1 = list(spotify_auth.pending_states.keys())[0]
    assert spotify_auth.pending_states[state1] == "user123"
    
    url2 = spotify_auth.get_auth_url("user456")
    state2 = list(spotify_auth.pending_states.keys())[-1]
    assert state1 != state2
    assert spotify_auth.pending_states[state2] == "user456"

@patch("app.spotify.auth.SpotifyAuth._request_token")
def test_token_refresh(mock_request_token, db, spotify_auth):
    # Set an expired connection
    db.set_spotify_connection(
        user_id="user1",
        spotify_id="spotify1",
        display_name="User One",
        access_token="old_access",
        refresh_token="old_refresh",
        expires_at=int(time.time()) - 1000 # Expired
    )
    
    mock_request_token.return_value = {
        "access_token": "new_access",
        "refresh_token": "new_refresh", # Optional, but usually provided
        "expires_in": 3600
    }
    
    new_token = spotify_auth.refresh_token("user1")
    assert new_token == "new_access"
    
    mock_request_token.assert_called_once()
    args = mock_request_token.call_args[0][0]
    assert args["grant_type"] == "refresh_token"
    assert args["refresh_token"] == "old_refresh"
    
    # Verify DB updated
    conn = db.get_spotify_connection("user1")
    assert conn["access_token"] == "new_access"
    assert conn["refresh_token"] == "new_refresh"
    assert conn["expires_at"] > time.time() + 3500

@patch("app.spotify.auth.SpotifyAuth._request_token")
def test_valid_token_not_refreshed(mock_request_token, db, spotify_auth):
    # Set a valid connection
    db.set_spotify_connection(
        user_id="user1",
        spotify_id="spotify1",
        display_name="User One",
        access_token="valid_access",
        refresh_token="valid_refresh",
        expires_at=int(time.time()) + 3600 # Valid for 1 hour
    )
    
    token = spotify_auth.refresh_token("user1")
    assert token == "valid_access"
    
    # Should not call Spotify API
    mock_request_token.assert_not_called()
