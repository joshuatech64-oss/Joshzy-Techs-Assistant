import os
import pytest
from dotenv import load_dotenv
from app.database.db import Database

# Load actual environment variables
load_dotenv()

@pytest.mark.skipif(not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_KEY"), reason="Supabase credentials not found")
def test_real_supabase_crud():
    db = Database()
    assert db.client is not None, "Database client should be initialized"
    
    test_user_id = "test_user_crud_12345"
    
    try:
        # Create/upsert a test user
        db.add_user(test_user_id)
        
        # Read the user back
        response = db.client.table("users").select("*").eq("id", test_user_id).execute()
        assert len(response.data) > 0, "Test user was not inserted successfully"
        assert response.data[0]["id"] == test_user_id
        
    finally:
        # Clean up/delete the test user
        db.client.table("users").delete().eq("id", test_user_id).execute()
        
        # Verify deletion
        verify = db.client.table("users").select("*").eq("id", test_user_id).execute()
        assert len(verify.data) == 0, "Test user was not cleaned up"
