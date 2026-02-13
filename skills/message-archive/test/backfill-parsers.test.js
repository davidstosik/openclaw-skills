/**
 * Tests for backfill parsers
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const {
    TelegramExportParser,
    WhatsAppExportParser,
    DiscordExportParser
} = require('../lib/backfill-parsers');
const fs = require('fs').promises;
const path = require('path');

const TEST_DIR = path.join(__dirname, 'test-exports');

describe('Backfill Parsers', () => {
    before(async () => {
        // Create test export files
        await fs.mkdir(TEST_DIR, { recursive: true });
    });

    after(async () => {
        // Clean up test files
        try {
            const files = await fs.readdir(TEST_DIR);
            for (const file of files) {
                await fs.unlink(path.join(TEST_DIR, file));
            }
            await fs.rmdir(TEST_DIR);
        } catch (err) {
            // Ignore cleanup errors
        }
    });

    describe('TelegramExportParser', () => {
        it('should parse Telegram JSON export', async () => {
            const testData = {
                name: 'Test Chat',
                id: 12345,
                messages: [
                    {
                        id: 1,
                        type: 'message',
                        date: '2026-02-13T10:00:00',
                        from: 'Alice',
                        from_id: 'user123',
                        text: 'Hello, world!'
                    },
                    {
                        id: 2,
                        type: 'message',
                        date: '2026-02-13T10:01:00',
                        from: 'You',
                        from_id: 'user_self',
                        text: 'Hi there!'
                    },
                    {
                        id: 3,
                        type: 'message',
                        date: '2026-02-13T10:02:00',
                        from: 'Alice',
                        from_id: 'user123',
                        text: [
                            'This is ',
                            { type: 'bold', text: 'formatted' },
                            ' text'
                        ]
                    }
                ]
            };

            const filePath = path.join(TEST_DIR, 'telegram-test.json');
            await fs.writeFile(filePath, JSON.stringify(testData, null, 2));

            const parser = new TelegramExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages.length, 3);
            
            // Check first message
            assert.strictEqual(messages[0].sender_name, 'Alice');
            assert.strictEqual(messages[0].direction, 'inbound');
            assert.strictEqual(messages[0].content_text, 'Hello, world!');
            assert.strictEqual(messages[0].channel, 'telegram');
            
            // Check second message (from self)
            assert.strictEqual(messages[1].direction, 'outbound');
            assert.strictEqual(messages[1].content_text, 'Hi there!');
            
            // Check formatted text parsing
            assert.strictEqual(messages[2].content_text, 'This is formatted text');
        });

        it('should handle different content types', async () => {
            const testData = {
                name: 'Media Chat',
                id: 67890,
                messages: [
                    {
                        id: 10,
                        type: 'message',
                        date: '2026-02-13T11:00:00',
                        from: 'Bob',
                        photo: 'photos/photo_1.jpg',
                        text: 'Check this out!'
                    },
                    {
                        id: 11,
                        type: 'message',
                        date: '2026-02-13T11:01:00',
                        from: 'Bob',
                        video_file: 'videos/video_1.mp4'
                    },
                    {
                        id: 12,
                        type: 'message',
                        date: '2026-02-13T11:02:00',
                        from: 'Bob',
                        voice_message: 'voice/voice_1.ogg'
                    }
                ]
            };

            const filePath = path.join(TEST_DIR, 'telegram-media.json');
            await fs.writeFile(filePath, JSON.stringify(testData, null, 2));

            const parser = new TelegramExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages[0].content_type, 'image');
            assert.strictEqual(messages[1].content_type, 'video');
            assert.strictEqual(messages[2].content_type, 'audio');
        });
    });

    describe('WhatsAppExportParser', () => {
        it('should parse WhatsApp TXT export', async () => {
            const testData = `12/31/23, 10:30 PM - Alice: Hello there!
12/31/23, 10:31 PM - Bob: Hi Alice!
12/31/23, 10:32 PM - Alice: How are you doing?
This is a continuation of the previous message.
12/31/23, 10:33 PM - Bob: I'm good, thanks!`;

            const filePath = path.join(TEST_DIR, 'whatsapp-test.txt');
            await fs.writeFile(filePath, testData);

            const parser = new WhatsAppExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages.length, 4);
            
            // Check first message
            assert.strictEqual(messages[0].sender_name, 'Alice');
            assert.strictEqual(messages[0].content_text, 'Hello there!');
            assert.strictEqual(messages[0].channel, 'whatsapp');
            
            // Check multi-line message
            assert.ok(messages[2].content_text.includes('continuation'));
        });

        it('should detect media types', async () => {
            const testData = `1/1/24, 1:00 PM - Alice: <Media omitted>
1/1/24, 1:01 PM - Bob: video omitted
1/1/24, 1:02 PM - Alice: voice message
1/1/24, 1:03 PM - Bob: document omitted`;

            const filePath = path.join(TEST_DIR, 'whatsapp-media.txt');
            await fs.writeFile(filePath, testData);

            const parser = new WhatsAppExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages[0].content_type, 'image');
            assert.strictEqual(messages[1].content_type, 'video');
            assert.strictEqual(messages[2].content_type, 'audio');
            assert.strictEqual(messages[3].content_type, 'document');
        });

        it('should handle alternative date format', async () => {
            const testData = `[31/12/23, 22:30:45] Alice: Testing format 2
[31/12/23, 22:31:00] Bob: This works too`;

            const filePath = path.join(TEST_DIR, 'whatsapp-alt.txt');
            await fs.writeFile(filePath, testData);

            const parser = new WhatsAppExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages.length, 2);
            assert.strictEqual(messages[0].sender_name, 'Alice');
            assert.strictEqual(messages[1].sender_name, 'Bob');
        });
    });

    describe('DiscordExportParser', () => {
        it('should parse Discord JSON export', async () => {
            const testData = {
                channel: {
                    id: '123456789',
                    name: 'general'
                },
                guild: {
                    name: 'Test Server'
                },
                messages: [
                    {
                        id: '987654321',
                        timestamp: '2026-02-13T10:00:00.000Z',
                        author: {
                            id: 'user123',
                            name: 'Alice',
                            isBot: false
                        },
                        content: 'Hello Discord!'
                    },
                    {
                        id: '987654322',
                        timestamp: '2026-02-13T10:01:00.000Z',
                        author: {
                            id: 'bot456',
                            name: 'BotName',
                            isBot: true
                        },
                        content: 'Automated response'
                    }
                ]
            };

            const filePath = path.join(TEST_DIR, 'discord-test.json');
            await fs.writeFile(filePath, JSON.stringify(testData, null, 2));

            const parser = new DiscordExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages.length, 2);
            
            // Check first message
            assert.strictEqual(messages[0].sender_name, 'Alice');
            assert.strictEqual(messages[0].direction, 'inbound');
            assert.strictEqual(messages[0].content_text, 'Hello Discord!');
            assert.strictEqual(messages[0].channel, 'discord');
            
            // Check bot message
            assert.strictEqual(messages[1].direction, 'outbound');
        });

        it('should handle attachments', async () => {
            const testData = {
                channel: { id: '123', name: 'media' },
                messages: [
                    {
                        id: '111',
                        timestamp: '2026-02-13T12:00:00.000Z',
                        author: { id: 'user1', name: 'Charlie', isBot: false },
                        content: 'Check this image',
                        attachments: [
                            {
                                id: 'attach1',
                                url: 'https://example.com/image.png',
                                contentType: 'image/png'
                            }
                        ]
                    },
                    {
                        id: '112',
                        timestamp: '2026-02-13T12:01:00.000Z',
                        author: { id: 'user1', name: 'Charlie', isBot: false },
                        content: 'And a video',
                        attachments: [
                            {
                                id: 'attach2',
                                url: 'https://example.com/video.mp4',
                                contentType: 'video/mp4'
                            }
                        ]
                    }
                ]
            };

            const filePath = path.join(TEST_DIR, 'discord-media.json');
            await fs.writeFile(filePath, JSON.stringify(testData, null, 2));

            const parser = new DiscordExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages[0].content_type, 'image');
            assert.strictEqual(messages[1].content_type, 'video');
        });

        it('should handle message replies', async () => {
            const testData = {
                channel: { id: '123', name: 'general' },
                messages: [
                    {
                        id: '200',
                        timestamp: '2026-02-13T13:00:00.000Z',
                        author: { id: 'user1', name: 'Dave', isBot: false },
                        content: 'Original message'
                    },
                    {
                        id: '201',
                        timestamp: '2026-02-13T13:01:00.000Z',
                        author: { id: 'user2', name: 'Eve', isBot: false },
                        content: 'Reply to original',
                        reference: {
                            messageId: '200'
                        }
                    }
                ]
            };

            const filePath = path.join(TEST_DIR, 'discord-replies.json');
            await fs.writeFile(filePath, JSON.stringify(testData, null, 2));

            const parser = new DiscordExportParser();
            const messages = await parser.parseExport(filePath);

            assert.strictEqual(messages[1].reply_to_id, 'discord_export_200');
        });
    });
});
