#!/usr/bin/env node

/**
 * Archive Scanner
 * 
 * Scans session JSONL files for new messages/events and archives them.
 * Designed to run periodically (via heartbeat or cron).
 * 
 * Usage:
 *   node archive-scan.js [options]
 * 
 * Options:
 *   --mode messages|events|both    What to scan (default: messages)
 *   --force                        Scan all (ignore checkpoint)
 *   --dir <path>                   Custom session directory
 */

const { MessageArchive } = require('../lib/archive-db');
const { SessionParser, findSessionFiles } = require('../lib/message-parser');
const { EventParser } = require('../lib/event-parser');
const { SessionDetector } = require('../lib/session-detector');
const { SessionSummarizer } = require('../lib/session-summarizer');
const path = require('path');

const CHECKPOINT_KEY = 'last_scan_timestamp';
const EVENTS_CHECKPOINT_KEY = 'last_events_scan_timestamp';
const SESSIONS_CHECKPOINT_KEY = 'last_sessions_scan_timestamp';

async function scanAndArchive(options = {}) {
    const { force = false, searchDir = null, mode = 'messages' } = options;

    console.log(`🔍 Starting archive scan (mode: ${mode})...`);

    const archive = new MessageArchive();
    
    let stats = { imported: 0, skipped: 0, errors: 0, filesProcessed: 0 };
    
    // Find all session files
    console.log('📁 Searching for session files...');
    const sessionFiles = await findSessionFiles(searchDir);
    console.log(`   Found ${sessionFiles.length} session files`);
    
    // Scan sessions (metadata + summaries)
    if (mode === 'sessions' || mode === 'all') {
        const sessionStats = await scanSessions(archive, sessionFiles, force);
        stats.imported += sessionStats.inserted;
        stats.skipped += sessionStats.skipped;
        stats.errors += sessionStats.errors;
        if (mode === 'sessions') {
            stats.filesProcessed = sessionStats.filesProcessed;
        }
    }
    
    // Scan messages
    if (mode === 'messages' || mode === 'both' || mode === 'all') {
        const messageStats = await scanMessages(archive, sessionFiles, force);
        stats.imported += messageStats.imported;
        stats.skipped += messageStats.skipped;
        stats.filesProcessed = messageStats.filesProcessed;
    }
    
    // Scan events
    if (mode === 'events' || mode === 'both' || mode === 'all') {
        const eventStats = await scanEvents(archive, sessionFiles, force);
        stats.imported += eventStats.inserted;
        stats.skipped += eventStats.skipped;
        stats.errors += eventStats.errors;
        if (mode === 'events') {
            stats.filesProcessed = eventStats.filesProcessed;
        }
    }

    // Print summary
    console.log('\n' + '─'.repeat(50));
    console.log('📊 Scan Summary:');
    console.log(`   Files processed: ${stats.filesProcessed}`);
    console.log(`   Items imported: ${stats.imported}`);
    console.log(`   Duplicates skipped: ${stats.skipped}`);
    if (stats.errors > 0) {
        console.log(`   Errors: ${stats.errors}`);
    }
    console.log('─'.repeat(50));

    archive.close();

    return stats;
}

/**
 * Scan messages from session files
 */
async function scanMessages(archive, sessionFiles, force) {
    console.log('\n📧 Scanning messages...');
    
    let lastTimestamp = parseInt(archive.checkpoint(CHECKPOINT_KEY) || '0');
    
    if (force) {
        console.log('⚠️  Force mode: scanning all messages');
        lastTimestamp = 0;
    } else {
        const lastScanDate = lastTimestamp ? new Date(lastTimestamp).toLocaleString() : 'never';
        console.log(`📅 Last message scan: ${lastScanDate}`);
    }
    
    let imported = 0;
    let skipped = 0;
    let filesProcessed = 0;
    
    for (const sessionFile of sessionFiles) {
        try {
            const parser = new SessionParser(sessionFile);
            const messages = await parser.parseMessages(lastTimestamp);

            if (messages.length === 0) {
                continue;
            }

            console.log(`\n📄 ${path.basename(sessionFile)}`);
            console.log(`   Found ${messages.length} new messages`);

            for (const msg of messages) {
                const rowId = archive.insertMessage(msg, { skipIfExists: true });
                if (rowId) {
                    imported++;
                } else {
                    skipped++;
                }
            }

            filesProcessed++;
            
        } catch (err) {
            console.error(`❌ Error processing ${sessionFile}: ${err.message}`);
        }
    }
    
    // Update checkpoint
    const now = Date.now();
    archive.checkpoint(CHECKPOINT_KEY, now.toString());
    
    console.log(`\n✓ Messages: ${imported} imported, ${skipped} skipped`);
    
    return { imported, skipped, filesProcessed };
}

/**
 * Scan events from session files
 */
