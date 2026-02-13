#!/usr/bin/env node
/**
 * Initialize Event Archive Tables
 * 
 * Creates the events, thinking_blocks, and usage_stats tables
 * for comprehensive session event archiving.
 * 
 * Usage: node tools/archive-events-init.js [--db-path <path>]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(process.env.HOME, '.openclaw', 'archive', 'messages.db');

function initializeEventSchema(dbPath = DEFAULT_DB_PATH) {
    console.log('📊 Initializing Event Archive Schema');
    console.log(`Database: ${dbPath}`);
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`✓ Created directory: ${dir}`);
    }
    
    // Open database
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    console.log('\n⚙️  Creating tables...');
    
    // Read schema file from workspace root
    const schemaPath = path.join(process.env.HOME, '.openclaw', 'workspace', 'message-archive-events-schema.sql');
    if (!fs.existsSync(schemaPath)) {
        console.error(`\n❌ Schema file not found: ${schemaPath}`);
        console.error('Please ensure message-archive-events-schema.sql exists in ~/.openclaw/workspace/');
        process.exit(1);
    }
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    try {
        // Execute schema in transaction
        db.exec(schema);
        
        // Verify tables created
        const tables = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name IN ('events', 'thinking_blocks', 'usage_stats', 'daily_stats')
            ORDER BY name
        `).all();
        
        console.log('\n✓ Tables created:');
        tables.forEach(t => console.log(`  - ${t.name}`));
        
        // Verify indexes
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='index' AND name LIKE 'idx_events%'
            ORDER BY name
        `).all();
        
        console.log(`\n✓ Indexes created: ${indexes.length}`);
        
        // Verify views
        const views = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='view' AND name IN ('events_with_usage', 'tool_events', 'session_stats')
            ORDER BY name
        `).all();
        
        console.log(`✓ Views created: ${views.length}`);
        
        // Get database size
        const stats = fs.statSync(dbPath);
        console.log(`\n📁 Database size: ${(stats.size / 1024).toFixed(2)} KB`);
        
        // Test insert
        console.log('\n🧪 Testing schema with sample data...');
        
        const testEventId = `test_${Date.now()}`;
        const testResult = db.prepare(`
            INSERT INTO events (
                event_id, session_key, session_id, event_type,
                timestamp, created_at, content_json, content_size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            testEventId,
            'test:session',
            testEventId,
            'session',
            Date.now(),
            Date.now(),
            JSON.stringify({ version: 3 }),
            23
        );
        
        if (testResult.changes === 1) {
            console.log('✓ Sample event inserted successfully');
            
            // Clean up test data
            db.prepare('DELETE FROM events WHERE event_id = ?').run(testEventId);
            console.log('✓ Test data cleaned up');
        }
        
        console.log('\n✅ Event archive schema initialized successfully!');
        console.log('\n📖 Next steps:');
        console.log('  1. Run: node tools/archive-scan.js --mode events');
        console.log('  2. Query: node tools/archive-query.js --events');
        
    } catch (error) {
        console.error('\n❌ Error initializing schema:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        db.close();
    }
}

// CLI handling
if (require.main === module) {
    const args = process.argv.slice(2);
    let dbPath = DEFAULT_DB_PATH;
    
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--db-path' && args[i + 1]) {
            dbPath = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: node tools/archive-events-init.js [options]

Options:
  --db-path <path>    Path to SQLite database (default: ~/.openclaw/archive/messages.db)
  --help, -h          Show this help message

Description:
  Initializes the event archiving schema in the message archive database.
  Creates tables: events, thinking_blocks, usage_stats, daily_stats
  Safe to run multiple times (uses IF NOT EXISTS).
`);
            process.exit(0);
        }
    }
    
    initializeEventSchema(dbPath);
}

module.exports = { initializeEventSchema };
