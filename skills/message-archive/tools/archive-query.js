#!/usr/bin/env node

/**
 * Archive Query Tool
 * 
 * Query and export messages and sessions from the archive.
 * 
 * Usage:
 *   node archive-query.js --search "keyword" [--limit 20]
 *   node archive-query.js --since "2026-02-01" --until "2026-02-13"
 *   node archive-query.js --session agent:main:main --channel telegram
 *   node archive-query.js --export-context --since "2026-02-13 10:00" --format markdown
 *   node archive-query.js --stats
 *   node archive-query.js --sessions [--type subagent] [--search "query"]
 *   node archive-query.js --session-detail <session-id>
 */

const { MessageArchive } = require('../lib/archive-db');

class ArchiveQuery {
    constructor(archive) {
        this.archive = archive;
    }

    /**
     * Parse date string to timestamp
     * @param {string} dateStr - Date string (ISO or natural)
     * @returns {number} Timestamp in milliseconds
     */
    parseDate(dateStr) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date: ${dateStr}`);
        }
        return date.getTime();
    }

    /**
     * Query messages with filters
     * @param {object} filters - Query filters
     * @returns {Array<object>} Messages
     */
    query(filters) {
        const queryFilters = { ...filters };

        // Parse date strings
        if (filters.since) {
            queryFilters.startTime = this.parseDate(filters.since);
            delete queryFilters.since;
        }

        if (filters.until) {
            queryFilters.endTime = this.parseDate(filters.until);
            delete queryFilters.until;
        }

        return this.archive.queryMessages(queryFilters);
    }

    /**
     * Search messages by text
     * @param {string} query - Search query
     * @param {number} limit - Max results
     * @returns {Array<object>} Search results
     */
    search(query, limit = 50) {
        return this.archive.search(query, limit);
    }

    /**
     * Export messages to various formats
     * @param {Array<object>} messages - Messages to export
     * @param {string} format - Output format (json, markdown, text)
     * @returns {string} Formatted output
     */
    export(messages, format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(messages, null, 2);
            
            case 'markdown':
            case 'md':
                return this.exportMarkdown(messages);
            
            case 'text':
            case 'txt':
                return this.exportText(messages);
            
            case 'csv':
                return this.exportCSV(messages);
            
            default:
                throw new Error(`Unknown format: ${format}`);
        }
    }

    /**
     * Export as markdown
     * @param {Array<object>} messages - Messages
     * @returns {string} Markdown output
     */
    exportMarkdown(messages) {
        let output = '# Message Archive Export\n\n';
        output += `Generated: ${new Date().toLocaleString()}\n`;
        output += `Messages: ${messages.length}\n\n`;
        output += '---\n\n';

        for (const msg of messages) {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            const sender = msg.sender_name || msg.sender_id || 'Unknown';
            const direction = msg.direction === 'outbound' ? '→' : '←';
            const channel = msg.channel ? `[${msg.channel}]` : '';
            
            output += `## ${timestamp} ${direction} ${sender} ${channel}\n\n`;
            
            if (msg.content_text) {
                output += `${msg.content_text}\n\n`;
            } else {
                output += `*[${msg.content_type} content]*\n\n`;
            }

            if (msg.reply_to_id) {
                output += `> Reply to: ${msg.reply_to_id}\n\n`;
            }

