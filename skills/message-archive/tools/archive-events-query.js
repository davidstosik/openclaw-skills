#!/usr/bin/env node
/**
 * Query archived events
 * 
 * Usage:
 *   node archive-events-query.js [options]
 * 
 * Examples:
 *   # List all sessions
 *   node archive-events-query.js --list
 * 
 *   # Get session events
 *   node archive-events-query.js --session <id>
 * 
 *   # Filter by event type
 *   node archive-events-query.js --session <id> --type tool_call
 * 
 *   # Export as JSONL
 *   node archive-events-query.js --session <id> --export
 * 
 *   # Session statistics
 *   node archive-events-query.js --session <id> --stats
 */

const { MessageArchive } = require('../lib/archive-db');

function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h') || args.length === 0) {
        console.log(`
Archive Events Query Tool

Usage:
  node archive-events-query.js [options]

Options:
  --list                     List all archived sessions
  --session <id>             Query specific session (full or partial ID)
  --type <type>              Filter by event type
  --stats                    Show session statistics
  --export                   Export session as JSONL
  --include-thinking         Include thinking block content
  --limit <n>                Limit number of results (default: 100)
  --help, -h                 Show this help

Event Types:
  session, model_change, thinking_level_change, custom,
  message, tool_call, tool_result, thinking_block, usage_stats

Examples:
  # List all sessions
  node archive-events-query.js --list

  # Get session events
  node archive-events-query.js --session 96286ef1

  # Filter tool calls
  node archive-events-query.js --session 96286ef1 --type tool_call

  # Export as JSONL for replay
  node archive-events-query.js --session 96286ef1 --export > session.jsonl

  # Show statistics
  node archive-events-query.js --session 96286ef1 --stats
`);
        process.exit(0);
    }
    
    const archive = new MessageArchive();
    
    try {
        // List sessions
        if (args.includes('--list')) {
            listSessions(archive);
            return;
        }
        
        // Query specific session
        const sessionIndex = args.indexOf('--session');
        if (sessionIndex !== -1 && args[sessionIndex + 1]) {
            const sessionIdPrefix = args[sessionIndex + 1];
            const sessionId = findSession(archive, sessionIdPrefix);
            
            if (!sessionId) {
                console.error(`❌ Session not found: ${sessionIdPrefix}`);
                process.exit(1);
            }
            
            // Export
            if (args.includes('--export')) {
                exportSession(archive, sessionId);
                return;
            }
            
            // Stats
            if (args.includes('--stats')) {
                showSessionStats(archive, sessionId);
                return;
            }
            
            // Query events
            const eventType = args[args.indexOf('--type') + 1] || null;
            const includeThinking = args.includes('--include-thinking');
            const limit = parseInt(args[args.indexOf('--limit') + 1]) || 100;
            
            querySession(archive, sessionId, eventType, includeThinking, limit);
            return;
        }
        
        console.error('❌ No action specified. Use --help for usage.');
        process.exit(1);
        
    } finally {
        archive.close();
    }
}

/**
 * List all archived sessions
 */
function listSessions(archive) {
    const sessions = archive.listSessions();
    
    console.log(`📋 Archived Sessions (${sessions.length})\n`);
    
    sessions.forEach((sess, i) => {
        const started = new Date(sess.started_at).toISOString();
        const ended = new Date(sess.ended_at).toISOString();
        const duration = Math.round((sess.ended_at - sess.started_at) / 1000);
        
        console.log(`${(i + 1).toString().padStart(2)}. ${sess.session_id}`);
        console.log(`    Started: ${started}`);
        console.log(`    Duration: ${duration}s | Events: ${sess.event_count}`);
        console.log();
    });
}

/**
 * Find session by full or partial ID
 */
function findSession(archive, idPrefix) {
    const sessions = archive.listSessions();
    
    // Exact match
    const exact = sessions.find(s => s.session_id === idPrefix);
    if (exact) return exact.session_id;
    
    // Prefix match
    const matches = sessions.filter(s => s.session_id.startsWith(idPrefix));
    
    if (matches.length === 0) {
        return null;
    }
    
    if (matches.length > 1) {
        console.error(`❌ Ambiguous session ID. Multiple matches:`);
        matches.forEach(m => console.error(`  - ${m.session_id}`));
        process.exit(1);
    }
    
    return matches[0].session_id;
}

