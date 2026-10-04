const CommandRouter = require('../src/router');
const MuteManager = require('../src/mute');

describe('CommandRouter', () => {
    let mockDb;
    let mockWaClient;
    let router;

    beforeEach(() => {
        mockDb = {
            add_user: jest.fn(),
            add_group: jest.fn(),
            ping: jest.fn().mockResolvedValue(true),
            get_spotify_connection: jest.fn().mockResolvedValue(null)
        };

        mockWaClient = {
            send_message: jest.fn(),
            delete_message: jest.fn(),
            is_admin: jest.fn().mockResolvedValue(true),
            getCanonicalJid: jest.fn(async (jid) => {
                if (jid === '184237655347304@lid') return '2349167462468@s.whatsapp.net';
                return jid;
            }),
            sock: {
                groupMetadata: jest.fn().mockResolvedValue({
                    participants: [
                        { id: '184237655347304@lid' }
                    ]
                })
            }
        };

        router = new CommandRouter(mockDb, mockWaClient);
    });

    test('.ping command', async () => {
        await router.process_message('user1', 'chat1', false, 'Private', '.ping');
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1',
            expect.stringContaining('Pong!')
        );
    });

    test('.help command', async () => {
        await router.process_message('user1', 'chat1', false, 'Private', '.help');
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1',
            expect.stringContaining('Available Commands:')
        );
    });

    test('.mute command validates admin', async () => {
        mockWaClient.is_admin.mockResolvedValueOnce(false); // sender not admin
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.mute @target 5m');
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1@g.us',
            expect.stringContaining('❌ You must be a group admin')
        );
    });

    test('.mute sets up correctly', async () => {
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.mute @target 5m');
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1@g.us',
            expect.stringContaining('has been muted')
        );
        expect(router.mute_manager.is_muted('chat1@g.us', 'target')).toBe(true);
    });
    
    test('.unmute removes mute', async () => {
        router.mute_manager.mute('chat1@g.us', 'target', 300);
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.unmute @target');
        expect(router.mute_manager.is_muted('chat1@g.us', 'target')).toBe(false);
    });

    test('.mute with PN remains PN', async () => {
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.mute @2349167462468 60s');
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1@g.us',
            expect.stringContaining('✅ @2349167462468 has been muted')
        );
        expect(router.mute_manager.is_muted('chat1@g.us', '2349167462468')).toBe(true);
    });

    test('.mute with LID resolves to PN', async () => {
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.mute @184237655347304 60s');
        // Because of the mock getCanonicalJid returning '2349167462468@s.whatsapp.net' for '184237655347304@lid'
        expect(mockWaClient.send_message).toHaveBeenCalledWith(
            'chat1@g.us',
            expect.stringContaining('✅ @2349167462468 has been muted')
        );
        expect(router.mute_manager.is_muted('chat1@g.us', '2349167462468')).toBe(true);
        expect(router.mute_manager.is_muted('chat1@g.us', '184237655347304')).toBe(false);
    });

    test('.unmute with PN remains PN', async () => {
        router.mute_manager.mute('chat1@g.us', '2349167462468', 300);
        await router.process_message('user1', 'chat1@g.us', true, 'Group', '.unmute @2349167462468');
        expect(router.mute_manager.is_muted('chat1@g.us', '2349167462468')).toBe(false);
    });

    test('Muted message triggers delete_message with exact row_testid', async () => {
        router.mute_manager.mute('chat1@g.us', '2349167462468', 300);
        await router.process_message('2349167462468', 'chat1@g.us', true, 'Group', 'Hello', null, '{"fake":"key"}');
        expect(mockWaClient.delete_message).toHaveBeenCalledWith('chat1@g.us', '{"fake":"key"}');
    });

    test('Expired mute does not delete message', async () => {
        router.mute_manager.mute('chat1@g.us', '2349167462468', -10); // expired 10s ago
        await router.process_message('2349167462468', 'chat1@g.us', true, 'Group', 'Hello', null, '{"fake":"key"}');
        expect(mockWaClient.delete_message).not.toHaveBeenCalled();
    });
});
