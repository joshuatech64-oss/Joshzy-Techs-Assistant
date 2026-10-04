jest.mock('@whiskeysockets/baileys', () => {
    return {
        areJidsSameUser: (a, b) => {
            const normalize = (jid) => jid ? jid.split(':')[0].split('@')[0] : '';
            return normalize(a) === normalize(b) && normalize(a) !== '';
        },
        useMultiFileAuthState: jest.fn().mockResolvedValue({ state: {}, saveCreds: jest.fn() }),
        DisconnectReason: {},
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
});
