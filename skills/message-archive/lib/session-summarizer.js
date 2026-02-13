/**
 * Session Summarizer - Generate AI summaries for sessions
 * 
 * Uses Haiku model to generate concise title + summary for sessions.
 * - Title: 5-10 words describing what the session accomplished
 * - Summary: 2-3 sentences overview of the work done
 * 
 * For main sessions: Returns static "Main Session" / "main"
 * For others: Uses first few + last messages as context
 * 
 * @module session-summarizer
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

class SessionSummarizer {
    constructor(options = {}) {
        this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
        this.model = options.model || 'claude-3-5-haiku-20241022';
        this.verbose = options.verbose || false;
        this.dryRun = options.dryRun || false;
        this.fallbackOnly = options.fallbackOnly || !this.apiKey;
        
        // Only create client if API key is available
        if (this.apiKey) {
            this.client = new Anthropic({ apiKey: this.apiKey });
        } else if (this.verbose) {
            console.warn('⚠️ ANTHROPIC_API_KEY not set - using fallback summaries only');
        }
    }

    /**
     * Generate title and summary for a session
     * @param {object} sessionData - Session metadata
     * @param {Array<object>} events - Session events (first few + last)
     * @returns {Promise<{title: string, summary: string}>}
     */
    async summarize(sessionData, events) {
        // For main sessions, return static content
        if (sessionData.type === 'main') {
            return {
                title: 'Main Session',
                summary: 'main'
            };
        }

        // Use fallback if no API key available
        if (!this.apiKey || this.fallbackOnly) {
            if (this.verbose) {
                console.log(`Using fallback summary for session ${sessionData.id}`);
            }
            return this.generateFallback(sessionData, events);
        }

        // Extract context from events
        const context = this.extractContext(events, sessionData);
        
        if (this.verbose) {
            console.log(`Generating summary for session ${sessionData.id} (${sessionData.type})`);
            console.log(`Context length: ${context.length} chars`);
        }

        // Generate summary using LLM
        const prompt = this.buildPrompt(context, sessionData);
        
        try {
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 300,
                temperature: 0.3,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            });

            const result = this.parseResponse(response.content[0].text);
            
            if (this.verbose) {
                console.log(`Generated title: "${result.title}"`);
                console.log(`Generated summary: "${result.summary}"`);
                console.log(`Tokens used: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
            }

            return result;
            
        } catch (error) {
            console.error(`Failed to generate summary: ${error.message}`);
            // Return fallback
            return this.generateFallback(sessionData, events);
        }
    }

    /**
     * Extract relevant context from events
     * Keep first 3-5 messages and last 1-2 messages
     */
    extractContext(events, sessionData) {
        const messages = events.filter(e => 
            e.event_type === 'message' && 
            e.role && 
            ['user', 'assistant'].includes(e.role)
        );

        if (messages.length === 0) {
            return 'No messages in session.';
        }

        const firstMessages = messages.slice(0, 5);
        const lastMessages = messages.slice(-2);

        let context = '';
        
        // Add session metadata
        context += `Session Type: ${sessionData.type}\n`;
        if (sessionData.label) {
            context += `Label: ${sessionData.label}\n`;
        }
        context += `\nFirst messages:\n`;
        
        for (const msg of firstMessages) {
            const content = this.extractMessageContent(msg);
            context += `[${msg.role}] ${content}\n`;
        }

        if (messages.length > 7 && lastMessages.length > 0) {
            context += `\n... (${messages.length - 7} messages omitted) ...\n\n`;
            context += `Last messages:\n`;
            for (const msg of lastMessages) {
                const content = this.extractMessageContent(msg);
                context += `[${msg.role}] ${content}\n`;
            }
        }

        return context;
    }

    /**
     * Extract text content from message event
     */
    extractMessageContent(event) {
        try {
            const content = JSON.parse(event.content_json);
            
            if (content.message && content.message.content) {
                // Extract text from message content array
                const textBlocks = content.message.content
                    .filter(block => block.type === 'text')
                    .map(block => block.text);
                
                const text = textBlocks.join(' ');
                
                // Truncate long messages
                if (text.length > 300) {
                    return text.substring(0, 297) + '...';
                }
                
                return text;
            }
            
            return '[No text content]';
        } catch (error) {
            return '[Parse error]';
        }
    }

    /**
     * Build prompt for LLM
     */
    buildPrompt(context, sessionData) {
        return `You are analyzing a session transcript to generate a concise summary.

Session context:
${context}

Generate:
1. A **title** (5-10 words max) - describe what this session accomplished
2. A **summary** (2-3 sentences max) - overview of the work done

Format your response EXACTLY as:
TITLE: <your title here>
SUMMARY: <your summary here>

Be specific and factual. Focus on what was done, not how it was done.`;
    }

    /**
     * Parse LLM response
     */
    parseResponse(text) {
        const titleMatch = text.match(/TITLE:\s*(.+?)(?:\n|$)/i);
        const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?:\n\n|$)/is);

        let title = titleMatch ? titleMatch[1].trim() : 'Session';
        let summary = summaryMatch ? summaryMatch[1].trim() : 'No summary available.';

        // Clean up
        title = title.replace(/^["']|["']$/g, ''); // Remove quotes
        summary = summary.replace(/^["']|["']$/g, '');

        // Enforce length limits
        if (title.split(' ').length > 12) {
            title = title.split(' ').slice(0, 12).join(' ') + '...';
        }

        if (summary.split('.').length > 4) {
            summary = summary.split('.').slice(0, 4).join('.') + '.';
        }

        return { title, summary };
    }

    /**
     * Generate fallback summary when LLM fails
     */
    generateFallback(sessionData, events) {
        const messageCount = events.filter(e => e.event_type === 'message').length;
        
        let title = 'Session';
        let summary = `${sessionData.type} session`;
        
        if (sessionData.label) {
            title = sessionData.label;
            summary = `${sessionData.type} session: ${sessionData.label}`;
        } else {
            title = `${sessionData.type.charAt(0).toUpperCase() + sessionData.type.slice(1)} Session`;
            summary = `${sessionData.type} session with ${messageCount} messages`;
        }

        if (events.length > 0) {
            const duration = (sessionData.ended_at - sessionData.started_at) / 1000;
            summary += `. Duration: ${Math.round(duration)}s`;
        }

        return { title, summary };
    }

    /**
     * Batch summarize multiple sessions
     * @param {Array<{sessionData, events}>} sessions - Array of session data
     * @returns {Promise<Array<{id, title, summary}>>}
     */
    async summarizeBatch(sessions, options = {}) {
        const { concurrency = 3, delay = 500 } = options;
        const results = [];

        for (let i = 0; i < sessions.length; i += concurrency) {
            const batch = sessions.slice(i, i + concurrency);
            
            const promises = batch.map(async ({ sessionData, events }) => {
                try {
                    const summary = await this.summarize(sessionData, events);
                    return {
                        id: sessionData.id,
                        ...summary
                    };
                } catch (error) {
                    console.error(`Failed to summarize session ${sessionData.id}:`, error.message);
                    const fallback = this.generateFallback(sessionData, events);
                    return {
                        id: sessionData.id,
                        ...fallback
                    };
                }
            });

            const batchResults = await Promise.all(promises);
            results.push(...batchResults);

            // Delay between batches to avoid rate limiting
            if (i + concurrency < sessions.length && delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        return results;
    }
}

module.exports = { SessionSummarizer };
