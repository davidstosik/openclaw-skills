#!/usr/bin/env node

/**
 * Message Archive Backfill Tool
 * 
 * Import historical messages from:
 * - Exported chat files (Telegram JSON, WhatsApp TXT, Discord JSON)
 * - Session JSONL bulk import
 * - Future: Channel APIs
 * 
 * Usage:
 *   archive-backfill.js telegram-export --file ./result.json
 *   archive-backfill.js whatsapp-export --file ./chat.txt
 *   archive-backfill.js discord-export --file ./channel.json
 *   archive-backfill.js sessions-bulk --dir ~/.openclaw/agents/main/sessions
 */

const { MessageArchive } = require('../lib/archive-db');
const { SessionParser, findSessionFiles } = require('../lib/message-parser');
const {
    TelegramExportParser,
    WhatsAppExportParser,
    DiscordExportParser
} = require('../lib/backfill-parsers');
const path = require('path');

/**
 * Backfill from Telegram export
 */
async function backfillTelegramExport(filePath, archive) {
    console.log(`\n📱 Importing Telegram export: ${path.basename(filePath)}`);
    
    const parser = new TelegramExportParser();
    const messages = await parser.parseExport(filePath);
    
    console.log(`   Found ${messages.length} messages`);
    
    const result = archive.insertBatch(messages);
    
    console.log(`   ✓ Imported: ${result.inserted}`);
    console.log(`   ⊘ Skipped duplicates: ${result.skipped}`);
    
    // Log backfill operation
    archive.checkpoint(`backfill_telegram_${Date.now()}`, JSON.stringify({
        source: 'telegram-export',
        file: filePath,
        imported: result.inserted,
        skipped: result.skipped,
        timestamp: Date.now()
    }));
    
    return result;
}

/**
 * Backfill from WhatsApp export
 */
async function backfillWhatsAppExport(filePath, archive) {
    console.log(`\n💬 Importing WhatsApp export: ${path.basename(filePath)}`);
    
    const parser = new WhatsAppExportParser();
    const messages = await parser.parseExport(filePath);
    
    console.log(`   Found ${messages.length} messages`);
    
    const result = archive.insertBatch(messages);
    
    console.log(`   ✓ Imported: ${result.inserted}`);
    console.log(`   ⊘ Skipped duplicates: ${result.skipped}`);
    
    // Log backfill operation
    archive.checkpoint(`backfill_whatsapp_${Date.now()}`, JSON.stringify({
        source: 'whatsapp-export',
        file: filePath,
        imported: result.inserted,
        skipped: result.skipped,
        timestamp: Date.now()
    }));
    
    return result;
}

/**
 * Backfill from Discord export
 */
async function backfillDiscordExport(filePath, archive) {
    console.log(`\n🎮 Importing Discord export: ${path.basename(filePath)}`);
    
    const parser = new DiscordExportParser();
    const messages = await parser.parseExport(filePath);
    
    console.log(`   Found ${messages.length} messages`);
    
    const result = archive.insertBatch(messages);
    
    console.log(`   ✓ Imported: ${result.inserted}`);
    console.log(`   ⊘ Skipped duplicates: ${result.skipped}`);
    
    // Log backfill operation
    archive.checkpoint(`backfill_discord_${Date.now()}`, JSON.stringify({
        source: 'discord-export',
        file: filePath,
        imported: result.inserted,
        skipped: result.skipped,
        timestamp: Date.now()
    }));
    
    return result;
}

/**
 * Bulk import all session files
 */
async function backfillSessionsBulk(searchDir, archive) {
    console.log(`\n📁 Bulk importing sessions from: ${searchDir}`);
    
    const sessionFiles = await findSessionFiles(searchDir);
    console.log(`   Found ${sessionFiles.length} session files`);
    
    let totalImported = 0;
    let totalSkipped = 0;
    
    for (const file of sessionFiles) {
        try {
            console.log(`\n   Processing: ${path.basename(file)}`);
            
            const parser = new SessionParser(file);
            const messages = await parser.parseMessages(0); // No timestamp filter
            
            if (messages.length === 0) {
                console.log(`      (no messages)`);
                continue;
            }
            
            const result = archive.insertBatch(messages);
            totalImported += result.inserted;
            totalSkipped += result.skipped;
            
            console.log(`      ✓ ${result.inserted} imported, ${result.skipped} skipped`);
            
        } catch (err) {
            console.error(`      ❌ Error: ${err.message}`);
        }
    }
    
    console.log(`\n   Total imported: ${totalImported}`);
    console.log(`   Total skipped: ${totalSkipped}`);
    
    // Log backfill operation
    archive.checkpoint(`backfill_sessions_${Date.now()}`, JSON.stringify({
        source: 'sessions-bulk',
        directory: searchDir,
        imported: totalImported,
        skipped: totalSkipped,
        timestamp: Date.now()
    }));
    
    return { imported: totalImported, skipped: totalSkipped };
}

