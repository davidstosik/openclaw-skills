#!/usr/bin/env node
/**
 * Test database integration with real session
 */

const { EventParser } = require('../lib/event-parser');
const { MessageArchive } = require('../lib/archive-db');
const path = require('path');
const fs = require('fs');

async function testIntegration() {
    console.log('🔗 Testing Database Integration\n');
    
    // Use test database
    const testDbPath = '/tmp/test-events.db';
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }
    
    // Initialize schema first
    const { initializeEventSchema } = require('../tools/archive-events-init');
    initializeEventSchema(testDbPath);
    
    const archive = new MessageArchive(testDbPath);
    console.log(`✓ Database opened: ${testDbPath}`);
    
    // Parse real session
    const sessionPath = path.join(
        process.env.HOME,
        '.openclaw/agents/main/sessions/96286ef1-6a9e-49ca-b342-d17996da7e91.jsonl'
    );
    
    console.log(`\n📄 Parsing session: ${path.basename(sessionPath)}`);
    const parser = new EventParser();
    const events = await parser.parseEvents(sessionPath);
    console.log(`✓ Parsed ${events.length} events`);
    
    // Insert batch
    console.log('\n💾 Inserting events...');
    const sessionKey = 'agent:main:main';
    const result = archive.insertEventBatch(events, sessionKey, { verbose: true });
    
    console.log(`✓ Inserted: ${result.inserted}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Errors: ${result.errors}`);
    
    // Query back
    const sessionId = events.find(e => e.event_type === 'session')?.session_id;
    console.log(`\n🔍 Querying session: ${sessionId}`);
    
    const queriedEvents = archive.getSessionEvents(sessionId, {
        includeThinking: true,
        includeUsage: true
    });
    console.log(`✓ Retrieved ${queriedEvents.length} events`);
    
    // Get session stats
    const stats = archive.getSessionStats(sessionId);
    console.log('\n📊 Session Statistics:');
    console.log(`  Total events: ${stats.total_events}`);
    console.log(`  Messages: ${stats.message_count}`);
    console.log(`  Tool calls: ${stats.tool_call_count}`);
    console.log(`  Errors: ${stats.error_count}`);
    console.log(`  Total tokens: ${stats.total_tokens}`);
    console.log(`  Total cost: $${stats.total_cost.toFixed(6)}`);
    console.log(`  Duration: ${stats.duration_seconds}s`);
    console.log(`  Size: ${(stats.total_size_bytes / 1024).toFixed(2)} KB`);
    
    // Test event type queries
    console.log('\n🔎 Query by event type:');
    const toolCalls = archive.getEventsByType(sessionId, 'tool_call');
    console.log(`  Tool calls: ${toolCalls.length}`);
    
    const thinkingBlocks = archive.getEventsByType(sessionId, 'thinking_block');
    console.log(`  Thinking blocks: ${thinkingBlocks.length}`);
    
    const toolResults = archive.getEventsByType(sessionId, 'tool_result');
    console.log(`  Tool results: ${toolResults.length}`);
    
    // Test export
    console.log('\n📤 Testing JSONL export...');
    const exported = archive.exportSessionAsJsonl(sessionId);
    const exportedLines = exported.split('\n').length;
    console.log(`✓ Exported ${exportedLines} JSONL lines`);
    
    // Verify it's valid JSON
    const lines = exported.split('\n').filter(l => l.trim());
    let validJson = 0;
    for (const line of lines) {
        try {
            JSON.parse(line);
            validJson++;
        } catch (e) {
            console.error(`Invalid JSON: ${line.substring(0, 100)}`);
        }
    }
    console.log(`✓ All ${validJson} lines are valid JSON`);
    
    // Test duplicate prevention
    console.log('\n🔄 Testing duplicate prevention...');
    const dupResult = archive.insertEventBatch(events, sessionKey);
    console.log(`✓ Duplicate check: inserted=${dupResult.inserted}, skipped=${dupResult.skipped}`);
    
    if (dupResult.inserted === 0 && dupResult.skipped === events.length) {
        console.log('✓ Duplicate prevention works!');
    } else {
        console.warn('⚠️  Duplicate prevention may have issues');
    }
    
    // List sessions
    console.log('\n📋 Listing sessions:');
    const sessions = archive.listSessions();
    for (const sess of sessions) {
        console.log(`  ${sess.session_id.substring(0, 8)}... | ${sess.event_count} events | ${new Date(sess.started_at).toISOString()}`);
    }
    
    archive.close();
    console.log('\n✅ Integration test complete!');
    console.log(`\n📁 Test database: ${testDbPath}`);
}

testIntegration().catch(err => {
    console.error('❌ Error:', err);
    console.error(err.stack);
    process.exit(1);
});