/**
 * Query session events
 */
function querySession(archive, sessionId, eventType, includeThinking, limit) {
    console.log(`🔍 Querying session: ${sessionId.substring(0, 8)}...\n`);
    
    const options = {
        includeThinking,
        includeUsage: true,
        eventTypes: eventType ? [eventType] : null
    };
    
    const events = archive.getSessionEvents(sessionId, options);
    
    if (events.length === 0) {
        console.log('No events found.');
        return;
    }
    
    console.log(`Found ${events.length} events${eventType ? ` (type: ${eventType})` : ''}\n`);
    
    const displayEvents = events.slice(0, limit);
    
    displayEvents.forEach((evt, i) => {
        const time = new Date(evt.timestamp).toISOString();
        console.log(`${(i + 1).toString().padStart(3)}. [${evt.event_type}] ${time}`);
        
        if (evt.role) {
            console.log(`     Role: ${evt.role}`);
        }
        
        if (evt.tool_name) {
            console.log(`     Tool: ${evt.tool_name}`);
        }
        
        if (evt.model_provider) {
            console.log(`     Model: ${evt.model_provider}/${evt.model_id}`);
        }
        
        if (evt.is_error) {
            console.log(`     ⚠️  ERROR`);
        }
        
        if (evt.thinking && includeThinking) {
            console.log(`     Thinking: ${evt.thinking.thinking_content.substring(0, 100)}...`);
        }
        
        if (evt.usage) {
            console.log(`     Tokens: ${evt.usage.total_tokens} | Cost: $${evt.usage.total_cost.toFixed(6)}`);
        }
        
        // Show content preview
        try {
            const content = JSON.parse(evt.content_json);
            if (content.role === 'user' && content.content) {
                const text = content.content.find(c => c.type === 'text')?.text || '';
                if (text) {
                    console.log(`     "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
                }
            }
        } catch (e) {
            // Ignore parse errors
        }
        
        console.log();
    });
    
    if (events.length > limit) {
        console.log(`... ${events.length - limit} more events (use --limit to see more)`);
    }
}

/**
 * Export session as JSONL
 */
function exportSession(archive, sessionId) {
    const jsonl = archive.exportSessionAsJsonl(sessionId);
    console.log(jsonl);
}

/**
 * Show session statistics
 */
function showSessionStats(archive, sessionId) {
    const stats = archive.getSessionStats(sessionId);
    
    console.log(`📊 Session Statistics\n`);
    console.log(`Session ID: ${sessionId}`);
    console.log(`Started: ${new Date(stats.start_time).toISOString()}`);
    console.log(`Ended: ${new Date(stats.end_time).toISOString()}`);
    console.log(`Duration: ${stats.duration_seconds}s\n`);
    
    console.log(`Events:`);
    console.log(`  Total: ${stats.total_events}`);
    console.log(`  Messages: ${stats.message_count}`);
    console.log(`  Tool calls: ${stats.tool_call_count}`);
    console.log(`  Errors: ${stats.error_count}\n`);
    
    console.log(`Tokens:`);
    console.log(`  Total: ${stats.total_tokens.toLocaleString()}`);
    console.log(`  Cost: $${stats.total_cost.toFixed(6)}\n`);
    
    console.log(`Storage:`);
    console.log(`  Size: ${(stats.total_size_bytes / 1024).toFixed(2)} KB\n`);
    
    // Event breakdown
    const eventsByType = archive.db.prepare(`
        SELECT event_type, COUNT(*) as count
        FROM events
        WHERE session_id = ?
        GROUP BY event_type
        ORDER BY count DESC
    `).all(sessionId);
    
    console.log(`Event breakdown:`);
    eventsByType.forEach(row => {
        console.log(`  ${row.event_type.padEnd(20)} ${row.count}`);
    });
}

if (require.main === module) {
    main();
}

module.exports = { main };
