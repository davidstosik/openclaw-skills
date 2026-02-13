/**
 * Message Archive Database Manager
 * 
 * Core database operations for message archiving, including:
 * - Schema initialization and migrations
 * - Message insertion with deduplication
 * - Query interface with filtering
 * - Context reconstruction for LLM consumption
 * 
 * @module archive-db
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DEFAULT_DB_PATH = path.join(process.env.HOME, '.openclaw', 'archive', 'messages.db');

class MessageArchive {
    /**
     * Initialize message archive database
     * @param {string} dbPath - Path to SQLite database file
     */
    constructor(dbPath = DEFAULT_DB_PATH) {
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL'); // Better concurrent performance
        this.db.pragma('foreign_keys = ON');
        
        this.initializeSchema();
    }

    /**
     * Create all database tables and indexes
     */
    initializeSchema() {
        // Core messages table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT UNIQUE NOT NULL,
                internal_id TEXT,
                session_key TEXT NOT NULL,
                session_id TEXT,
                
                -- Sender/Recipient
                direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
                sender_id TEXT,
                sender_name TEXT,
                recipient_id TEXT,
                recipient_name TEXT,
                
                -- Channel/Device
                channel TEXT NOT NULL,
                device_id TEXT,
                
                -- Content
                content_type TEXT NOT NULL DEFAULT 'text',
                content_text TEXT,
                content_json TEXT,
                content_hash TEXT,
                
                -- Threading
                reply_to_id TEXT,
                thread_id TEXT,
                
                -- Metadata
                timestamp INTEGER NOT NULL,
                edited_at INTEGER,
                deleted_at INTEGER,
                created_at INTEGER NOT NULL,
                
                FOREIGN KEY (reply_to_id) REFERENCES messages(message_id)
            );

            -- Media/attachments table
            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                attachment_type TEXT NOT NULL,
                file_path TEXT,
                file_url TEXT,
                file_name TEXT,
                file_size INTEGER,
                mime_type TEXT,
                thumbnail_path TEXT,
                metadata_json TEXT,
                created_at INTEGER NOT NULL,
                
                FOREIGN KEY (message_id) REFERENCES messages(message_id)
            );

            -- Reactions table
            CREATE TABLE IF NOT EXISTS reactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                added_at INTEGER NOT NULL,
                removed_at INTEGER,
                
                FOREIGN KEY (message_id) REFERENCES messages(message_id),
                UNIQUE(message_id, emoji, user_id)
            );

            -- Edits history table
            CREATE TABLE IF NOT EXISTS edits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id TEXT NOT NULL,
                previous_content TEXT NOT NULL,
                edited_at INTEGER NOT NULL,
                
                FOREIGN KEY (message_id) REFERENCES messages(message_id)
            );

            -- State tracking (checkpoints, backfill logs)
            CREATE TABLE IF NOT EXISTS archive_state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
        `);

        // Create indexes if they don't exist
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, timestamp);
            CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(reply_to_id);
            CREATE INDEX IF NOT EXISTS idx_messages_hash ON messages(content_hash);
            CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
            CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
            CREATE INDEX IF NOT EXISTS idx_edits_message ON edits(message_id);
        `);

        // Full-text search
        this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content_text,
                content=messages,
                content_rowid=id
            );
        `);

        // FTS triggers
        const hasTriggers = this.db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='trigger' AND name='messages_fts_insert'
        `).get();

        if (!hasTriggers) {
            this.db.exec(`
                CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
                    INSERT INTO messages_fts(rowid, content_text) 
                    VALUES (new.id, new.content_text);
                END;

                CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
                    UPDATE messages_fts SET content_text = new.content_text 
                    WHERE rowid = old.id;
                END;

                CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
                    DELETE FROM messages_fts WHERE rowid = old.id;
                END;
            `);
        }
        
        // Initialize sessions table schema
        this.initializeSessionsSchema();
    }

    /**
     * Hash message for deduplication
     * @param {object} messageData - Message object
     * @returns {string} SHA256 hash
     */
    hashMessage(messageData) {
        const payload = `${messageData.sender_id || ''}|${messageData.timestamp}|${messageData.content_text || ''}`;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    /**
     * Check if message already exists
     * @param {object} messageData - Message object
     * @returns {boolean} True if duplicate
     */
    isDuplicate(messageData) {
        // Level 1: Exact message_id match
        const byId = this.db.prepare('SELECT id FROM messages WHERE message_id = ?')
            .get(messageData.message_id);
        if (byId) return true;

        // Level 2: Content hash match
        const hash = this.hashMessage(messageData);
        const byHash = this.db.prepare('SELECT id FROM messages WHERE content_hash = ?')
            .get(hash);
        if (byHash) return true;

        // Level 3: Fuzzy match (same sender, similar timestamp, same content)
        if (messageData.sender_id && messageData.content_text) {
            const fuzzy = this.db.prepare(`
                SELECT id FROM messages 
                WHERE sender_id = ? 
                  AND ABS(timestamp - ?) < 1000
                  AND content_text = ?
                LIMIT 1
            `).get(messageData.sender_id, messageData.timestamp, messageData.content_text);
            if (fuzzy) return true;
        }

        return false;
    }

    /**
     * Insert a message into the archive
     * @param {object} messageData - Message data
     * @param {object} options - Insert options
     * @returns {number} Inserted row ID or null if skipped
     */
    insertMessage(messageData, options = {}) {
        const { skipIfExists = true } = options;

        // Check for duplicates
        if (skipIfExists && this.isDuplicate(messageData)) {
            return null;
        }

        // Add content hash
        const data = {
            ...messageData,
            content_hash: this.hashMessage(messageData),
            created_at: messageData.created_at || Date.now()
        };

        // Set defaults for optional fields
        const record = {
            message_id: data.message_id,
            internal_id: data.internal_id || null,
            session_key: data.session_key,
            session_id: data.session_id || null,
            direction: data.direction,
            sender_id: data.sender_id || null,
            sender_name: data.sender_name || null,
            recipient_id: data.recipient_id || null,
            recipient_name: data.recipient_name || null,
            channel: data.channel,
            device_id: data.device_id || null,
            content_type: data.content_type || 'text',
            content_text: data.content_text || null,
            content_json: data.content_json || null,
            content_hash: data.content_hash,
            reply_to_id: data.reply_to_id || null,
            thread_id: data.thread_id || null,
            timestamp: data.timestamp,
            edited_at: data.edited_at || null,
            deleted_at: data.deleted_at || null,
            created_at: data.created_at
        };

        const stmt = this.db.prepare(`
            INSERT INTO messages (
                message_id, internal_id, session_key, session_id,
                direction, sender_id, sender_name, recipient_id, recipient_name,
                channel, device_id,
                content_type, content_text, content_json, content_hash,
                reply_to_id, thread_id,
                timestamp, edited_at, deleted_at, created_at
            ) VALUES (
                @message_id, @internal_id, @session_key, @session_id,
                @direction, @sender_id, @sender_name, @recipient_id, @recipient_name,
                @channel, @device_id,
                @content_type, @content_text, @content_json, @content_hash,
                @reply_to_id, @thread_id,
                @timestamp, @edited_at, @deleted_at, @created_at
            )
        `);

        const result = stmt.run(record);
        return result.lastInsertRowid;
    }

    /**
     * Insert multiple messages in a transaction (for backfill)
     * @param {Array<object>} messages - Array of message data
     * @returns {object} Stats { inserted, skipped }
     */
    insertBatch(messages) {
        let inserted = 0;
        let skipped = 0;

        const insert = this.db.transaction((msgs) => {
            for (const msg of msgs) {
                const rowId = this.insertMessage(msg, { skipIfExists: true });
                if (rowId) {
                    inserted++;
                } else {
                    skipped++;
                }
            }
        });

        insert(messages);

        return { inserted, skipped };
    }

    /**
     * Add or update a reaction
     * @param {string} messageId - Message ID
     * @param {string} emoji - Emoji
     * @param {string} userId - User ID
     * @param {string} userName - User name
     */
    addReaction(messageId, emoji, userId, userName = null) {
        const stmt = this.db.prepare(`
            INSERT INTO reactions (message_id, emoji, user_id, user_name, added_at, removed_at)
            VALUES (?, ?, ?, ?, ?, NULL)
            ON CONFLICT(message_id, emoji, user_id) 
            DO UPDATE SET removed_at = NULL, added_at = ?
        `);

        const now = Date.now();
        stmt.run(messageId, emoji, userId, userName, now, now);
    }

    /**
     * Remove a reaction
     * @param {string} messageId - Message ID
     * @param {string} emoji - Emoji
     * @param {string} userId - User ID
     */
    removeReaction(messageId, emoji, userId) {
        const stmt = this.db.prepare(`
            UPDATE reactions 
            SET removed_at = ?
            WHERE message_id = ? AND emoji = ? AND user_id = ? AND removed_at IS NULL
        `);

        stmt.run(Date.now(), messageId, emoji, userId);
    }

    /**
     * Update message content (and track edit)
     * @param {string} messageId - Message ID
     * @param {string} newContent - New content
     * @param {number} editTimestamp - When edited
     */
    updateMessage(messageId, newContent, editTimestamp = Date.now()) {
        // Get current content
        const current = this.db.prepare('SELECT content_text FROM messages WHERE message_id = ?')
            .get(messageId);

        if (!current) return;

        // Store edit history
        this.db.prepare('INSERT INTO edits (message_id, previous_content, edited_at) VALUES (?, ?, ?)')
            .run(messageId, current.content_text, editTimestamp);

        // Update message
        this.db.prepare('UPDATE messages SET content_text = ?, edited_at = ? WHERE message_id = ?')
            .run(newContent, editTimestamp, messageId);
    }

    /**
     * Soft delete a message
     * @param {string} messageId - Message ID
     * @param {number} timestamp - Deletion timestamp
     */
    softDeleteMessage(messageId, timestamp = Date.now()) {
        this.db.prepare('UPDATE messages SET deleted_at = ? WHERE message_id = ?')
            .run(timestamp, messageId);
    }

    /**
     * Query messages with flexible filters
     * @param {object} filters - Query filters
     * @returns {Array<object>} Matching messages
     */
    queryMessages(filters = {}) {
        const {
            sessionKey,
            channel,
            senderId,
            startTime,
            endTime,
            contentMatch,
            limit = 100,
            offset = 0,
            includeDeleted = false
        } = filters;

        let sql = 'SELECT * FROM messages WHERE 1=1';
        const params = [];

        if (sessionKey) {
            sql += ' AND session_key = ?';
            params.push(sessionKey);
        }

        if (channel) {
            sql += ' AND channel = ?';
            params.push(channel);
        }

        if (senderId) {
            sql += ' AND sender_id = ?';
            params.push(senderId);
        }

        if (startTime) {
            sql += ' AND timestamp >= ?';
            params.push(startTime);
        }

        if (endTime) {
            sql += ' AND timestamp <= ?';
            params.push(endTime);
        }

        if (!includeDeleted) {
            sql += ' AND deleted_at IS NULL';
        }

        if (contentMatch) {
            sql += ' AND id IN (SELECT rowid FROM messages_fts WHERE content_text MATCH ?)';
            params.push(contentMatch);
        }

        sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return this.db.prepare(sql).all(...params);
    }

    /**
     * Get conversation context for LLM consumption
     * @param {number} startTime - Start timestamp
     * @param {number} endTime - End timestamp
     * @param {string} sessionKey - Session key
     * @returns {string} Formatted context
     */
    getConversationContext(startTime, endTime, sessionKey) {
        const messages = this.queryMessages({
            sessionKey,
            startTime,
            endTime,
            limit: 1000
        }).reverse(); // Chronological order

        if (messages.length === 0) {
            return 'No messages found in this time range.';
        }

        let context = `# Conversation Context\n\n`;
        context += `Session: ${sessionKey}\n`;
        context += `Time Range: ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}\n`;
        context += `Messages: ${messages.length}\n\n---\n\n`;

        for (const msg of messages) {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            const sender = msg.sender_name || msg.sender_id || 'Unknown';
            const direction = msg.direction === 'outbound' ? '→' : '←';
            
            context += `**[${timestamp}] ${direction} ${sender}**\n`;
            context += `${msg.content_text || '[No text content]'}\n\n`;
        }

        return context;
    }

    /**
     * Full-text search across all messages
     * @param {string} query - Search query
     * @param {number} limit - Max results
     * @returns {Array<object>} Search results
     */
    search(query, limit = 50) {
        return this.db.prepare(`
            SELECT m.*, rank
            FROM messages_fts fts
            JOIN messages m ON m.id = fts.rowid
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(query, limit);
    }

    /**
     * Get or set checkpoint value
     * @param {string} key - Checkpoint key
     * @param {string} value - Value to set (or null to get)
     * @returns {string|null} Current value
     */
    checkpoint(key, value = null) {
        if (value !== null) {
            this.db.prepare(`
                INSERT INTO archive_state (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
            `).run(key, value, Date.now(), value, Date.now());
            return value;
        }

        const row = this.db.prepare('SELECT value FROM archive_state WHERE key = ?').get(key);
        return row ? row.value : null;
    }

    /**
     * Get database statistics
     * @returns {object} Stats
     */
    getStats() {
        const totalMessages = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
        const totalAttachments = this.db.prepare('SELECT COUNT(*) as count FROM attachments').get().count;
        const totalReactions = this.db.prepare('SELECT COUNT(*) as count FROM reactions WHERE removed_at IS NULL').get().count;
        
        const channels = this.db.prepare(`
            SELECT channel, COUNT(*) as count 
            FROM messages 
            GROUP BY channel 
            ORDER BY count DESC
        `).all();

        const oldestMessage = this.db.prepare('SELECT MIN(timestamp) as ts FROM messages').get();
        const newestMessage = this.db.prepare('SELECT MAX(timestamp) as ts FROM messages').get();

        return {
            totalMessages,
            totalAttachments,
            totalReactions,
            channels,
            oldestTimestamp: oldestMessage?.ts,
            newestTimestamp: newestMessage?.ts
        };
    }

    /**
     * ============================================================================
     * EVENT ARCHIVING METHODS
     * ============================================================================
     */

    /**
     * Insert a single event into the events table
     * @param {object} eventData - Event data from parser
     * @param {string} sessionKey - Session key (e.g., agent:main:main)
     * @param {object} options - Options (skipIfExists, etc.)
     * @returns {number|null} Row ID or null if skipped
     */
    insertEvent(eventData, sessionKey, options = {}) {
        const { skipIfExists = true } = options;
        
        // Fill in session_id if not set (from session event)
        if (!eventData.session_id && eventData.event_type === 'session') {
            eventData.session_id = eventData.event_id;
        }
        
        // Check for duplicate
        if (skipIfExists) {
            const existing = this.db.prepare('SELECT id FROM events WHERE event_id = ?')
                .get(eventData.event_id);
            if (existing) return null;
        }
        
        const contentSize = Buffer.byteLength(eventData.content_json, 'utf8');
        
        // Insert main event
        const stmt = this.db.prepare(`
            INSERT INTO events (
                event_id, parent_event_id, session_key, session_id,
                event_type, event_subtype, timestamp, created_at,
                content_json, role, tool_name, model_provider, model_id,
                is_error, content_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        try {
            const result = stmt.run(
                eventData.event_id,
                eventData.parent_event_id || null,
                sessionKey,
                eventData.session_id || null,
                eventData.event_type,
                eventData.event_subtype || null,
                eventData.timestamp,
                Date.now(),
                eventData.content_json,
                eventData.role || null,
                eventData.tool_name || null,
                eventData.model_provider || null,
                eventData.model_id || null,
                eventData.is_error || 0,
                contentSize
            );
            
            // Handle special cases
            if (eventData.event_type === 'thinking_block' && eventData._thinking_content) {
                this.insertThinkingBlock(
                    eventData.event_id,
                    eventData._thinking_content,
                    eventData._thinking_signature,
                    eventData._content_size
                );
            }
            
            if (eventData.event_type === 'usage_stats' && eventData._usage) {
                this.insertUsageStats(
                    eventData.event_id,
                    eventData._usage,
                    eventData.model_provider,
                    eventData.model_id,
                    eventData.timestamp
                );
            }
            
            return result.lastInsertRowid;
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && skipIfExists) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Insert thinking block content into separate table
     */
    insertThinkingBlock(eventId, content, signature, size) {
        try {
            this.db.prepare(`
                INSERT INTO thinking_blocks (event_id, thinking_content, thinking_signature, content_size, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(eventId, content, signature || null, size, Date.now());
        } catch (error) {
            if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
                throw error;
            }
        }
    }

    /**
     * Insert usage statistics into separate table
     */
    insertUsageStats(eventId, usage, provider, modelId, timestamp) {
        try {
            this.db.prepare(`
                INSERT INTO usage_stats (
                    event_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    total_tokens, input_cost, output_cost, cache_read_cost, cache_write_cost,
                    total_cost, model_provider, model_id, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                eventId,
                usage.input_tokens || 0,
                usage.output_tokens || 0,
                usage.cache_read_tokens || 0,
                usage.cache_write_tokens || 0,
                usage.total_tokens || 0,
                usage.input_cost || 0,
                usage.output_cost || 0,
                usage.cache_read_cost || 0,
                usage.cache_write_cost || 0,
                usage.total_cost || 0,
                provider || null,
                modelId || null,
                timestamp
            );
        } catch (error) {
            if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') {
                throw error;
            }
        }
    }

    /**
     * Insert batch of events in a single transaction
     * @param {Array<object>} events - Array of event data
     * @param {string} sessionKey - Session key
     * @returns {object} Stats (inserted, skipped, errors)
     */
    insertEventBatch(events, sessionKey, options = {}) {
        let inserted = 0;
        let skipped = 0;
        let errors = 0;
        
        // Get session_id from options, first session event, or null
        let sessionId = options.sessionId || null;
        if (!sessionId) {
            const sessionEvent = events.find(e => e.event_type === 'session');
            sessionId = sessionEvent ? sessionEvent.session_id : null;
        }
        
        // Fill in session_id for all events
        events.forEach(e => {
            if (!e.session_id) {
                e.session_id = sessionId;
            }
        });
        
        // Temporarily disable foreign key constraints for backfill operations
        // (parent events may not exist yet during historical import)
        const disableForeignKeys = options.disableForeignKeys || false;
        
        if (disableForeignKeys) {
            this.db.prepare('PRAGMA foreign_keys = OFF').run();
        }
        
        const insertTransaction = this.db.transaction((evts) => {
            for (const evt of evts) {
                try {
                    const rowId = this.insertEvent(evt, sessionKey, options);
                    if (rowId !== null) {
                        inserted++;
                    } else {
                        skipped++;
                    }
                } catch (error) {
                    errors++;
                    if (options.verbose) {
                        console.error(`Error inserting event ${evt.event_id}:`, error.message);
                    }
                }
            }
        });
        
        insertTransaction(events);
        
        if (disableForeignKeys) {
            this.db.prepare('PRAGMA foreign_keys = ON').run();
        }
        
        return { inserted, skipped, errors };
    }

    /**
     * Get all events for a session
     * @param {string} sessionId - Session UUID
     * @param {object} options - Query options
     * @returns {Array<object>} Events
     */
    getSessionEvents(sessionId, options = {}) {
        const {
            includeThinking = false,
            includeUsage = true,
            startTime = null,
            endTime = null,
            eventTypes = null
        } = options;
        
        let sql = 'SELECT * FROM events WHERE session_id = ?';
        const params = [sessionId];
        
        if (startTime) {
            sql += ' AND timestamp >= ?';
            params.push(startTime);
        }
        
        if (endTime) {
            sql += ' AND timestamp <= ?';
            params.push(endTime);
        }
        
        if (eventTypes && eventTypes.length > 0) {
            sql += ' AND event_type IN (' + eventTypes.map(() => '?').join(',') + ')';
            params.push(...eventTypes);
        }
        
        sql += ' ORDER BY timestamp ASC';
        
        const events = this.db.prepare(sql).all(...params);
        
        // Optionally fetch thinking blocks
        if (includeThinking) {
            for (const evt of events) {
                if (evt.event_type === 'thinking_block') {
                    const thinking = this.db.prepare('SELECT * FROM thinking_blocks WHERE event_id = ?')
                        .get(evt.event_id);
                    if (thinking) {
                        evt.thinking = thinking;
                    }
                }
            }
        }
        
        // Optionally fetch usage stats
        if (includeUsage) {
            for (const evt of events) {
                if (evt.event_type === 'usage_stats') {
                    const usage = this.db.prepare('SELECT * FROM usage_stats WHERE event_id = ?')
                        .get(evt.event_id);
                    if (usage) {
                        evt.usage = usage;
                    }
                }
            }
        }
        
        return events;
    }

    /**
     * Get events by type
     * @param {string} sessionId - Session ID
     * @param {string} eventType - Event type to filter
     * @returns {Array<object>}
     */
    getEventsByType(sessionId, eventType) {
        return this.db.prepare(`
            SELECT * FROM events 
            WHERE session_id = ? AND event_type = ?
            ORDER BY timestamp ASC
        `).all(sessionId, eventType);
    }

    /**
     * Get session statistics
     * @param {string} sessionId - Session ID
     * @returns {object} Session stats
     */
    getSessionStats(sessionId) {
        const stats = this.db.prepare(`
            SELECT 
                COUNT(*) as total_events,
                MIN(timestamp) as start_time,
                MAX(timestamp) as end_time,
                SUM(CASE WHEN event_type = 'message' THEN 1 ELSE 0 END) as message_count,
                SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as tool_call_count,
                SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) as error_count,
                SUM(content_size) as total_size_bytes
            FROM events
            WHERE session_id = ?
        `).get(sessionId);
        
        // Get usage stats
        const usage = this.db.prepare(`
            SELECT 
                SUM(total_tokens) as total_tokens,
                SUM(total_cost) as total_cost
            FROM usage_stats
            WHERE event_id IN (
                SELECT event_id FROM events WHERE session_id = ?
            )
        `).get(sessionId);
        
        return {
            ...stats,
            total_tokens: usage?.total_tokens || 0,
            total_cost: usage?.total_cost || 0,
            duration_seconds: stats.end_time && stats.start_time 
                ? Math.round((stats.end_time - stats.start_time) / 1000) 
                : 0
        };
    }

    /**
     * Export session as JSONL for replay
     * @param {string} sessionId - Session ID
     * @returns {string} JSONL content
     */
    exportSessionAsJsonl(sessionId) {
        const events = this.getSessionEvents(sessionId, {
            includeThinking: true,
            includeUsage: true
        });
        
        const jsonlLines = [];
        
        for (const evt of events) {
            // Skip synthetic events (tool_call, thinking_block, usage_stats)
            if (['tool_call', 'thinking_block', 'usage_stats'].includes(evt.event_type)) {
                continue;
            }
            
            // Reconstruct original JSONL format
            const content = JSON.parse(evt.content_json);
            
            const reconstructed = {
                type: evt.event_type === 'tool_result' ? 'message' : evt.event_type,
                id: evt.event_id,
                timestamp: new Date(evt.timestamp).toISOString()
            };
            
            if (evt.parent_event_id) {
                reconstructed.parentId = evt.parent_event_id;
            }
            
            // Merge in type-specific data
            Object.assign(reconstructed, content);
            
            jsonlLines.push(JSON.stringify(reconstructed));
        }
        
        return jsonlLines.join('\n');
    }

    /**
     * List all sessions with event counts
     * @returns {Array<object>} Session list
     */
    listSessions() {
        return this.db.prepare(`
            SELECT 
                session_id,
                session_key,
                MIN(timestamp) as started_at,
                MAX(timestamp) as ended_at,
                COUNT(*) as event_count
            FROM events
            WHERE event_type = 'session' OR session_id IS NOT NULL
            GROUP BY session_id, session_key
            ORDER BY started_at DESC
        `).all();
    }

    /**
     * ============================================================================
     * SESSION MANAGEMENT METHODS
     * ============================================================================
     */

    /**
     * Initialize sessions table schema
     */
    initializeSessionsSchema() {
        const schemaPath = path.join(__dirname, '..', 'schema', 'sessions-schema.sql');
        
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            this.db.exec(schema);
        } else {
            // Fallback inline schema if file doesn't exist
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    session_key TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('main', 'subagent', 'cron', 'isolated')),
                    parent_id TEXT,
                    label TEXT,
                    agent_id TEXT,
                    model TEXT,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER,
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    message_count INTEGER DEFAULT 0,
                    event_count INTEGER DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (parent_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
                CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
                CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
            `);
        }
    }

    /**
     * Insert or update a session
     * @param {object} sessionData - Session data
     * @returns {boolean} True if inserted, false if updated
     */
    upsertSession(sessionData) {
        const now = Date.now();
        
        const existing = this.db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionData.id);
        
        if (existing) {
            // Update existing session
            this.db.prepare(`
                UPDATE sessions
                SET session_key = ?,
                    type = ?,
                    parent_id = ?,
                    label = ?,
                    agent_id = ?,
                    model = ?,
                    started_at = ?,
                    ended_at = ?,
                    status = ?,
                    title = ?,
                    summary = ?,
                    message_count = ?,
                    event_count = ?,
                    updated_at = ?
                WHERE id = ?
            `).run(
                sessionData.session_key,
                sessionData.type,
                sessionData.parent_id || null,
                sessionData.label || null,
                sessionData.agent_id || null,
                sessionData.model || null,
                sessionData.started_at,
                sessionData.ended_at || null,
                sessionData.status || 'active',
                sessionData.title,
                sessionData.summary,
                sessionData.message_count || 0,
                sessionData.event_count || 0,
                now,
                sessionData.id
            );
            return false;
        } else {
            // Insert new session
            this.db.prepare(`
                INSERT INTO sessions (
                    id, session_key, type, parent_id, label, agent_id, model,
                    started_at, ended_at, status, title, summary,
                    message_count, event_count, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                sessionData.id,
                sessionData.session_key,
                sessionData.type,
                sessionData.parent_id || null,
                sessionData.label || null,
                sessionData.agent_id || null,
                sessionData.model || null,
                sessionData.started_at,
                sessionData.ended_at || null,
                sessionData.status || 'active',
                sessionData.title,
                sessionData.summary,
                sessionData.message_count || 0,
                sessionData.event_count || 0,
                now,
                now
            );
            return true;
        }
    }

    /**
     * Get session by ID
     * @param {string} sessionId - Session UUID
     * @returns {object|null} Session data
     */
    getSession(sessionId) {
        return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    }

    /**
     * Query sessions with filters
     * @param {object} filters - Query filters
     * @returns {Array<object>} Sessions
     */
    querySessions(filters = {}) {
        const {
            type = null,
            status = null,
            parentId = null,
            startDate = null,
            endDate = null,
            search = null,
            limit = 100,
            offset = 0
        } = filters;

        let sql = 'SELECT * FROM sessions WHERE 1=1';
        const params = [];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }

        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }

        if (parentId) {
            sql += ' AND parent_id = ?';
            params.push(parentId);
        }

        if (startDate) {
            const startTime = new Date(startDate).getTime();
            sql += ' AND started_at >= ?';
            params.push(startTime);
        }

        if (endDate) {
            const endTime = new Date(endDate).getTime();
            sql += ' AND (ended_at <= ? OR ended_at IS NULL)';
            params.push(endTime);
        }

        if (search) {
            sql += ` AND id IN (
                SELECT rowid FROM sessions_fts 
                WHERE sessions_fts MATCH ?
            )`;
            params.push(search);
        }

        sql += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return this.db.prepare(sql).all(...params);
    }

    /**
     * Get session with full statistics
     * @param {string} sessionId - Session UUID
     * @returns {object|null} Session with stats
     */
    getSessionWithStats(sessionId) {
        const session = this.getSession(sessionId);
        if (!session) return null;

        const stats = this.getSessionStats(sessionId);
        
        return {
            ...session,
            stats
        };
    }

    /**
     * Update session counts
     * @param {string} sessionId - Session UUID
     */
    updateSessionCounts(sessionId) {
        const counts = this.db.prepare(`
            SELECT 
                COUNT(*) as total_events,
                SUM(CASE WHEN event_type = 'message' THEN 1 ELSE 0 END) as message_count
            FROM events
            WHERE session_id = ?
        `).get(sessionId);

        this.db.prepare(`
            UPDATE sessions
            SET event_count = ?, message_count = ?, updated_at = ?
            WHERE id = ?
        `).run(
            counts.total_events,
            counts.message_count,
            Date.now(),
            sessionId
        );
    }

    /**
     * Mark session as completed
     * @param {string} sessionId - Session UUID
     */
    completeSession(sessionId) {
        this.db.prepare(`
            UPDATE sessions
            SET status = 'completed', updated_at = ?
            WHERE id = ? AND status = 'active'
        `).run(Date.now(), sessionId);
    }

    /**
     * Mark session as failed
     * @param {string} sessionId - Session UUID
     */
    failSession(sessionId) {
        this.db.prepare(`
            UPDATE sessions
            SET status = 'failed', updated_at = ?
            WHERE id = ? AND status = 'active'
        `).run(Date.now(), sessionId);
    }

    /**
     * Search sessions by title/summary
     * @param {string} query - Search query
     * @param {number} limit - Max results
     * @returns {Array<object>} Matching sessions
     */
    searchSessions(query, limit = 50) {
        return this.db.prepare(`
            SELECT s.*, rank
            FROM sessions_fts fts
            JOIN sessions s ON s.rowid = fts.rowid
            WHERE sessions_fts MATCH ?
            ORDER BY rank
            LIMIT ?
        `).all(query, limit);
    }

    /**
     * Get all subagent sessions for a parent
     * @param {string} parentId - Parent session ID
     * @returns {Array<object>} Subagent sessions
     */
    getSubagentSessions(parentId) {
        return this.db.prepare(`
            SELECT * FROM sessions
            WHERE parent_id = ?
            ORDER BY started_at DESC
        `).all(parentId);
    }

    /**
     * Close database connection
     */
    close() {
        this.db.close();
    }
}

module.exports = { MessageArchive, DEFAULT_DB_PATH };
