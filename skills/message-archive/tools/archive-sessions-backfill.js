#!/usr/bin/env node

/**
 * Sessions Backfill - Populate sessions table retroactively
 * 
 * Scans all existing session files and populates the sessions table
 * with metadata and AI-generated summaries.
 * 
 * Usage:
 *   node archive-sessions-backfill.js [options]
 * 
 * Options:
 *   --dry-run           Show what would be done without making changes
 *   --force             Overwrite existing sessions
 *   --limit <n>         Limit number of sessions to process
 *   --verbose           Show detailed output
 */

const { MessageArchive } = require('../lib/archive-db');
const { SessionDetector } = require('../lib/session-detector');
const { SessionSummarizer } = require('../lib/session-summarizer');
const { EventParser } = require('../lib/event-parser');
const path = require('path');

async function backfillSessions(options = {}) {
    const {
        dryRun = false,
        force = false,
        limit = null,
        verbose = false
    } = options;

    console.log('🔄 Sessions Backfill\n');
    
    if (dryRun) {
        console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    }

    const archive = new MessageArchive();
    const detector = new SessionDetector();
    const summarizer = new SessionSummarizer({ verbose, dryRun });
    const eventParser = new EventParser({ verbose: false });

    // Find all session files
    console.log('📁 Finding session files...');
    const sessionFiles = await detector.findSessionFiles();
    console.log(`   Found ${sessionFiles.length} session files\n`);

    // Limit if requested
    const filesToProcess = limit ? sessionFiles.slice(0, limit) : sessionFiles;
    
    if (limit && filesToProcess.length < sessionFiles.length) {
        console.log(`⚠️  Processing only ${limit} sessions (${sessionFiles.length - limit} skipped)\n`);
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < filesToProcess.length; i++) {
        const sessionFile = filesToProcess[i];
        const filename = path.basename(sessionFile);
        
        console.log(`[${i + 1}/${filesToProcess.length}] Processing: ${filename}`);

        try {
            // Detect session metadata
            const sessionData = await detector.detectSession(sessionFile);
            
            // Check if session already exists
            const existing = archive.getSession(sessionData.id);
            
            if (existing && !force) {
                console.log(`   ↷ Skipped (already exists)`);
                skipped++;
                continue;
            }

            // Get events for summary generation
            const events = await eventParser.parseEvents(sessionFile, 0);
            
            if (verbose) {
                console.log(`   Detected: type=${sessionData.type}, events=${events.length}`);
            }

            // Generate summary
            let summary;
            try {
                summary = await summarizer.summarize(sessionData, events);
            } catch (error) {
                console.warn(`   ⚠️ Summary generation failed: ${error.message}`);
                summary = summarizer.generateFallback(sessionData, events);
            }

            sessionData.title = summary.title;
            sessionData.summary = summary.summary;

            if (verbose || dryRun) {
                console.log(`   Title: "${sessionData.title}"`);
                console.log(`   Summary: "${sessionData.summary}"`);
                console.log(`   Type: ${sessionData.type}, Status: ${sessionData.status}`);
                console.log(`   Messages: ${sessionData.message_count}, Events: ${sessionData.event_count}`);
            }

            // Insert/update session
            if (!dryRun) {
                const wasInserted = archive.upsertSession(sessionData);
                
                if (wasInserted) {
                    console.log(`   ✅ Inserted`);
                    inserted++;
                } else {
                    console.log(`   🔄 Updated`);
                    updated++;
                }
            } else {
                if (existing) {
                    console.log(`   [DRY RUN] Would update`);
                    updated++;
                } else {
                    console.log(`   [DRY RUN] Would insert`);
                    inserted++;
                }
            }

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
            errors++;
        }

        console.log(); // Blank line between sessions
    }

    // Print summary
    console.log('─'.repeat(50));
    console.log('📊 Backfill Summary:');
    console.log(`   Sessions processed: ${filesToProcess.length}`);
    console.log(`   Inserted: ${inserted}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    if (errors > 0) {
        console.log(`   Errors: ${errors}`);
    }
    console.log('─'.repeat(50));

    if (dryRun) {
        console.log('\n⚠️  This was a dry run. Use without --dry-run to apply changes.');
    }

    archive.close();

    return { inserted, updated, skipped, errors };
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
Sessions Backfill - Populate sessions table retroactively

Usage: node archive-sessions-backfill.js [options]

Options:
  --dry-run            Show what would be done without making changes
  --force              Overwrite existing sessions
  --limit <n>          Limit number of sessions to process
  --verbose            Show detailed output
  --help, -h           Show this help

Examples:
  node archive-sessions-backfill.js --dry-run
  node archive-sessions-backfill.js --force
  node archive-sessions-backfill.js --limit 10 --verbose
        `);
        process.exit(0);
    }

    const options = {
        dryRun: args.includes('--dry-run'),
        force: args.includes('--force'),
        verbose: args.includes('--verbose'),
        limit: null
    };

    // Parse --limit argument
    const limitIndex = args.indexOf('--limit');
    if (limitIndex !== -1 && args[limitIndex + 1]) {
        options.limit = parseInt(args[limitIndex + 1]);
        if (isNaN(options.limit) || options.limit < 1) {
            console.error('Error: --limit must be a positive number');
            process.exit(1);
        }
    }

    backfillSessions(options)
        .then((stats) => {
            console.log('\n✅ Backfill complete');
            if (stats.errors > 0) {
                console.warn(`⚠️  ${stats.errors} errors occurred`);
                process.exit(1);
            }
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Backfill failed:', err.message);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { backfillSessions };
