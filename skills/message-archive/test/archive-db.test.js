/**
 * Tests for MessageArchive database operations
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { MessageArchive } = require('../lib/archive-db');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, 'test-archive.db');

describe('MessageArchive', () => {
    let archive;

    before(() => {
        // Clean up any existing test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        archive = new MessageArchive(TEST_DB_PATH);
    });

    after(() => {
        archive.close();
        // Clean up test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        // Clean up WAL files
        const walFile = TEST_DB_PATH + '-wal';
        const shmFile = TEST_DB_PATH + '-shm';
        if (fs.existsSync(walFile)) fs.unlinkSync(walFile);
        if (fs.existsSync(shmFile)) fs.unlinkSync(shmFile);
    });

    it('should initialize schema', () => {
        assert.ok(archive.db);
        
        // Check tables exist
        const tables = archive.db.prepare(`
            SELECT name FROM sqlite_master WHERE type='table'
        `).all();
        
        const tableNames = tables.map(t => t.name);
        assert.ok(tableNames.includes('messages'));
        assert.ok(tableNames.includes('attachments'));
        assert.ok(tableNames.includes('reactions'));
        assert.ok(tableNames.includes('edits'));
        assert.ok(tableNames.includes('archive_state'));
    });

    it('should insert a message', () => {
        const message = {
            message_id: 'test_msg_1',
            session_key: 'test:session',
            direction: 'inbound',
            sender_id: 'user123',
            sender_name: 'Test User',
            channel: 'test',
            content_type: 'text',
            content_text: 'Hello, world!',
            timestamp: Date.now()
        };

        const rowId = archive.insertMessage(message);
        assert.ok(rowId > 0);
    });

    it('should prevent duplicate insertion', () => {
        const message = {
            message_id: 'test_msg_2',
            session_key: 'test:session',
            direction: 'inbound',
            sender_id: 'user123',
            sender_name: 'Test User',
            channel: 'test',
            content_type: 'text',
            content_text: 'Duplicate test',
            timestamp: Date.now()
        };

        const rowId1 = archive.insertMessage(message);
        assert.ok(rowId1 > 0);

        const rowId2 = archive.insertMessage(message);
        assert.strictEqual(rowId2, null); // Should skip duplicate
    });

    it('should detect duplicate by content hash', () => {
        const timestamp = Date.now();
        
        const message1 = {
            message_id: 'test_msg_3',
            session_key: 'test:session',
            direction: 'inbound',
            sender_id: 'user456',
            sender_name: 'Another User',
            channel: 'test',
            content_type: 'text',
            content_text: 'Same content',
            timestamp
        };

        const message2 = {
            message_id: 'test_msg_4', // Different ID
            session_key: 'test:session',
            direction: 'inbound',
            sender_id: 'user456', // Same sender
            sender_name: 'Another User',
            channel: 'test',
            content_type: 'text',
            content_text: 'Same content', // Same content
            timestamp // Same timestamp
        };

        const rowId1 = archive.insertMessage(message1);
        assert.ok(rowId1 > 0);

        const rowId2 = archive.insertMessage(message2);
        assert.strictEqual(rowId2, null); // Should detect duplicate by hash
    });

    it('should query messages by session', () => {
        const messages = archive.queryMessages({
            sessionKey: 'test:session',
            limit: 10
        });

        assert.ok(messages.length > 0);
        assert.strictEqual(messages[0].session_key, 'test:session');
    });

    it('should query messages by time range', () => {
        const now = Date.now();
        const oneHourAgo = now - 3600000;

        const messages = archive.queryMessages({
            startTime: oneHourAgo,
            endTime: now,
            limit: 10
        });

        assert.ok(messages.length > 0);
        
        for (const msg of messages) {
            assert.ok(msg.timestamp >= oneHourAgo);
            assert.ok(msg.timestamp <= now);
        }
    });

    it('should add and query reactions', () => {
        const messageId = 'test_msg_1';
        
        archive.addReaction(messageId, '👍', 'user789', 'Reactor');
        
        const reactions = archive.db.prepare(`
            SELECT * FROM reactions WHERE message_id = ? AND removed_at IS NULL
        `).all(messageId);
        
        assert.strictEqual(reactions.length, 1);
        assert.strictEqual(reactions[0].emoji, '👍');
        assert.strictEqual(reactions[0].user_id, 'user789');
    });

    it('should remove reactions', () => {
        const messageId = 'test_msg_1';
        
        archive.removeReaction(messageId, '👍', 'user789');
        
        const activeReactions = archive.db.prepare(`
            SELECT * FROM reactions WHERE message_id = ? AND removed_at IS NULL
        `).all(messageId);
        
        assert.strictEqual(activeReactions.length, 0);
    });

    it('should track message edits', () => {
        const messageId = 'test_msg_1';
        
        archive.updateMessage(messageId, 'Edited content', Date.now());
        
        const edits = archive.db.prepare(`
            SELECT * FROM edits WHERE message_id = ?
        `).all(messageId);
        
        assert.ok(edits.length > 0);
        assert.strictEqual(edits[0].previous_content, 'Hello, world!');
        
        const updated = archive.db.prepare(`
            SELECT * FROM messages WHERE message_id = ?
        `).get(messageId);
        
        assert.strictEqual(updated.content_text, 'Edited content');
        assert.ok(updated.edited_at > 0);
    });

    it('should soft delete messages', () => {
        const messageId = 'test_msg_1';
        
        archive.softDeleteMessage(messageId);
        
        const msg = archive.db.prepare(`
            SELECT * FROM messages WHERE message_id = ?
        `).get(messageId);
        
        assert.ok(msg.deleted_at > 0);
    });

    it('should exclude deleted messages from queries by default', () => {
        const messages = archive.queryMessages({
            sessionKey: 'test:session',
            includeDeleted: false
        });
        
        const deletedInResults = messages.some(msg => msg.deleted_at !== null);
        assert.strictEqual(deletedInResults, false);
    });

    it('should perform full-text search', () => {
        // Insert a searchable message
        archive.insertMessage({
            message_id: 'test_search_1',
            session_key: 'test:session',
            direction: 'inbound',
            sender_id: 'user999',
            sender_name: 'Search User',
            channel: 'test',
            content_type: 'text',
            content_text: 'This is a unique searchable phrase',
            timestamp: Date.now()
        });

        const results = archive.search('searchable');
        assert.ok(results.length > 0);
        assert.ok(results[0].content_text.includes('searchable'));
    });

    it('should batch insert messages', () => {
        const messages = [
            {
                message_id: 'batch_1',
                session_key: 'test:batch',
                direction: 'inbound',
                sender_id: 'batcher',
                channel: 'test',
                content_type: 'text',
                content_text: 'Batch message 1',
                timestamp: Date.now()
            },
            {
                message_id: 'batch_2',
                session_key: 'test:batch',
                direction: 'inbound',
                sender_id: 'batcher',
                channel: 'test',
                content_type: 'text',
                content_text: 'Batch message 2',
                timestamp: Date.now()
            },
            {
                message_id: 'batch_3',
                session_key: 'test:batch',
                direction: 'inbound',
                sender_id: 'batcher',
                channel: 'test',
                content_type: 'text',
                content_text: 'Batch message 3',
                timestamp: Date.now()
            }
        ];

        const result = archive.insertBatch(messages);
        
        assert.strictEqual(result.inserted, 3);
        assert.strictEqual(result.skipped, 0);
    });

    it('should get/set checkpoints', () => {
        archive.checkpoint('test_checkpoint', '12345');
        
        const value = archive.checkpoint('test_checkpoint');
        assert.strictEqual(value, '12345');
    });

    it('should return correct stats', () => {
        const stats = archive.getStats();
        
        assert.ok(stats.totalMessages > 0);
        assert.ok(Array.isArray(stats.channels));
        assert.ok(stats.channels.length > 0);
        assert.ok(stats.oldestTimestamp > 0);
        assert.ok(stats.newestTimestamp > 0);
    });
});
