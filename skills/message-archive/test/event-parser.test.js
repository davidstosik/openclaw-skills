/**
 * Event Parser Tests
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { EventParser } = require('../lib/event-parser');
const path = require('path');

test('EventParser - parse session event', () => {
    const parser = new EventParser();
    const raw = {
        type: 'session',
        id: 'test-session-123',
        version: 3,
        timestamp: '2026-02-13T12:00:00.000Z',
        cwd: '/home/test'
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, 'session');
    assert.strictEqual(events[0].event_id, 'test-session-123');
    assert.strictEqual(events[0].session_id, 'test-session-123');
    
    const content = JSON.parse(events[0].content_json);
    assert.strictEqual(content.version, 3);
    assert.strictEqual(content.cwd, '/home/test');
});

test('EventParser - parse model change event', () => {
    const parser = new EventParser();
    const raw = {
        type: 'model_change',
        id: 'model-123',
        parentId: 'parent-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5'
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, 'model_change');
    assert.strictEqual(events[0].model_provider, 'anthropic');
    assert.strictEqual(events[0].model_id, 'claude-sonnet-4-5');
    assert.strictEqual(events[0].parent_event_id, 'parent-123');
});

test('EventParser - parse custom event', () => {
    const parser = new EventParser();
    const raw = {
        type: 'custom',
        customType: 'model-snapshot',
        id: 'custom-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        data: { key: 'value' }
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, 'custom');
    assert.strictEqual(events[0].event_subtype, 'model-snapshot');
});

test('EventParser - parse user message', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'msg-123',
        parentId: 'parent-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'user',
            content: [
                { type: 'text', text: 'Hello' }
            ]
        }
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, 'message');
    assert.strictEqual(events[0].role, 'user');
});

test('EventParser - parse assistant message with tool call', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'msg-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'assistant',
            content: [
                { type: 'text', text: 'Let me check' },
                {
                    type: 'toolCall',
                    id: 'tool-456',
                    name: 'exec',
                    arguments: { command: 'ls' }
                }
            ],
            provider: 'anthropic',
            model: 'claude-sonnet-4-5'
        }
    };

    const events = parser.parseEvent(raw);
    
    // Should generate: message + tool_call
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].event_type, 'message');
    assert.strictEqual(events[1].event_type, 'tool_call');
    assert.strictEqual(events[1].tool_name, 'exec');
    assert.strictEqual(events[1].parent_event_id, 'msg-123');
});

test('EventParser - parse assistant message with thinking', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'msg-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'assistant',
            content: [
                {
                    type: 'thinking',
                    thinking: 'This is my thinking...',
                    thinkingSignature: 'ABC123'
                },
                { type: 'text', text: 'Response' }
            ]
        }
    };

    const events = parser.parseEvent(raw);
    
    // Should generate: message + thinking_block
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].event_type, 'message');
    assert.strictEqual(events[1].event_type, 'thinking_block');
    assert.strictEqual(events[1]._thinking_content, 'This is my thinking...');
    assert.strictEqual(events[1]._thinking_signature, 'ABC123');
});

test('EventParser - parse assistant message with usage', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'msg-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hi' }],
            provider: 'anthropic',
            model: 'claude-sonnet-4-5',
            usage: {
                input: 100,
                output: 50,
                totalTokens: 150,
                cost: {
                    input: 0.001,
                    output: 0.002,
                    total: 0.003
                }
            }
        }
    };

    const events = parser.parseEvent(raw);
    
    // Should generate: message + usage_stats
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].event_type, 'message');
    assert.strictEqual(events[1].event_type, 'usage_stats');
    assert.strictEqual(events[1]._usage.input_tokens, 100);
    assert.strictEqual(events[1]._usage.output_tokens, 50);
    assert.strictEqual(events[1]._usage.total_cost, 0.003);
});

test('EventParser - parse tool result', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'result-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'toolResult',
            toolCallId: 'tool-456',
            toolName: 'exec',
            content: [{ type: 'text', text: 'output' }],
            isError: false
        }
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, 'tool_result');
    assert.strictEqual(events[0].tool_name, 'exec');
    assert.strictEqual(events[0].is_error, 0);
});

test('EventParser - parse tool result with error', () => {
    const parser = new EventParser();
    const raw = {
        type: 'message',
        id: 'result-123',
        timestamp: '2026-02-13T12:00:00.000Z',
        message: {
            role: 'toolResult',
            toolName: 'exec',
            content: [{ type: 'text', text: 'error message' }],
            isError: true
        }
    };

    const events = parser.parseEvent(raw);
    
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].is_error, 1);
});

test('EventParser - extract session metadata', () => {
    const parser = new EventParser();
    const events = [
        {
            event_type: 'session',
            session_id: 'sess-123',
            timestamp: 1000
        },
        {
            event_type: 'message',
            timestamp: 2000
        },
        {
            event_type: 'tool_call',
            timestamp: 3000
        },
        {
            event_type: 'thinking_block',
            timestamp: 4000
        },
        {
            event_type: 'usage_stats',
            timestamp: 5000
        }
    ];

    const metadata = parser.extractSessionMetadata(events);
    
    assert.strictEqual(metadata.session_id, 'sess-123');
    assert.strictEqual(metadata.started_at, 1000);
    assert.strictEqual(metadata.ended_at, 5000);
    assert.strictEqual(metadata.event_count, 5);
    assert.strictEqual(metadata.has_thinking, true);
    assert.strictEqual(metadata.has_usage, true);
    assert.strictEqual(metadata.tool_calls, 1);
});

console.log('✅ All event parser tests passed!');