/**
 * Show backfill history
 */
function showBackfillHistory(archive) {
    const db = archive.db;
    
    const history = db.prepare(`
        SELECT key, value, updated_at 
        FROM archive_state 
        WHERE key LIKE 'backfill_%'
        ORDER BY updated_at DESC
        LIMIT 20
    `).all();
    
    if (history.length === 0) {
        console.log('\nNo backfill history found.');
        return;
    }
    
    console.log('\n📜 Backfill History:\n');
    
    for (const entry of history) {
        try {
            const data = JSON.parse(entry.value);
            const timestamp = new Date(data.timestamp || entry.updated_at).toLocaleString();
            
            console.log(`[${timestamp}] ${data.source}`);
            
            if (data.file) {
                console.log(`  File: ${path.basename(data.file)}`);
            }
            
            if (data.directory) {
                console.log(`  Directory: ${data.directory}`);
            }
            
            console.log(`  Imported: ${data.imported}, Skipped: ${data.skipped}`);
            console.log();
            
        } catch (err) {
            console.log(`  [Invalid entry: ${entry.key}]`);
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args.includes('--help')) {
        console.log(`
Message Archive Backfill Tool

Import historical messages from exported files or bulk import sessions.

Usage:
  archive-backfill.js telegram-export --file <path>
  archive-backfill.js whatsapp-export --file <path>
  archive-backfill.js discord-export --file <path>
  archive-backfill.js sessions-bulk --dir <path>
  archive-backfill.js history

Commands:
  telegram-export    Import Telegram Desktop JSON export (result.json)
  whatsapp-export    Import WhatsApp TXT export (_chat.txt)
  discord-export     Import Discord JSON export (from DiscordChatExporter)
  sessions-bulk      Bulk import all OpenClaw session JSONL files
  history            Show backfill operation history

Options:
  --file <path>      Path to export file
  --dir <path>       Directory to search for sessions

Examples:
  # Import Telegram export
  archive-backfill.js telegram-export --file ~/Downloads/ChatExport_2026/result.json
  
  # Import WhatsApp export
  archive-backfill.js whatsapp-export --file ~/Downloads/WhatsApp_Chat.txt
  
  # Bulk import all sessions
  archive-backfill.js sessions-bulk --dir ~/.openclaw/agents/main/sessions
  
  # View history
  archive-backfill.js history
        `);
        process.exit(0);
    }
    
    const command = args[0];
    const archive = new MessageArchive();
    
    try {
        switch (command) {
            case 'telegram-export': {
                const filePath = getArg(args, '--file');
                if (!filePath) {
                    throw new Error('--file is required');
                }
                await backfillTelegramExport(filePath, archive);
                break;
            }
            
            case 'whatsapp-export': {
                const filePath = getArg(args, '--file');
                if (!filePath) {
                    throw new Error('--file is required');
                }
                await backfillWhatsAppExport(filePath, archive);
                break;
            }
            
            case 'discord-export': {
                const filePath = getArg(args, '--file');
                if (!filePath) {
                    throw new Error('--file is required');
                }
                await backfillDiscordExport(filePath, archive);
                break;
            }
            
            case 'sessions-bulk': {
                const dir = getArg(args, '--dir');
                if (!dir) {
                    throw new Error('--dir is required');
                }
                await backfillSessionsBulk(dir, archive);
                break;
            }
            
            case 'history': {
                showBackfillHistory(archive);
                break;
            }
            
            default:
                console.error(`Unknown command: ${command}`);
                console.error('Run with --help for usage');
                process.exit(1);
        }
        
        // Show updated stats
        console.log('\n' + '─'.repeat(50));
        const stats = archive.getStats();
        console.log('💾 Updated Database Stats:');
        console.log(`   Total messages: ${stats.totalMessages}`);
        if (stats.channels.length > 0) {
            console.log(`   Channels: ${stats.channels.map(c => `${c.channel} (${c.count})`).join(', ')}`);
        }
        console.log('─'.repeat(50));
        
        archive.close();
        console.log('\n✅ Backfill complete');
        
    } catch (err) {
        console.error('\n❌ Backfill failed:', err.message);
        console.error(err.stack);
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

if (require.main === module) {
    main();
}

module.exports = {
    backfillTelegramExport,
    backfillWhatsAppExport,
    backfillDiscordExport,
    backfillSessionsBulk
};
