#!/usr/bin/env node
/**
 * End-to-End Test - Full Pipeline
 * 
 * Tests the complete workflow:
 * 1. Initialize schema
 * 2. Parse session
 * 3. Insert events
 * 4. Query and filter
 * 5. Export and verify
 */

const { EventParser } = require('../lib/event-parser');
const { MessageArchive } = require('../lib/archive-db');
const { initializeEventSchema } = require('../tools/archive-events-init');
const path = require('path');
const fs = require('fs');

async function runEndToEndTest() {
    console.log('🧪 End-to-End Pipeline Test\n');
    console.log('=' .repeat(60));
    
    // 1. Setup test database
    console.log('\n1️⃣  Setting up test database...');
    const testDb = '/tmp/e2e-test.db';
    if (fs.existsSync(testDb)) {
        fs.unlinkSync(testDb);
    }
    
    initializeEventSchema(testDb);
    const archive = new MessageArchive(testDb);
    console.log('✓ Database initialized');
    
    // 2. Parse session
    console.log('\n2️⃣  Parsing real session...');
    const sessionPath = path.join(
        process.env.HOME,
        '.openclaw/agents/main/sessions/96286ef1-6a9e-49ca-b342-d17996da7e91.jsonl'
    );
    
    const parser = new EventParser();
    const events = await parser.parseEvents(sessionPath);
    console.log(`✓ Parsed ${events.length} events`);
    
    // 3. Insert events
    console.log('\n3️⃣  Inserting events...');
    const result = archive.insertEventBatch(events, 'agent:main:main');
    console.log(`✓ Inserted: ${result.inserted}, Skipped: ${result.skipped}, Errors: ${result.errors}`);
    
    if (result.inserted !== events.length) {
        throw new Error(`Expected ${events.length} insertions, got ${result.inserted}`);
    }
    
    // 4. Query sessions
    console.log('\n4️⃣  Querying sessions...');
    const sessions = archive.listSessions();
    console.log(`✓ Found ${sessions.length} session(s)`);
    
    if (sessions.length !== 1) {
        throw new Error(`Expected 1 session, got ${sessions.length}`);
    }
    
    const sessionId = sessions[0].session_id;
    console.log(`  Session ID: ${sessionId}`);
    
    // 5. Get session events
    console.log('\n5️⃣  Retrieving session events...');
    const queriedEvents = archive.getSessionEvents(sessionId);
    console.log(`✓ Retrieved ${queriedEvents.length} events`);
    
    if (queriedEvents.length !== events.length) {
        throw new Error(`Expected ${events.length} events, got ${queriedEvents.length}`);
    }
    
    // 6. Filter by event type
    console.log('\n6️⃣  Testing event type filters...');
    const toolCalls = archive.getEventsByType(sessionId, 'tool_call');
    const thinkingBlocks = archive.getEventsByType(sessionId, 'thinking_block');
    const toolResults = archive.getEventsByType(sessionId, 'tool_result');
    const messages = archive.getEventsByType(sessionId, 'message');
    
    console.log(`✓ Tool calls: ${toolCalls.length}`);
    console.log(`✓ Thinking blocks: ${thinkingBlocks.length}`);
    console.log(`✓ Tool results: ${toolResults.length}`);
    console.log(`✓ Messages: ${messages.length}`);
    
    // Verify counts match expected
    const expectedCounts = {
        tool_call: 7,
        thinking_block: 5,
        tool_result: 7,
        message: 6
    };
    
    if (toolCalls.length !== expectedCounts.tool_call) {
        throw new Error(`Expected ${expectedCounts.tool_call} tool calls, got ${toolCalls.length}`);
    }
    
    // 7. Get session statistics
    console.log('\n7️⃣  Computing session statistics...');
    const stats = archive.getSessionStats(sessionId);
    console.log(`✓ Duration: ${stats.duration_seconds}s`);
    console.log(`✓ Total events: ${stats.total_events}`);
    console.log(`✓ Messages: ${stats.message_count}`);
    console.log(`✓ Tool calls: ${stats.tool_call_count}`);
    console.log(`✓ Tokens: ${stats.total_tokens.toLocaleString()}`);
    console.log(`✓ Cost: $${stats.total_cost.toFixed(6)}`);
    
    if (stats.total_tokens !== 93293) {
        throw new Error(`Expected 93293 tokens, got ${stats.total_tokens}`);
    }
    
    // 8. Export as JSONL
    console.log('\n8️⃣  Exporting as JSONL...');
    const exported = archive.exportSessionAsJsonl(sessionId);
    const lines = exported.split('\n').filter(l => l.trim());
    console.log(`✓ Exported ${lines.length} JSONL lines`);
    
    // Verify all lines are valid JSON
    let validCount = 0;
    for (const line of lines) {
        try {
            const obj = JSON.parse(line);
            if (obj.type && obj.id && obj.timestamp) {
                validCount++;
            }
        } catch (e) {
            throw new Error(`Invalid JSONL line: ${line}`);
        }
    }
    
    if (validCount !== lines.length) {
        throw new Error(`Not all JSONL lines are valid: ${validCount}/${lines.length}`);
    }
    
    console.log(`✓ All ${validCount} lines are valid JSONL`);
    
    // 9. Test duplicate prevention
    console.log('\n9️⃣  Testing duplicate prevention...');
    const dupResult = archive.insertEventBatch(events, 'agent:main:main');
    console.log(`✓ Re-insert: ${dupResult.inserted} inserted, ${dupResult.skipped} skipped`);
    
    if (dupResult.inserted !== 0 || dupResult.skipped !== events.length) {
        throw new Error('Duplicate prevention failed');
    }
    
    // 10. Verify thinking blocks
    console.log('\n🔟  Verifying thinking blocks...');
    const eventsWithThinking = archive.getSessionEvents(sessionId, {
        includeThinking: true
    });
    
    const thinkingEvent = eventsWithThinking.find(e => e.event_type === 'thinking_block');
    if (!thinkingEvent || !thinkingEvent.thinking) {
        throw new Error('Thinking blocks not loaded correctly');
    }
    
    console.log(`✓ Thinking content loaded (${thinkingEvent.thinking.content_size} bytes)`);
    
    // Cleanup
    archive.close();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ END-TO-END TEST PASSED');
    console.log('\n📋 Summary:');
    console.log(`  ✓ Schema initialized`);
    console.log(`  ✓ ${events.length} events parsed`);
    console.log(`  ✓ ${result.inserted} events inserted`);
    console.log(`  ✓ ${queriedEvents.length} events queried`);
    console.log(`  ✓ ${lines.length} JSONL lines exported`);
    console.log(`  ✓ Duplicate prevention works`);
    console.log(`  ✓ Event type filtering works`);
    console.log(`  ✓ Session statistics accurate`);
    console.log(`  ✓ Thinking blocks loaded correctly`);
    console.log('\n🎉 All systems operational!\n');
}

runEndToEndTest().catch(err => {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
});
