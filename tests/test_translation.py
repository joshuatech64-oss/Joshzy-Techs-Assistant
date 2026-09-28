import pytest
import sys
from unittest.mock import patch, MagicMock

# Create a dummy module for google.generativeai to avoid import errors during test collection
dummy_genai = MagicMock()
sys.modules['google.generativeai'] = dummy_genai
sys.modules['google'] = MagicMock()

from app.translation.translator import Translator

@patch("app.translation.translator.genai")
def test_translator_success(mock_genai, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test_key")
    
    mock_model = MagicMock()
    mock_response = MagicMock()
    mock_response.text = "Hola"
    mock_model.generate_content.return_value = mock_response
    mock_genai.GenerativeModel.return_value = mock_model
    
    translator = Translator()
    assert translator.api_key == "test_key"
    mock_genai.configure.assert_called_with(api_key="test_key")
    
    result = translator.translate("Hello")
    assert result == "Hola"
    mock_model.generate_content.assert_called_once()
    args, kwargs = mock_model.generate_content.call_args
    assert "Text to translate:\nHello" in args[0]

def test_translator_missing_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    translator = Translator()
    assert translator.model is None
    
    result = translator.translate("Hello")
    assert "Translation unavailable" in result
    assert "GEMINI_API_KEY" in result

@patch("app.translation.translator.genai")
def test_translator_failure(mock_genai, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test_key")
    
    mock_model = MagicMock()
    mock_model.generate_content.side_effect = Exception("API Error")
    mock_genai.GenerativeModel.return_value = mock_model
    
    translator = Translator()
    result = translator.translate("Hello")
    assert "Translation failed" in result
