import os
import logging
try:
    import google.generativeai as genai
except ImportError:
    genai = None

logger = logging.getLogger(__name__)

class Translator:
    def __init__(self):
        self.api_key = os.environ.get("GEMINI_API_KEY")
        if self.api_key:
            genai.configure(api_key=self.api_key)
            self.model = genai.GenerativeModel("gemini-2.5-flash")
        else:
            self.model = None

    def translate(self, text: str, target_lang: str = "English") -> str:
        if not self.model:
            return "❌ Translation unavailable: GEMINI_API_KEY is missing or invalid in the configuration."
        
        prompt = f"""
You are a highly accurate translator. 
Translate the following text into {target_lang}. 
Automatically detect the source language. 
Preserve the original meaning and natural tone. 
Return ONLY the translation, with no explanation, no quotes, and no extra commentary.

Text to translate:
{text}
"""
        try:
            response = self.model.generate_content(prompt)
            return response.text.strip()
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return "❌ Translation failed. Please try again later."
