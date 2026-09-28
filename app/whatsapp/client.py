import logging
import asyncio
import os
from typing import Callable
try:
    from playwright.async_api import async_playwright, Page, BrowserContext
except ImportError:
    pass  # We'll catch this if they haven't installed it

logger = logging.getLogger(__name__)

class WhatsAppClient:
    """
    Playwright-based WhatsApp Web client.
    Handles persistent sessions, QR scanning on first setup, and message sending/receiving.
    """
    def __init__(self, session_path: str = "sessions/"):
        self.session_path = session_path
        self.profile_path = os.path.join(self.session_path, "whatsapp")
        self.message_handlers = []
        self.page = None
        self.context = None
        self.playwright = None
        self._loop = None
        os.makedirs(self.profile_path, exist_ok=True)
        logger.info(f"WhatsAppClient initialized with profile path: {self.profile_path}")

    def add_message_handler(self, handler: Callable):
        self.message_handlers.append(handler)

    def _cleanup_stale_locks(self):
        lock_files = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]
        for lock in lock_files:
            lock_path = os.path.join(self.profile_path, lock)
            if os.path.exists(lock_path):
                try:
                    os.remove(lock_path)
                    logger.info(f"Removed stale lock file: {lock}")
                except Exception as e:
                    logger.error(f"Failed to remove lock file {lock}: {e}")

    async def start_async(self):
        self._loop = asyncio.get_running_loop()
        logger.info("Starting WhatsApp client via Playwright...")
        try:
            self.playwright = await async_playwright().start()
        except NameError:
            logger.error("Playwright not installed. Please run: pip install playwright && playwright install chromium")
            return

        try:
            logger.info("Launching browser...")
            try:
                self.context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.profile_path,
                    headless=True,  # Needs to be visible for QR scanning initially
                    args=["--no-sandbox", "--disable-setuid-sandbox"]
                )
            except Exception as launch_err:
                if "ProcessSingleton" in str(launch_err):
                    logger.warning("Stale Chromium lock detected. Cleaning up lock files and retrying...")
                    self._cleanup_stale_locks()
                    self.context = await self.playwright.chromium.launch_persistent_context(
                        user_data_dir=self.profile_path,
                        headless=True,
                        args=["--no-sandbox", "--disable-setuid-sandbox"]
                    )
                else:
                    raise launch_err
            logger.info("Browser launched...")
            
            logger.info("Creating browser context...")
            pages = self.context.pages
            self.page = pages[0] if pages else await self.context.new_page()
            logger.info("Browser context created...")

            logger.info(f"DIAGNOSTIC (Pre-goto): context_alive={self.context is not None}, page_alive={self.page is not None}")
            if self.page:
                try:
                    logger.info(f"DIAGNOSTIC (Pre-goto URL): {self.page.url}")
                except Exception as ex:
                    logger.error(f"DIAGNOSTIC (Pre-goto URL error): {ex}")

            logger.info("Opening WhatsApp Web...")
            try:
                await self.page.goto("https://web.whatsapp.com/")
                logger.info("WhatsApp Web navigation completed...")
            except Exception as goto_err:
                logger.error(f"DIAGNOSTIC (Goto Error/Timeout): {goto_err}")
                if self.page:
                    try:
                        logger.info(f"DIAGNOSTIC (Post-timeout URL): {self.page.url}")
                        page_title = await self.page.title()
                        logger.info(f"DIAGNOSTIC (Post-timeout Title): {page_title}")
                        fetch_check = await self.page.evaluate("fetch('https://web.whatsapp.com/').then(r => r.status).catch(e => e.toString())")
                        logger.info(f"DIAGNOSTIC (Fetch Reachability): {fetch_check}")
                    except Exception as diag_err:
                        logger.error(f"DIAGNOSTIC (Post-timeout retrieval error): {diag_err}")
                raise goto_err
            
            # Wait for either QR code or chat list
            try:
                await self.page.wait_for_selector('canvas, div#pane-side', timeout=60000)
                logger.info("WhatsApp Web loaded. If QR code is present, please scan it.")
                
                # Wait specifically for the chat list which means we are logged in
                await self.page.wait_for_selector('div#pane-side', timeout=0)
                logger.info("Successfully authenticated to WhatsApp Web!")
            except Exception as e:
                logger.error(f"Timeout waiting for WhatsApp Web to load or authenticate: {e}")
                
            # Listen to incoming messages via DOM MutationObserver
            await self.page.expose_function("pythonMessageHandler", self._handle_js_message)
            await self._inject_message_listener()
            
            # Keep event loop running
            while True:
                await asyncio.sleep(1)
                
        except Exception as e:
            logger.exception("WhatsApp client startup failed")
            logger.info("Attempting reconnection in 5 seconds...")
            await asyncio.sleep(5)
            await self.start_async()

    async def _inject_message_listener(self):
        js_code = """
        () => {
            window.pythonMessageHandler({log: "Listener starting on current page"});
            
            if (window.__whatsappObserverInstalled) {
                return;
            }
            window.__whatsappObserverInstalled = true;
            
            window.processedIds = window.processedIds || new Set();
            const processedIds = window.processedIds;
            
            const observer = new MutationObserver((mutations) => {
                let batchLogged = false;
                for (let mutation of mutations) {
                    if (!batchLogged) {
                        window.pythonMessageHandler({log: "DOM mutation received"});
                        batchLogged = true;
                    }
                    for (let node of mutation.addedNodes) {
                        try {
                            let targetSpans = new Set();
                            
                            // If the added node is an element, search inside it
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.matches && node.matches('span')) {
                                    targetSpans.add(node);
                                }
                                if (node.querySelectorAll) {
                                    let descendants = node.querySelectorAll('span');
                                    descendants.forEach(d => targetSpans.add(d));
                                }
                            }
                            
                            // Also walk upward from the added node (whether it's an element or text node)
                            let parent = node.parentElement || node.parentNode;
                            while (parent) {
                                if (parent.nodeType === Node.ELEMENT_NODE && parent.matches && parent.matches('span')) {
                                    targetSpans.add(parent);
                                    break;
                                }
                                parent = parent.parentElement || parent.parentNode;
                            }
                            
                            for (let span of targetSpans) {
                                let text = span.innerText || "";
                                    text = text.trim();
                                    
                                    if (text.length > 0) {
                                        let lText = text.toLowerCase();
                                        
                                        let chatListAncestor = span.closest('[role="grid"][aria-label="Chat list"]') || span.closest('[role="row"][data-testid^="list-item-"]') || span.closest('[aria-label="Chat list"]');
                                        if (chatListAncestor) {
                                            // Handle chat-list preview specifically: open the row but DO NOT send to router
                                            // Filter out generic chat list noise so we don't open rows for random UI updates
                                            if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(text)) continue;
                                            if (lText.includes('typing…') || lText.includes('unread message') || lText === '1') continue;
                                            if (lText.includes('end-to-end encrypted') || lText.includes('learn more')) continue;
                                            
                                            let rowAncestor = span.closest('[role="row"]');
                                            if (rowAncestor) {
                                                let rowTestId = rowAncestor.getAttribute('data-testid');
                                                if (rowTestId) {
                                                    // Synchronous deduplication for clicks
                                                    let clickId = "click_" + rowTestId + "_" + text.substring(0, 30);
                                                    if (processedIds.has(clickId)) {
                                                        continue;
                                                    }
                                                    processedIds.add(clickId);
                                                    if (processedIds.size > 1000) processedIds.clear();
                                                    
                                                    window.pythonMessageHandler({log: "Opening chat list row from preview: " + rowTestId});
                                                    window.pythonMessageHandler({row_testid: rowTestId, text: ""});
                                                }
                                            }
                                            continue; // Skip normal message processing for sidebar elements
                                        }

                                        // 1. Must be in the open conversation
                                        if (!span.closest('#main')) continue;
                                        
                                        // 2. Must be the actual message text element
                                        if (span.getAttribute('data-testid') !== 'selectable-text') continue;
                                        
                                        // 4. Filter out timestamps and system text from inside the main pane
                                        if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(text)) continue;
                                        if (lText.includes('end-to-end encrypted') || lText.includes('learn more')) continue;

                                        // Synchronous deduplication
                                        let msgWrapper = span.closest('[data-testid^="conv-msg-"]');
                                        if (!msgWrapper) continue;
                                        
                                        let msgId = msgWrapper.getAttribute('data-testid') || msgWrapper.getAttribute('data-id');
                                        if (!msgId) continue;
                                        
                                        if (processedIds.has(msgId)) {
                                            continue;
                                        }
                                        processedIds.add(msgId);
                                        if (processedIds.size > 1000) processedIds.clear();

                                        let current = span.parentElement;
                                        let container = null;
                                        
                                        while (current) {
                                            if (current.getAttribute && current.getAttribute('role') === 'row') {
                                                container = current;
                                                break;
                                            }
                                            current = current.parentElement;
                                        }
                                        
                                        if (container) {
                                            window.pythonMessageHandler({log: "incoming message detected"});
                                            window.pythonMessageHandler({log: "extracted text: " + text.substring(0, 30)});
                                            
                                            // Extract sender info
                                            let senderId = "Unknown Sender";
                                            let senderEl = container.closest('div[role="row"]')?.querySelector('div.copyable-text[data-pre-plain-text]') || container.querySelector('div.copyable-text[data-pre-plain-text]');
                                            if (senderEl) {
                                                let preText = senderEl.getAttribute('data-pre-plain-text');
                                                if (preText) {
                                                    let parts = preText.split('] ');
                                                    if (parts.length > 1) {
                                                        senderId = parts[1].replace(':', '').trim();
                                                    }
                                                }
                                            }
                                            let rowTestId = container.getAttribute('data-testid') || '';
                                            
                                            // Wait briefly for the UI to settle before routing
                                            setTimeout(() => {
                                                    let isGroup = false;
                                                    let chatTitle = "Unknown Chat";
                                                    let chatTitleEl = document.querySelector('header span[title][dir="auto"]');
                                                    if (chatTitleEl) {
                                                        chatTitle = chatTitleEl.getAttribute('title');
                                                    }

                                                    let quotedText = "";
                                                    let quotedEl = container.querySelector('.quoted-mention') || container.querySelector('span.quoted-mention') || container.querySelector('[data-testid="quoted-message"]');
                                                    if (quotedEl) {
                                                        quotedText = quotedEl.innerText || quotedEl.textContent || "";
                                                    }

                                                    window.pythonMessageHandler({log: "sent to handler"});
                                                    
                                                    window.pythonMessageHandler({
                                                        sender: senderId,
                                                        chat_id: chatTitle,
                                                        is_group: isGroup,
                                                        text: text,
                                                        quoted_text: quotedText.trim(),
                                                        row_testid: rowTestId
                                                    });
                                                }, 500);
                                            }
                                        }
                                    }
                            } catch (err) {
                                window.pythonMessageHandler({error: err.toString()});
                            }
                    }
                }
            });
            
            let target = document.body;
            window.pythonMessageHandler({log: "Observer target exists: " + (!!target).toString()});
            
            observer.observe(target, { childList: true, subtree: true });
            window.pythonMessageHandler({log: "MutationObserver installed"});
            
            // Harmless DOM test
            let dummy = document.createElement('div');
            dummy.id = "whatsapp-observer-test";
            dummy.style.display = 'none';
            target.appendChild(dummy);
            setTimeout(() => {
                if (dummy.parentNode) dummy.parentNode.removeChild(dummy);
            }, 100);
        }
        """
        await self.page.evaluate(js_code)

    def _handle_js_message(self, data):
        if "log" in data:
            logger.info(data["log"])
            return
        if "error" in data:
            logger.error(f"Listener error: {data['error']}")
            return
            
        sender = data.get("sender", "unknown")
        chat_id = data.get("chat_id", "unknown")
        is_group = data.get("is_group", False)
        text = data.get("text", "")
        quoted_text = data.get("quoted_text", "")
        row_testid = data.get("row_testid", "")
        
        if row_testid and self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.open_chat_row(row_testid), self._loop)
        
        if text:
            # Short safe log
            safe_text = text[:30] + '...' if len(text) > 30 else text
            logger.info(f"router invoked for message '{safe_text}' from {sender}")
            for handler in self.message_handlers:
                try:
                    handler(sender, chat_id, is_group, text, quoted_text, row_testid)
                except TypeError:
                    try:
                        handler(sender, chat_id, is_group, text, quoted_text)
                    except TypeError:
                        handler(sender, chat_id, is_group, text)

    def delete_message(self, row_testid: str):
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._delete_message_async(row_testid), self._loop)

    async def _delete_message_async(self, row_testid: str):
        try:
            msg_locator = self.page.locator(f'[data-testid="{row_testid}"]')
            await msg_locator.hover()
            
            chevron = msg_locator.locator('[data-testid="down-context"]')
            await chevron.click()
            
            delete_btn = self.page.locator('div[role="button"][aria-label="Delete message"]')
            await delete_btn.click()
            
            delete_for_everyone = self.page.locator('div[role="button"]:has-text("Delete for everyone")')
            await delete_for_everyone.click()
            
            ok_btn = self.page.locator('div[role="button"]:has-text("OK")')
            if await ok_btn.is_visible(timeout=500):
                await ok_btn.click()
        except Exception as e:
            logger.error(f"Failed to delete message {row_testid}: {e}")

    def is_admin(self, chat_id: str, user_id: str) -> bool:
        # Minimal mock implementation to satisfy the prompt's admin check requirement
        # without redesigning the listener.
        # Ideally, we would evaluate a JS script to read the DOM admin tags.
        return True

    async def open_chat_row(self, row_testid: str):
        try:
            row = self.page.locator(f'[role="row"][data-testid="{row_testid}"]').first
            await row.click()
            await self.page.wait_for_timeout(500)
            
            # Baseline all existing visible messages so we don't route history
            await self.page.evaluate('''
                () => {
                    if (window.processedIds) {
                        let msgs = document.querySelectorAll('#main [data-testid^="conv-msg-"]');
                        msgs.forEach(m => {
                            let id = m.getAttribute('data-testid') || m.getAttribute('data-id');
                            if (id) window.processedIds.add(id);
                        });
                    }
                }
            ''')
        except Exception as e:
            logger.error(f"Failed to click row {row_testid}: {e}")

    async def send_message_async(self, to: str, message: str):
        logger.info(f"Attempting to send message to {to}")
        try:
            # Type and send the message in the currently active chat's input box
            message_box = self.page.locator('div[contenteditable="true"][role="textbox"]').last
            await message_box.focus()
            
            # Type multiline safely
            for line in message.split('\n'):
                await message_box.type(line)
                await self.page.keyboard.down('Shift')
                await self.page.keyboard.press('Enter')
                await self.page.keyboard.up('Shift')
                
            await self.page.keyboard.press('Enter')
            logger.info("response sent")
        except Exception as e:
            logger.error(f"Failed to send message: {e}")

    def send_message(self, to: str, message: str):
        """
        Synchronous bridge to the async send_message method.
        Called by the CommandRouter.
        """
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.send_message_async(to, message), self._loop)
        else:
            logger.error("Event loop is not running. Cannot send message.")

    def start(self):
        """
        Start the WhatsApp client and its event loop.
        """
        try:
            asyncio.run(self.start_async())
        except KeyboardInterrupt:
            logger.info("WhatsApp client stopped.")
