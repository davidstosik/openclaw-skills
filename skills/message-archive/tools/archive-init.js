#!/usr/bin/env node

/**
 * Archive Initialization Tool
 * 
 * Initialize the message archive database and perform first-time setup.
 * 
 * Usage:
 *   node archive-init.js [--db-path <path>]
 */

const { MessageArchive, DEFAULT_DB_PATH } = require('../lib/archive-db');
const fs = require('fs');
const path = require('path');

function initializeArchive(dbPath = DEFAULT_DB_PATH) {
    console.log('\n📦 Initializing Message Archive\n');
    console.log(`Database location: ${dbPath}`);
    
    // Check if database already exists
    const exists = fs.existsSync(dbPath);
    
    if (exists) {
        const stats = fs.statSync(dbPath);
        console.log(`⚠️  Database already exists (${(stats.size / 1024).toFixed(2)} KB)`);
        console.log('   Schema will be updated if needed.\n');
    } else {
        console.log('✨ Creating new database...\n');
    }
    
    // Initialize (creates schema if needed)
    const archive = new MessageArchive(dbPath);
    
    console.log('✅ Database initialized successfully');
    
    // Show initial stats
    const stats = archive.getStats();
    console.log('\n📊 Current Stats:');
    console.log(`   Messages: ${stats.totalMessages}`);
    console.log(`   Attachments: ${stats.totalAttachments}`);
    console.log(`   Reactions: ${stats.totalReactions}`);
    
    if (stats.channels.length > 0) {
        console.log('\n   Channels:');
        for (const ch of stats.channels) {
            console.log(`     - ${ch.channel}: ${ch.count} messages`);
        }
    }
    
    // Show next steps
    console.log('\n📝 Next Steps:\n');
    console.log('1. Run a scan to archive existing messages:');
    console.log(`   node tools/archive-scan.js`);
    console.log();
    console.log('2. Import historical data (optional):');
    console.log(`   node tools/archive-backfill.js telegram-export --file ~/export.json`);
    console.log();
    console.log('3. Query messages:');
    console.log(`   node tools/archive-query.js --stats`);
    console.log(`   node tools/archive-query.js --search "keyword"`);
    console.log();
    
    archive.close();
}

// CLI interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    let dbPath = DEFAULT_DB_PATH;
    
    const dbIndex = args.indexOf('--db-path');
    if (dbIndex !== -1 && args[dbIndex + 1]) {
        dbPath = args[dbIndex + 1];
    }
    
    try {
        initializeArchive(dbPath);
    } catch (err) {
        console.error('\n❌ Initialization failed:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

module.exports = { initializeArchive };
