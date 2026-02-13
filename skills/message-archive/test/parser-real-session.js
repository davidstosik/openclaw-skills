#!/usr/bin/env node
/**
 * Test event parser with a real session file
 */

const { EventParser } = require('../lib/event-parser');
const path = require('path');

async function testRealSession() {
    const sessionPath = path.join(process.env.HOME, '.openclaw/agents/main/sessions/96286ef1-6a9e-49ca-b342-d17996da7e91.jsonl');
    
    console.log('📄 Parsing real session file...');
    console.log(`File: ${sessionPath}\n`);
    
    const parser = new EventParser({ verbose: true });
    const events = await parser.parseEvents(sessionPath);
    
    console.log(`✓ Parsed ${events.length} events\n`);
    
    // Count by type
    const byType = {};
    events.forEach(e => {
        byType[e.event_type] = (byType[e.event_type] || 0) + 1;
    });
    
    console.log('📊 Events by type:');
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        console.log(`  ${type.padEnd(20)} ${count}`);
    });
    
    // Get session metadata
    const metadata = parser.extractSessionMetadata(events);
    console.log('\n📋 Session metadata:');
    console.log(`  Session ID: ${metadata.session_id}`);
    console.log(`  Started: ${new Date(metadata.started_at).toISOString()}`);
    console.log(`  Ended: ${new Date(metadata.ended_at).toISOString()}`);
    console.log(`  Duration: ${Math.round((metadata.ended_at - metadata.started_at) / 1000)}s`);
    console.log(`  Tool calls: ${metadata.tool_calls}`);
    console.log(`  Errors: ${metadata.errors}`);
    console.log(`  Has thinking: ${metadata.has_thinking}`);
    console.log(`  Has usage: ${metadata.has_usage}`);
    
    // Show sample events
    console.log('\n📝 Sample events:');
    console.log('\n1. Session event:');
    const sessionEvent = events.find(e => e.event_type === 'session');
    console.log(JSON.stringify(sessionEvent, null, 2).substring(0, 300) + '...');
    
    console.log('\n2. Tool call event:');
    const toolEvent = events.find(e => e.event_type === 'tool_call');
    if (toolEvent) {
        console.log(JSON.stringify(toolEvent, null, 2).substring(0, 300) + '...');
    }
    
    console.log('\n3. Thinking block:');
    const thinkingEvent = events.find(e => e.event_type === 'thinking_block');
    if (thinkingEvent) {
        const { _thinking_content, ...rest } = thinkingEvent;
        console.log(JSON.stringify(rest, null, 2));
        console.log(`  Content preview: ${_thinking_content.substring(0, 100)}...`);
    }
    
    console.log('\n4. Usage stats:');
    const usageEvent = events.find(e => e.event_type === 'usage_stats');
    if (usageEvent) {
        console.log(`  Tokens: ${usageEvent._usage.total_tokens}`);
        console.log(`  Cost: $${usageEvent._usage.total_cost.toFixed(6)}`);
    }
    
    console.log('\n✅ Real session parsing test complete!');
}

testRealSession().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
