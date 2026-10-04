const axios = require('axios');

class Translator {
    constructor() {
        this.api_key = process.env.GEMINI_API_KEY;
    }

    async translate(text, target_lang = "English") {
        if (!this.api_key) {
            return "❌ Translation unavailable: GEMINI_API_KEY is missing or invalid in the configuration.";
        }

        const prompt = `You are a highly accurate translator. 
Translate the following text into ${target_lang}. 
Automatically detect the source language. 
Preserve the original meaning and natural tone. 
Return ONLY the translation, with no explanation, no quotes, and no extra commentary.

Text to translate:
${text}`;

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.api_key}`;
            const payload = {
                contents: [{ parts: [{ text: prompt }] }]
            };
            
            const response = await axios.post(url, payload, {
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (response.data && response.data.candidates && response.data.candidates.length > 0) {
                return response.data.candidates[0].content.parts[0].text.trim();
            } else {
                throw new Error("Unexpected response structure");
            }
        } catch (error) {
            console.error(`Translation failed: ${error.message}`);
            return "❌ Translation failed. Please try again later.";
        }
    }
}

module.exports = Translator;
