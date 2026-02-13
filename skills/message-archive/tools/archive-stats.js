#!/usr/bin/env node
/**
 * Show archive statistics
 */

const { MessageArchive } = require('../lib/archive-db');

function showStats() {
    const archive = new MessageArchive();
    
    console.log('📊 Archive Statistics\n');
    
    // Get session list
    const sessions = archive.listSessions();
    console.log(`Total sessions: ${sessions.length}\n`);
    
    // Overall events stats
    const totalEvents = archive.db.prepare('SELECT COUNT(*) as count FROM events').get();
    const eventsByType = archive.db.prepare(`
        SELECT event_type, COUNT(*) as count 
        FROM events 
        GROUP BY event_type 
        ORDER BY count DESC
    `).all();
    
    console.log(`Total events: ${totalEvents.count}`);
    console.log('\nEvents by type:');
    eventsByType.forEach(row => {
        console.log(`  ${row.event_type.padEnd(20)} ${row.count}`);
    });
    
    // Usage stats
    const usageTotal = archive.db.prepare(`
        SELECT 
            SUM(total_tokens) as tokens,
            SUM(total_cost) as cost
        FROM usage_stats
    `).get();
    
    console.log('\nUsage totals:');
    console.log(`  Total tokens: ${(usageTotal.tokens || 0).toLocaleString()}`);
    console.log(`  Total cost: $${(usageTotal.cost || 0).toFixed(4)}`);
    
    // Top 5 sessions by event count
    console.log('\nTop 5 sessions by event count:');
    sessions.slice(0, 5).forEach(sess => {
        const started = new Date(sess.started_at).toISOString().replace('T', ' ').substring(0, 19);
        console.log(`  ${sess.session_id.substring(0, 8)}... | ${sess.event_count} events | ${started}`);
    });
    
    // Date range
    const dateRange = archive.db.prepare(`
        SELECT 
            MIN(timestamp) as earliest,
            MAX(timestamp) as latest
        FROM events
    `).get();
    
    if (dateRange.earliest) {
        console.log('\nDate range:');
        console.log(`  Earliest: ${new Date(dateRange.earliest).toISOString()}`);
        console.log(`  Latest: ${new Date(dateRange.latest).toISOString()}`);
        const days = Math.round((dateRange.latest - dateRange.earliest) / (1000 * 60 * 60 * 24));
        console.log(`  Span: ${days} days`);
    }
    
    // Storage size
    const dbPath = require('path').join(process.env.HOME, '.openclaw', 'archive', 'messages.db');
    const fs = require('fs');
    const stats = fs.statSync(dbPath);
    console.log(`\n📁 Database size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    
    archive.close();
}

showStats();
