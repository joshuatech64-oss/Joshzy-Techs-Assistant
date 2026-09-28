# WhatsApp Music Bot (Foundation)

This is a foundation for a WhatsApp Web-based music bot.

## Project Structure
- `app/whatsapp`: Playwright-based WhatsApp Web Client
- `app/database`: SQLite local storage
- `app/commands`: Message routing and basic commands
- `main.py`: Entry point

## Prerequisites
- Python >= 3.14.7

## Installation
1. Clone this repository or copy the files.
2. Install the required dependencies:
   ```bash
   pip install -e .
   ```
3. Install Playwright browser dependencies (Crucial step):
   ```bash
   pip install playwright
   playwright install chromium
   ```
4. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

## Starting the Bot & Authentication
1. Start the bot by running:
   ```bash
   python main.py
   ```
2. **First Run**: A Chromium browser window will pop up automatically displaying WhatsApp Web.
3. Open WhatsApp on your phone, go to **Linked Devices**, and **scan the QR code** on the screen.
4. Once authenticated, the bot will detect your chats and start listening for messages in the background.

## Persistent Sessions
You **do not** need to scan the QR code every time. 
The browser session and login data are persistently stored in the `sessions/` directory. 
To restart the bot, simply run `python main.py` again. As long as `sessions/` remains intact, it will bypass the QR code and resume exactly where it left off.

## Spotify Developer Application Setup
To enable Spotify features, you must create a Spotify Developer application:
1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an App.
3. Edit the App settings and add `http://127.0.0.1:8888/callback` as a Redirect URI.
4. Note your Client ID and Client Secret.

## Environment Variables
The following environment variables are required in your `.env` file:
- `SPOTIFY_CLIENT_ID`: Your Spotify application Client ID.
- `SPOTIFY_CLIENT_SECRET`: Your Spotify application Client Secret.
- `SPOTIFY_REDIRECT_URI`: Must be set to `http://127.0.0.1:8888/callback`.
- `DATABASE_PATH`: Path to SQLite database (e.g., `data/bot.db`).
- `WHATSAPP_SESSION_PATH`: Path to WhatsApp session data.

## Commands
Try sending `.ping` or `.help` to the bot from a linked number or a different device!
The bot will correctly extract the sender, determine if it's a private chat or a group, and send a reply.

### Spotify Commands
- `.spotify connect`: Generates a unique authorization link for you to connect your Spotify account. Open the link to authorize, and you will be redirected to the local callback server.
- `.spotify`: Check your current Spotify connection status.
- `.spotify disconnect`: Remove your connected Spotify account.

## Troubleshooting
- **Playwright Not Found Error**: Make sure you ran `python -m playwright install chromium`.
- **Browser Closes Immediately**: Check the terminal logs for crash reports.
- **Not Responding**: The underlying DOM on WhatsApp Web updates frequently. If messages are not being received, check if WhatsApp has pushed an update changing `message-in` CSS classes.

## Running Tests
```bash
python -m pytest tests/
```