            output += '---\n\n';
        }

        return output;
    }

    /**
     * Export as plain text
     * @param {Array<object>} messages - Messages
     * @returns {string} Text output
     */
    exportText(messages) {
        let output = '';

        for (const msg of messages) {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            const sender = msg.sender_name || msg.sender_id || 'Unknown';
            const direction = msg.direction === 'outbound' ? '>>' : '<<';
            
            output += `[${timestamp}] ${direction} ${sender}\n`;
            output += `${msg.content_text || `[${msg.content_type}]`}\n\n`;
        }

        return output;
    }

    /**
     * Export as CSV
     * @param {Array<object>} messages - Messages
     * @returns {string} CSV output
     */
    exportCSV(messages) {
        const headers = [
            'timestamp', 'direction', 'sender_name', 'sender_id',
            'channel', 'content_type', 'content_text', 'session_key'
        ];

        let csv = headers.join(',') + '\n';

        for (const msg of messages) {
            const row = headers.map(field => {
                let value = msg[field] || '';
                // Escape quotes and commas
                value = String(value).replace(/"/g, '""');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = `"${value}"`;
                }
                return value;
            });

            csv += row.join(',') + '\n';
        }

        return csv;
    }

    /**
     * Get context for LLM consumption
     * @param {string} since - Start date/time
     * @param {string} until - End date/time
     * @param {string} sessionKey - Session key
     * @returns {string} Formatted context
     */
    getContext(since, until, sessionKey) {
        const startTime = this.parseDate(since);
        const endTime = this.parseDate(until);
        
        return this.archive.getConversationContext(startTime, endTime, sessionKey);
    }

    /**
     * Query sessions with filters
     * @param {object} filters - Query filters
     * @returns {Array<object>} Sessions
     */
    querySessions(filters = {}) {
        return this.archive.querySessions(filters);
    }

    /**
     * Get session with full details and events
     * @param {string} sessionId - Session UUID
     * @returns {object} Session with events
     */
    getSessionDetail(sessionId) {
        const session = this.archive.getSessionWithStats(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }

        // Get all events for this session
        const events = this.archive.getSessionEvents(sessionId, {
            includeThinking: false,
            includeUsage: true
        });

        return {
            ...session,
            events
        };
    }

    /**
     * Export sessions to various formats
     * @param {Array<object>} sessions - Sessions to export
     * @param {string} format - Output format (json, text, csv)
     * @returns {string} Formatted output
     */
    exportSessions(sessions, format = 'json') {
        switch (format.toLowerCase()) {
            case 'json':
                return JSON.stringify(sessions, null, 2);
            
            case 'text':
            case 'txt':
                return this.exportSessionsText(sessions);
            
            case 'csv':
                return this.exportSessionsCSV(sessions);
            
            default:
                throw new Error(`Unknown format: ${format}`);
        }
    }

    /**
     * Export sessions as plain text
     */
    exportSessionsText(sessions) {
        let output = '# Sessions\n\n';
        output += `Total: ${sessions.length}\n\n`;
        output += '─'.repeat(80) + '\n\n';

        for (const session of sessions) {
            const started = new Date(session.started_at).toLocaleString();
            const ended = session.ended_at ? new Date(session.ended_at).toLocaleString() : 'active';
            const duration = session.ended_at 
                ? Math.round((session.ended_at - session.started_at) / 1000) + 's'
                : 'ongoing';

            output += `ID: ${session.id}\n`;
            output += `Type: ${session.type} | Status: ${session.status}\n`;
            output += `Started: ${started} | Ended: ${ended} (${duration})\n`;
            output += `Title: ${session.title}\n`;
            output += `Summary: ${session.summary}\n`;
            output += `Messages: ${session.message_count} | Events: ${session.event_count}\n`;
            
            if (session.label) {
                output += `Label: ${session.label}\n`;
            }
            
            if (session.model) {
                output += `Model: ${session.model}\n`;
            }

            output += '\n' + '─'.repeat(80) + '\n\n';
        }

        return output;
    }

    /**
     * Export sessions as CSV
     */
    exportSessionsCSV(sessions) {
        const headers = [
            'id', 'type', 'status', 'title', 'summary',
            'started_at', 'ended_at', 'message_count', 'event_count',
            'label', 'model', 'session_key'
        ];

        let csv = headers.join(',') + '\n';

        for (const session of sessions) {
            const row = headers.map(field => {
                let value = session[field] || '';
                
                // Format timestamps
                if (field === 'started_at' || field === 'ended_at') {
                    value = value ? new Date(value).toISOString() : '';
                }
                
                // Escape quotes and commas
                value = String(value).replace(/"/g, '""');
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    value = `"${value}"`;
                }
                return value;
            });

            csv += row.join(',') + '\n';
        }

        return csv;
    }
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help')) {
        console.log(`
Message Archive Query Tool

Message Queries:
  archive-query.js --search "keyword" [--limit 20]
  archive-query.js --since "2026-02-01" --until "2026-02-13"
  archive-query.js --session agent:main:main --channel telegram
  archive-query.js --export-context --since "2026-02-13 10:00" [--format markdown]

Session Queries:
  archive-query.js --sessions [--type subagent] [--status completed]
  archive-query.js --sessions --search "keyword" [--limit 50]
  archive-query.js --session-detail <session-id>
  archive-query.js --sessions --since "2026-02-01"

General:
  archive-query.js --stats

Options:
  --search <query>       Full-text search
  --since <date>         Start date/time
  --until <date>         End date/time
  --session <key>        Filter by session key
  --channel <name>       Filter by channel (telegram, whatsapp, etc)
  --sender <id>          Filter by sender ID
  --limit <n>            Max results (default: 100)
  --format <fmt>         Output format: json, markdown, text, csv (default: json)
  --export-context       Export as LLM-friendly context
  --stats                Show database statistics
  
  --sessions             List sessions (with optional filters)
  --session-detail <id>  Show detailed session info with events
  --type <type>          Filter sessions by type (main/subagent/cron/isolated)
  --status <status>      Filter sessions by status (active/completed/failed)
        `);
        process.exit(0);
    }

    const archive = new MessageArchive();
    const query = new ArchiveQuery(archive);

    try {
        // Stats mode
        if (args.includes('--stats')) {
            const stats = archive.getStats();
            
            console.log('\n📊 Message Archive Statistics\n');
            console.log(`Total Messages: ${stats.totalMessages}`);
            console.log(`Total Attachments: ${stats.totalAttachments}`);
            console.log(`Total Reactions: ${stats.totalReactions}`);
            
            if (stats.oldestTimestamp) {
                console.log(`Oldest Message: ${new Date(stats.oldestTimestamp).toLocaleString()}`);
            }
            
            if (stats.newestTimestamp) {
                console.log(`Newest Message: ${new Date(stats.newestTimestamp).toLocaleString()}`);
            }
            
            if (stats.channels.length > 0) {
                console.log('\nMessages by Channel:');
                for (const ch of stats.channels) {
                    console.log(`  ${ch.channel}: ${ch.count}`);
                }
            }
            
            console.log();
            archive.close();
            process.exit(0);
        }

        // Session detail mode
        if (args.includes('--session-detail')) {
            const sessionId = getArg(args, '--session-detail');
            
            if (!sessionId) {
                console.error('Error: --session-detail requires a session ID');
                process.exit(1);
            }

            try {
                const sessionDetail = query.getSessionDetail(sessionId);
                const format = getArg(args, '--format') || 'json';
                
                if (format === 'json') {
                    console.log(JSON.stringify(sessionDetail, null, 2));
                } else {
                    // Text format
                    const s = sessionDetail;
                    console.log('\n📋 Session Details\n');
                    console.log(`ID: ${s.id}`);
                    console.log(`Type: ${s.type} | Status: ${s.status}`);
                    console.log(`Session Key: ${s.session_key}`);
                    console.log(`\nTitle: ${s.title}`);
                    console.log(`Summary: ${s.summary}`);
                    console.log(`\nStarted: ${new Date(s.started_at).toLocaleString()}`);
                    if (s.ended_at) {
                        console.log(`Ended: ${new Date(s.ended_at).toLocaleString()}`);
                        const duration = Math.round((s.ended_at - s.started_at) / 1000);
                        console.log(`Duration: ${duration}s`);
                    } else {
                        console.log(`Status: Active`);
                    }
                    console.log(`\nMessages: ${s.message_count} | Events: ${s.event_count}`);
                    
                    if (s.model) {
                        console.log(`Model: ${s.model}`);
                    }
                    
                    if (s.label) {
                        console.log(`Label: ${s.label}`);
                    }

                    if (s.stats) {
                        console.log(`\nStatistics:`);
                        console.log(`  Total Tokens: ${s.stats.total_tokens || 0}`);
                        console.log(`  Total Cost: $${(s.stats.total_cost || 0).toFixed(4)}`);
                    }

                    console.log(`\nEvents: ${sessionDetail.events.length}`);
                }
            } catch (error) {
                console.error(`Error: ${error.message}`);
                process.exit(1);
            }

            archive.close();
            process.exit(0);
        }

        // Sessions list mode
        if (args.includes('--sessions')) {
            const sessionFilters = {};
            
            if (args.includes('--type')) {
                sessionFilters.type = getArg(args, '--type');
            }
            
            if (args.includes('--status')) {
                sessionFilters.status = getArg(args, '--status');
            }
            
            if (args.includes('--since')) {
                sessionFilters.startDate = getArg(args, '--since');
            }
            
            if (args.includes('--until')) {
                sessionFilters.endDate = getArg(args, '--until');
            }
            
            if (args.includes('--search')) {
                sessionFilters.search = getArg(args, '--search');
            }
            
            if (args.includes('--limit')) {
                sessionFilters.limit = parseInt(getArg(args, '--limit'));
            }

            const sessions = query.querySessions(sessionFilters);
            const format = getArg(args, '--format') || 'text';
            
            console.log(query.exportSessions(sessions, format));
            
            archive.close();
            process.exit(0);
        }

        // Build filters for message queries
        const filters = {};
        
        if (args.includes('--search')) {
            const idx = args.indexOf('--search');
            const searchQuery = args[idx + 1];
            
            const results = query.search(searchQuery, parseInt(getArg(args, '--limit') || '50'));
            
            const format = getArg(args, '--format') || 'json';
            console.log(query.export(results, format));
            
        } else if (args.includes('--export-context')) {
            const since = getArg(args, '--since');
            const until = getArg(args, '--until') || new Date().toISOString();
            const sessionKey = getArg(args, '--session') || 'agent:main:main';
            
            if (!since) {
                console.error('Error: --export-context requires --since');
                process.exit(1);
            }
            
            const context = query.getContext(since, until, sessionKey);
            console.log(context);
            
        } else {
            // Regular query
            if (args.includes('--since')) {
                filters.since = getArg(args, '--since');
            }
            
            if (args.includes('--until')) {
                filters.until = getArg(args, '--until');
            }
            
            if (args.includes('--session')) {
                filters.sessionKey = getArg(args, '--session');
            }
            
            if (args.includes('--channel')) {
                filters.channel = getArg(args, '--channel');
            }
            
            if (args.includes('--sender')) {
                filters.senderId = getArg(args, '--sender');
            }
            
            if (args.includes('--limit')) {
                filters.limit = parseInt(getArg(args, '--limit'));
            }
            
            const results = query.query(filters);
            const format = getArg(args, '--format') || 'json';
            
            console.log(query.export(results, format));
        }

        archive.close();

    } catch (err) {
        console.error('Error:', err.message);
        archive.close();
        process.exit(1);
    }
}

/**
 * Helper to get argument value
 */
function getArg(args, flag) {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

module.exports = { ArchiveQuery };
