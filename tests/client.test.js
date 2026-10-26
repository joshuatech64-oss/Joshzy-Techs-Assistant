jest.mock('@whiskeysockets/baileys', () => {
    return {
        areJidsSameUser: (a, b) => {
            const normalize = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';
            return normalize(a) === normalize(b) && normalize(a) !== '';
        },
        useMultiFileAuthState: jest.fn().mockResolvedValue({ state: {}, saveCreds: jest.fn() }),
        DisconnectReason: {},
        downloadMediaMessage: jest.fn().mockResolvedValue(Buffer.from('fake-media')),
        default: jest.fn().mockReturnValue({
            ev: { on: jest.fn() }
        })
    };
});
const WhatsAppClient = require('../src/client');

describe('WhatsAppClient', () => {
    let client;
    
    beforeEach(() => {
        client = new WhatsAppClient(null, null);
        client.router = {
            process_message: jest.fn()
        };
        client.sock = {
            user: {
                id: '184237655347304:9@s.whatsapp.net',
                lid: '184237655347304:9@lid'
            },
            groupMetadata: jest.fn(),
            signalRepository: {
                lidMapping: {
                    getPNForLID: jest.fn()
                }
            }
        };
    });

    test('is_admin should match bot LID correctly in Baileys 7.x', async () => {
        client.sock.groupMetadata.mockResolvedValue({
            participants: [
                { id: '76086016790776@lid', admin: null },
                { id: '270218504970282@lid', admin: 'admin' },
                { id: '38062402875612@lid', admin: null },
                { id: '184237655347304@lid', admin: 'superadmin' }
            ]
        });

        const isBotAdmin = await client.is_admin('12345@g.us', 'bot');
        expect(isBotAdmin).toBe(true);
    });

    test('is_admin should correctly match human user', async () => {
        client.sock.groupMetadata.mockResolvedValue({
            participants: [
                { id: '76086016790776@s.whatsapp.net', admin: null },
                { id: '270218504970282@s.whatsapp.net', admin: 'admin' },
            ]
        });

        const isUserAdmin = await client.is_admin('12345@g.us', '270218504970282');
        expect(isUserAdmin).toBe(true);
        
        const isOtherAdmin = await client.is_admin('12345@g.us', '76086016790776');
        expect(isOtherAdmin).toBe(false);
    });

    test('getCanonicalJid should resolve LID to PN if mapping exists', async () => {
        client.sock.signalRepository.lidMapping.getPNForLID.mockResolvedValue('76086016790776@s.whatsapp.net');
        const result = await client.getCanonicalJid('112233@lid');
        expect(result).toBe('76086016790776@s.whatsapp.net');
    });

    test('Incoming LID message routes using resolved Phone Number', async () => {
        client.sock.signalRepository.lidMapping.getPNForLID.mockResolvedValue('76086016790776@s.whatsapp.net');
        
        // Mock the event handler attached during client.initialize()
        let handler;
        client.sock.ev = { on: jest.fn((event, cb) => {
            if (event === 'messages.upsert') handler = cb;
        }) };
        
        // Directly call the binding logic to avoid starting the real socket
        const _start = async () => {
            client.sock.ev.on('messages.upsert', async ({ messages, type }) => {
                const isGroup = messages[0].key.remoteJid.endsWith('@g.us');
                let senderId = messages[0].key.participant || messages[0].key.remoteJid;
                let resolvedSenderId = await client.getCanonicalJid(senderId);
                let finalId = resolvedSenderId.split('@')[0];
                await client.router.process_message(
                    finalId,
                    messages[0].key.remoteJid,
                    isGroup,
                    'WhatsApp Group',
                    'Hello',
                    '',
                    JSON.stringify(messages[0].key)
                );
            });
        };
        client.sock.ev = { on: jest.fn((event, cb) => {
             if (event === 'messages.upsert') handler = cb;
        }) };
        await _start();

        const fakeMsg = {
            messages: [{
                key: { participant: '112233@lid', remoteJid: '12345@g.us', fromMe: false },
                message: { conversation: 'Hello' }
            }],
            type: 'notify'
        };

        await handler(fakeMsg);

        // Expect the router to receive the resolved phone number '76086016790776'
        // and the original m.key stringified exactly as-is.
        expect(client.router.process_message).toHaveBeenCalledWith(
            '76086016790776',
            '12345@g.us',
            true,
            'WhatsApp Group',
            'Hello',
            '',
            JSON.stringify(fakeMsg.messages[0].key)
        );
    });

    describe('extract_view_once', () => {
        beforeEach(() => {
            client.sock.sendMessage = jest.fn().mockResolvedValue({});
            client.send_message = jest.fn().mockResolvedValue({});
        });

        test('should deliver media to resolved bot JID when invoked from bot account without progress or success message', async () => {
            const rawMsg = {
                key: { remoteJid: 'group123@g.us', fromMe: true, id: 'msg123' },
                message: {
                    extendedTextMessage: {
                        text: '.ex',
                        contextInfo: {
                            stanzaId: 'quoted123',
                            participant: 'sender123@s.whatsapp.net',
                            quotedMessage: {
                                viewOnceMessageV2: {
                                    message: {
                                        imageMessage: {
                                            viewOnce: true,
                                            caption: 'Secret pic'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            await client.extract_view_once(rawMsg, 'bot');

            // 1. Should send the image to canonical bot JID ('184237655347304:9@s.whatsapp.net' -> '184237655347304:9@s.whatsapp.net')
            expect(client.sock.sendMessage).toHaveBeenCalledWith(
                '184237655347304:9@s.whatsapp.net',
                expect.objectContaining({
                    image: Buffer.from('fake-media'),
                    caption: 'Secret pic'
                })
            );

            // 2. Should NOT send any progress or success message
            expect(client.send_message).not.toHaveBeenCalled();
        });

        test('should deliver media to external user JID when invoked from external account', async () => {
            const rawMsg = {
                key: { remoteJid: 'group123@g.us', fromMe: false, id: 'msg456' },
                message: {
                    extendedTextMessage: {
                        text: '.ex',
                        contextInfo: {
                            stanzaId: 'quoted456',
                            participant: 'otheruser@s.whatsapp.net',
                            quotedMessage: {
                                viewOnceMessage: {
                                    message: {
                                        videoMessage: {
                                            viewOnce: true,
                                            caption: 'Secret video'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            await client.extract_view_once(rawMsg, '1234567890');

            expect(client.sock.sendMessage).toHaveBeenCalledWith(
                '1234567890@s.whatsapp.net',
                expect.objectContaining({
                    video: Buffer.from('fake-media'),
                    caption: 'Secret video'
                })
            );
            expect(client.send_message).not.toHaveBeenCalled();
        });

        test('should report genuine error if replied message is not view once', async () => {
            const rawMsg = {
                key: { remoteJid: 'chat123@s.whatsapp.net', fromMe: true },
                message: {
                    extendedTextMessage: {
                        text: '.ex',
                        contextInfo: {
                            quotedMessage: {
                                conversation: 'Just a regular message'
                            }
                        }
                    }
                }
            };

            await client.extract_view_once(rawMsg, 'bot');

            expect(client.sock.sendMessage).not.toHaveBeenCalled();
            expect(client.send_message).toHaveBeenCalledWith(
                'chat123@s.whatsapp.net',
                expect.stringContaining('❌ The replied message is not a view once message')
            );
        });

        test('should report genuine error if extraction/download fails', async () => {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            downloadMediaMessage.mockRejectedValueOnce(new Error('Download timeout'));

            const rawMsg = {
                key: { remoteJid: 'group123@g.us', fromMe: true },
                message: {
                    extendedTextMessage: {
                        text: '.ex',
                        contextInfo: {
                            quotedMessage: {
                                viewOnceMessageV2: {
                                    message: {
                                        imageMessage: { viewOnce: true }
                                    }
                                }
                            }
                        }
                    }
                }
            };

            await client.extract_view_once(rawMsg, 'bot');

            expect(client.send_message).toHaveBeenCalledWith(
                'group123@g.us',
                '❌ Failed to extract view once message.'
            );
        });
    });
});