async function scanEvents(archive, sessionFiles, force) {
    console.log('\n🎯 Scanning events...');
    
    let lastTimestamp = parseInt(archive.checkpoint(EVENTS_CHECKPOINT_KEY) || '0');
    
    if (force) {
        console.log('⚠️  Force mode: scanning all events');
        lastTimestamp = 0;
    } else {
        const lastScanDate = lastTimestamp ? new Date(lastTimestamp).toLocaleString() : 'never';
        console.log(`📅 Last event scan: ${lastScanDate}`);
    }
    
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let filesProcessed = 0;
    
    const eventParser = new EventParser({ verbose: false });
    
    for (const sessionFile of sessionFiles) {
        try {
            // Parse events
            const events = await eventParser.parseEvents(sessionFile, lastTimestamp);
            
            if (events.length === 0) {
                continue;
            }
            
            // Determine session key from path
            // Format: ~/.openclaw/agents/main/sessions/UUID.jsonl
            const sessionKey = 'agent:main:main'; // TODO: extract from path
            
            // Extract session ID from filename (UUID.jsonl)
            const basename = path.basename(sessionFile, '.jsonl');
            const sessionId = basename; // Filename is the session UUID
            
            console.log(`\n📄 ${path.basename(sessionFile)}`);
            console.log(`   Found ${events.length} new events`);
            
            // Insert batch with explicit session ID
            // In force mode, disable foreign key constraints to allow backfill of incomplete history
            const result = archive.insertEventBatch(events, sessionKey, { 
                skipIfExists: true, 
                sessionId,
                disableForeignKeys: force 
            });
            
            console.log(`   ✓ Inserted: ${result.inserted}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
            
            totalInserted += result.inserted;
            totalSkipped += result.skipped;
            totalErrors += result.errors;
            filesProcessed++;
            
        } catch (err) {
            console.error(`❌ Error processing ${sessionFile}: ${err.message}`);
            totalErrors++;
        }
    }
    
    // Update checkpoint
    const now = Date.now();
    archive.checkpoint(EVENTS_CHECKPOINT_KEY, now.toString());
    
    console.log(`\n✓ Events: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors`);
    
    return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors, filesProcessed };
}

/**
 * Scan and populate sessions table
 */
async function scanSessions(archive, sessionFiles, force) {
    console.log('\n🗂️  Scanning sessions...');
    
    let lastTimestamp = parseInt(archive.checkpoint(SESSIONS_CHECKPOINT_KEY) || '0');
    
    if (force) {
        console.log('⚠️  Force mode: scanning all sessions');
        lastTimestamp = 0;
    } else {
        const lastScanDate = lastTimestamp ? new Date(lastTimestamp).toLocaleString() : 'never';
        console.log(`📅 Last session scan: ${lastScanDate}`);
    }
    
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let filesProcessed = 0;
    
    const detector = new SessionDetector();
    const summarizer = new SessionSummarizer({ verbose: false });
    const eventParser = new EventParser({ verbose: false });
    
    for (const sessionFile of sessionFiles) {
        try {
            // Detect session metadata
            const sessionData = await detector.detectSession(sessionFile);
            
            // Skip if already processed and not in force mode
            const existing = archive.getSession(sessionData.id);
            if (existing && !force) {
                totalSkipped++;
                continue;
            }
            
            // Get events for summary generation
            const events = await eventParser.parseEvents(sessionFile, 0);
            
            // Generate title + summary
            let summary;
            try {
                summary = await summarizer.summarize(sessionData, events);
            } catch (error) {
                console.warn(`   ⚠️ Summary generation failed, using fallback`);
                summary = summarizer.generateFallback(sessionData, events);
            }
            
            // Upsert session
            sessionData.title = summary.title;
            sessionData.summary = summary.summary;
            
            const wasInserted = archive.upsertSession(sessionData);
            
            if (wasInserted) {
                totalInserted++;
                console.log(`\n✅ ${path.basename(sessionFile)}`);
                console.log(`   Type: ${sessionData.type} | Status: ${sessionData.status}`);
                console.log(`   Title: "${sessionData.title}"`);
                console.log(`   Summary: "${sessionData.summary}"`);
            } else {
                totalSkipped++;
                console.log(`\n🔄 Updated: ${path.basename(sessionFile)}`);
            }
            
            filesProcessed++;
            
        } catch (err) {
            console.error(`❌ Error processing ${sessionFile}: ${err.message}`);
            totalErrors++;
        }
    }
    
    // Update checkpoint
    const now = Date.now();
    archive.checkpoint(SESSIONS_CHECKPOINT_KEY, now.toString());
    
    console.log(`\n✓ Sessions: ${totalInserted} inserted, ${totalSkipped} skipped, ${totalErrors} errors`);
    
    return { inserted: totalInserted, skipped: totalSkipped, errors: totalErrors, filesProcessed };
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Archive Scanner - Scan session files for messages, events, and/or sessions

Usage: node archive-scan.js [options]

Options:
  --mode <type>        What to scan: messages | events | sessions | both | all (default: messages)
                       - messages: Scan and archive message content
                       - events: Scan and archive all events
                       - sessions: Scan session metadata and generate summaries
                       - both: messages + events
                       - all: messages + events + sessions
  --force              Scan all files (ignore checkpoint)
  --dir <path>         Custom session directory
  --help, -h           Show this help

Examples:
  node archive-scan.js --mode sessions
  node archive-scan.js --mode all --force
  node archive-scan.js --mode both
  node archive-scan.js --dir ~/.openclaw/agents/main/sessions
`);
        process.exit(0);
    }
    
    const options = {
        force: args.includes('--force'),
        searchDir: null,
        mode: 'messages'
    };

    // Parse --mode argument
    const modeIndex = args.indexOf('--mode');
    if (modeIndex !== -1 && args[modeIndex + 1]) {
        options.mode = args[modeIndex + 1];
        if (!['messages', 'events', 'sessions', 'both', 'all'].includes(options.mode)) {
            console.error(`Invalid mode: ${options.mode}. Must be: messages, events, sessions, both, or all`);
            process.exit(1);
        }
    }

    // Parse --dir argument
    const dirIndex = args.indexOf('--dir');
    if (dirIndex !== -1 && args[dirIndex + 1]) {
        options.searchDir = args[dirIndex + 1];
    }

    scanAndArchive(options)
        .then((stats) => {
            console.log('\n✅ Scan complete');
            if (stats.errors > 0) {
                console.warn(`⚠️  ${stats.errors} errors occurred`);
            }
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Scan failed:', err.message);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { scanAndArchive };
