import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        user_data_dir = "sessions/whatsapp"
        
        print("Launching browser...")
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=True,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        )
        
        page = browser.pages[0] if browser.pages else await browser.new_page()
        
        print("Navigating to WhatsApp Web...")
        await page.goto('https://web.whatsapp.com/', wait_until='networkidle')
        
        print("Waiting for chat list...")
        try:
            await page.wait_for_selector('div#pane-side', timeout=30000)
            print("Chat list loaded.")
            
            # Click the first chat to open #main
            await page.click('div#pane-side [role="row"]:nth-child(1)')
            await page.wait_for_selector('#main', timeout=10000)
            print("Chat opened.")
            
            # Dump the HTML of #main
            html = await page.evaluate("document.querySelector('#main').outerHTML")
            with open("scratch/whatsapp_main.html", "w", encoding="utf-8") as f:
                f.write(html)
            
            # Also dump a summary of message-like elements
            msg_summary = await page.evaluate("""
                () => {
                    return Array.from(document.querySelectorAll('#main div[role="row"]')).map(row => {
                        return {
                            className: row.className,
                            innerHTML: row.innerHTML.substring(0, 150) + '...',
                            dataTestId: row.getAttribute('data-testid'),
                            dataId: row.getAttribute('data-id')
                        }
                    });
                }
            """)
            
            with open("scratch/whatsapp_rows.txt", "w", encoding="utf-8") as f:
                for row in msg_summary:
                    f.write(f"--- Row ---\nClass: {row['className']}\ndata-testid: {row['dataTestId']}\ndata-id: {row['dataId']}\nHTML: {row['innerHTML']}\n\n")
                    
            print("Dumped DOM to scratch/whatsapp_main.html and scratch/whatsapp_rows.txt")
        except Exception as e:
            print(f"Error: {e}")
            # Try dumping whatever is there
            html = await page.content()
            with open("scratch/whatsapp_error_dump.html", "w", encoding="utf-8") as f:
                f.write(html)
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
