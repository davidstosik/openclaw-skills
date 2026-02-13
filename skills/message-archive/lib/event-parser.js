/**
 * Event Parser - Parse session JSONL files for event archiving
 * 
 * Extracts all event types from OpenClaw session JSONL files:
 * - Session initialization
 * - Model changes
 * - Thinking level changes
 * - Custom events
 * - Messages (user/assistant/tool results)
 * - Tool calls (extracted from messages)
 * - Thinking blocks (extracted from messages)
 * - Usage stats (extracted from messages)
 * 
 * @module event-parser
 */

const fs = require('fs');
const readline = require('readline');

class EventParser {
    constructor(options = {}) {
        this.verbose = options.verbose || false;
    }

    /**
     * Parse entire JSONL session file
     * @param {string} sessionFilePath - Path to .jsonl file
     * @param {number} sinceTimestamp - Only parse events after this time (milliseconds)
     * @returns {Promise<Array<object>>} Parsed events
     */
    async parseEvents(sessionFilePath, sinceTimestamp = 0) {
        const events = [];
        
        if (!fs.existsSync(sessionFilePath)) {
            throw new Error(`Session file not found: ${sessionFilePath}`);
        }

        const fileStream = fs.createReadStream(sessionFilePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let lineNumber = 0;
        for await (const line of rl) {
            lineNumber++;
            
            if (!line.trim()) continue;
            
            try {
                const rawEvent = JSON.parse(line);
                const timestamp = new Date(rawEvent.timestamp).getTime();
                
                if (timestamp <= sinceTimestamp) continue;
                
                const parsedEvents = this.parseEvent(rawEvent);
                events.push(...parsedEvents);
                
            } catch (error) {
                if (this.verbose) {
                    console.warn(`Warning: Failed to parse line ${lineNumber}: ${error.message}`);
                }
                // Continue processing other events
            }
        }

        return events;
    }

    /**
     * Parse single event and return array of normalized events
     * (some events generate multiple archive events)
     */
    parseEvent(rawEvent) {
        const events = [];
        
        switch (rawEvent.type) {
            case 'session':
                events.push(this.parseSessionEvent(rawEvent));
                break;
            
            case 'model_change':
                events.push(this.parseModelChangeEvent(rawEvent));
                break;
            
            case 'thinking_level_change':
                events.push(this.parseThinkingLevelEvent(rawEvent));
                break;
            
            case 'custom':
                events.push(this.parseCustomEvent(rawEvent));
                break;
            
            case 'message':
                events.push(...this.parseMessageEvent(rawEvent));
                break;
            
            default:
                if (this.verbose) {
                    console.warn(`Unknown event type: ${rawEvent.type}`);
                }
        }
        
        return events;
    }

    /**
     * Parse session initialization event
     */
    parseSessionEvent(raw) {
        return {
            event_id: raw.id,
            parent_event_id: null,
            session_id: raw.id, // Session ID is the event ID
            event_type: 'session',
            event_subtype: null,
            timestamp: new Date(raw.timestamp).getTime(),
            content_json: JSON.stringify({
                version: raw.version,
                cwd: raw.cwd
            }),
            role: null,
            tool_name: null,
            model_provider: null,
            model_id: null,
            is_error: 0
        };
    }

    /**
     * Parse model change event
     */
    parseModelChangeEvent(raw) {
        return {
            event_id: raw.id,
            parent_event_id: raw.parentId || null,
            session_id: null, // Will be filled by scanner
            event_type: 'model_change',
            event_subtype: null,
            timestamp: new Date(raw.timestamp).getTime(),
            content_json: JSON.stringify({
                provider: raw.provider,
                modelId: raw.modelId
            }),
            role: null,
            tool_name: null,
            model_provider: raw.provider,
            model_id: raw.modelId,
            is_error: 0
        };
    }

    /**
     * Parse thinking level change event
     */
    parseThinkingLevelEvent(raw) {
        return {
            event_id: raw.id,
            parent_event_id: raw.parentId || null,
            session_id: null,
            event_type: 'thinking_level_change',
            event_subtype: null,
            timestamp: new Date(raw.timestamp).getTime(),
            content_json: JSON.stringify({
                thinkingLevel: raw.thinkingLevel
            }),
            role: null,
            tool_name: null,
            model_provider: null,
            model_id: null,
            is_error: 0
        };
    }

    /**
     * Parse custom event
     */
    parseCustomEvent(raw) {
        return {
            event_id: raw.id,
            parent_event_id: raw.parentId || null,
            session_id: null,
            event_type: 'custom',
            event_subtype: raw.customType || null,
            timestamp: new Date(raw.timestamp).getTime(),
            content_json: JSON.stringify({
                customType: raw.customType,
                data: raw.data
            }),
            role: null,
            tool_name: null,
            model_provider: null,
            model_id: null,
            is_error: 0
        };
    }

    /**
     * Parse message event - can generate multiple events
     * Returns array: [main_message, tool_calls..., thinking_block, usage_stats]
     */
    parseMessageEvent(raw) {
        const events = [];
        const msg = raw.message;
        const baseTimestamp = new Date(raw.timestamp).getTime();

        // Determine if this is a tool result message
        const isToolResult = msg.role === 'toolResult';

        // Main message event
        const mainEvent = {
            event_id: raw.id,
            parent_event_id: raw.parentId || null,
            session_id: null,
            event_type: isToolResult ? 'tool_result' : 'message',
            event_subtype: null,
            timestamp: baseTimestamp,
            content_json: JSON.stringify(msg),
            role: msg.role,
            tool_name: isToolResult ? msg.toolName : null,
            model_provider: msg.provider || null,
            model_id: msg.model || null,
            is_error: isToolResult ? (msg.isError ? 1 : 0) : 0
        };
        events.push(mainEvent);

        // Extract tool calls (from assistant messages)
        if (msg.role === 'assistant' && msg.content) {
            for (const block of msg.content) {
                if (block.type === 'toolCall' || block.type === 'toolUse') {
                    events.push({
                        event_id: `${raw.id}_tool_${block.id}`,
                        parent_event_id: raw.id,
                        session_id: null,
                        event_type: 'tool_call',
                        event_subtype: null,
                        timestamp: baseTimestamp,
                        content_json: JSON.stringify({
                            id: block.id,
                            name: block.name,
                            arguments: block.arguments || block.input
                        }),
                        role: null,
                        tool_name: block.name,
                        model_provider: null,
                        model_id: null,
                        is_error: 0
                    });
                }

                // Extract thinking blocks
                if (block.type === 'thinking') {
                    const thinkingContent = block.thinking || '';
                    const thinkingSize = Buffer.byteLength(thinkingContent, 'utf8');
                    
                    events.push({
                        event_id: `${raw.id}_thinking`,
                        parent_event_id: raw.id,
                        session_id: null,
                        event_type: 'thinking_block',
                        event_subtype: null,
                        timestamp: baseTimestamp,
                        content_json: JSON.stringify({
                            type: 'thinking',
                            has_signature: !!block.thinkingSignature,
                            size_bytes: thinkingSize
                        }),
                        role: null,
                        tool_name: null,
                        model_provider: null,
                        model_id: null,
                        is_error: 0,
                        // Special fields for thinking_blocks table
                        _thinking_content: thinkingContent,
                        _thinking_signature: block.thinkingSignature || null,
                        _content_size: thinkingSize
                    });
                }
            }
        }

        // Extract usage stats (from assistant messages with usage data)
        if (msg.role === 'assistant' && msg.usage) {
            const usage = msg.usage;
            const cost = usage.cost || {};
            
            events.push({
                event_id: `${raw.id}_usage`,
                parent_event_id: raw.id,
                session_id: null,
                event_type: 'usage_stats',
                event_subtype: null,
                timestamp: baseTimestamp,
                content_json: JSON.stringify(usage),
                role: null,
                tool_name: null,
                model_provider: msg.provider || null,
                model_id: msg.model || null,
                is_error: 0,
                // Special fields for usage_stats table
                _usage: {
                    input_tokens: usage.input || 0,
                    output_tokens: usage.output || 0,
                    cache_read_tokens: usage.cacheRead || 0,
                    cache_write_tokens: usage.cacheWrite || 0,
                    total_tokens: usage.totalTokens || 0,
                    input_cost: cost.input || 0,
                    output_cost: cost.output || 0,
                    cache_read_cost: cost.cacheRead || 0,
                    cache_write_cost: cost.cacheWrite || 0,
                    total_cost: cost.total || 0
                }
            });
        }

        return events;
    }

    /**
     * Get session metadata from parsed events
     * @param {Array<object>} events - Parsed events array
     * @returns {object} Session metadata
     */
    extractSessionMetadata(events) {
        if (events.length === 0) {
            return null;
        }

        // Find session event
        const sessionEvent = events.find(e => e.event_type === 'session');
        if (!sessionEvent) {
            return null;
        }

        const sessionId = sessionEvent.session_id;
        const timestamps = events.map(e => e.timestamp).filter(t => t);
        
        return {
            session_id: sessionId,
            started_at: Math.min(...timestamps),
            ended_at: Math.max(...timestamps),
            event_count: events.length,
            has_thinking: events.some(e => e.event_type === 'thinking_block'),
            has_usage: events.some(e => e.event_type === 'usage_stats'),
            tool_calls: events.filter(e => e.event_type === 'tool_call').length,
            errors: events.filter(e => e.is_error).length
        };
    }
}

module.exports = { EventParser };
