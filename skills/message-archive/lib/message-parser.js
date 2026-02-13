/**
 * Message Parser
 * 
 * Parses OpenClaw session JSONL files and normalizes messages
 * into the archive database format.
 * 
 * @module message-parser
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

class SessionParser {
    /**
     * Initialize parser with session file path
     * @param {string} sessionFilePath - Path to session JSONL file
     */
    constructor(sessionFilePath) {
        this.sessionFile = sessionFilePath;
        this.sessionId = null;
        this.sessionKey = this.extractSessionKey(sessionFilePath);
    }

    /**
     * Extract session key from file path
     * @param {string} filePath - Session file path
     * @returns {string} Session key (e.g., agent:main:main)
     */
    extractSessionKey(filePath) {
        // Try to extract from filename pattern like: .../sessions/agent_main_main_20260213.jsonl
        const basename = path.basename(filePath, '.jsonl');
        const parts = basename.split('_');
        
        if (parts.length >= 3) {
            return `${parts[0]}:${parts[1]}:${parts[2]}`;
        }
        
        // Handle UUID filenames: extract from directory structure
        // Pattern: ~/.openclaw/agents/main/sessions/UUID.jsonl → agents:main
        // Pattern: ~/.openclaw/agents/main/subagent/sessions/UUID.jsonl → agents:main:subagent
        const pathParts = filePath.split(path.sep);
        const sessionsIndex = pathParts.findIndex(p => p === 'sessions');
        
        if (sessionsIndex !== -1 && sessionsIndex > 0) {
            // Find .openclaw directory
            const openclawIndex = pathParts.findIndex(p => p === '.openclaw');
            
            if (openclawIndex !== -1 && openclawIndex < sessionsIndex) {
                // Extract path segments between .openclaw and sessions
                const sessionPath = pathParts.slice(openclawIndex + 1, sessionsIndex);
                if (sessionPath.length > 0) {
                    return sessionPath.join(':');
                }
            }
        }
        
        return 'unknown:session';
    }

    /**
     * Extract session ID from first line of session file
     * @returns {Promise<string|null>} Session ID or null
     */
    async extractSessionId() {
        if (!fs.existsSync(this.sessionFile)) {
            return null;
        }

        const fileStream = fs.createReadStream(this.sessionFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        // Read only the first line
        for await (const line of rl) {
            if (!line.trim()) continue;
            
            try {
                const entry = JSON.parse(line);
                if (entry.type === 'session' && entry.id) {
                    rl.close();
                    fileStream.destroy();
                    return entry.id;
                }
            } catch (err) {
                // Not a valid JSON line, continue
            }
            
            // Only check first non-empty line
            rl.close();
            fileStream.destroy();
            break;
        }

        return null;
    }

    /**
     * Parse messages from session file
     * @param {number} sinceTimestamp - Only parse messages after this timestamp (0 = all)
     * @returns {Promise<Array<object>>} Parsed messages
     */
    async parseMessages(sinceTimestamp = 0) {
        if (!fs.existsSync(this.sessionFile)) {
            return [];
        }

        // Extract session ID from first line if not already extracted
        if (!this.sessionId) {
            this.sessionId = await this.extractSessionId();
        }

        const messages = [];
        const fileStream = fs.createReadStream(this.sessionFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (!line.trim()) continue;

            try {
                const entry = JSON.parse(line);
                
                // Parse different entry types
                if (entry.type === 'message' || entry.role) {
                    const parsed = this.parseMessageEntry(entry);
                    if (parsed && parsed.timestamp >= sinceTimestamp) {
                        messages.push(parsed);
                    }
                }
            } catch (err) {
                console.error(`Failed to parse line in ${this.sessionFile}:`, err.message);
            }
        }

        return messages;
    }

    /**
     * Parse a single message entry
     * @param {object} entry - JSONL entry
     * @returns {object|null} Normalized message
     */
    parseMessageEntry(entry) {
        // Detect entry format and normalize
        
        // Format 1: Wrapped format { type: 'message', message: { ... } }
        // Check this FIRST since session files use this format
        if (entry.type === 'message' && entry.message) {
            return this.normalizeMessage(entry.message);
        }

        // Format 2: Direct message format { role: '...', content: '...' }
        if (entry.role) {
            return this.normalizeMessage(entry);
        }

        return null;
    }

    /**
     * Normalize message to archive format
     * @param {object} rawMessage - Raw message object
     * @returns {object} Normalized message
     */
    normalizeMessage(rawMessage) {
        // Extract core fields
        let timestamp = rawMessage.timestamp || rawMessage.ts || Date.now();
        // Handle ISO date strings
        if (typeof timestamp === 'string') {
            timestamp = new Date(timestamp).getTime();
        }
        const role = rawMessage.role || rawMessage.sender_role || 'user';
        const content = rawMessage.content || rawMessage.text || rawMessage.message || '';
        
        // Determine direction based on role
        const direction = (role === 'assistant' || role === 'bot') ? 'outbound' : 'inbound';
        
        // Extract sender info
        const senderId = rawMessage.sender_id || rawMessage.from?.id || rawMessage.userId;
        const senderName = rawMessage.sender_name || rawMessage.from?.name || rawMessage.userName;
        
        // Extract channel info
        const channel = rawMessage.channel || rawMessage.platform || 'openclaw';
        
        // Generate message ID
        const messageId = rawMessage.message_id || rawMessage.id || 
                         this.generateMessageId(timestamp, senderId, content);
        
        // Extract content type
        const contentType = this.detectContentType(rawMessage);
        
        // Build normalized message
        return {
            message_id: messageId,
            internal_id: rawMessage.internal_id || null,
            session_key: this.sessionKey,
            session_id: this.sessionId || rawMessage.session_id || null,
            
            direction,
            sender_id: senderId ? String(senderId) : null,
            sender_name: senderName || null,
            recipient_id: rawMessage.recipient_id || null,
            recipient_name: rawMessage.recipient_name || null,
            
            channel,
            device_id: rawMessage.device_id || rawMessage.node || null,
            
            content_type: contentType,
            content_text: this.extractTextContent(content),
            content_json: JSON.stringify(rawMessage),
            
            reply_to_id: rawMessage.reply_to || rawMessage.replyTo || null,
            thread_id: rawMessage.thread_id || rawMessage.threadId || null,
            
            timestamp,
            edited_at: rawMessage.edited_at || rawMessage.editedAt || null,
            deleted_at: null,
            created_at: Date.now()
        };
    }

    /**
     * Detect content type from message
     * @param {object} message - Raw message
     * @returns {string} Content type
     */
    detectContentType(message) {
        if (message.content_type) return message.content_type;
        if (message.photo || message.image) return 'image';
        if (message.video) return 'video';
        if (message.audio || message.voice) return 'audio';
        if (message.document || message.file) return 'document';
        if (message.sticker) return 'sticker';
        if (message.location) return 'location';
        return 'text';
    }

    /**
     * Extract text content from various formats
     * @param {*} content - Content field
     * @returns {string} Text content
     */
    extractTextContent(content) {
        if (typeof content === 'string') {
            return content;
        }

        if (Array.isArray(content)) {
            // Handle array format (e.g., Claude API format)
            return content
                .map(block => {
                    if (typeof block === 'string') return block;
                    if (block.type === 'text') return block.text;
                    if (block.text) return block.text;
                    return '';
                })
                .join('\n');
        }

        if (typeof content === 'object' && content !== null) {
            // Handle object format
            return content.text || content.content || JSON.stringify(content);
        }

        return '';
    }

    /**
     * Generate deterministic message ID
     * @param {number} timestamp - Message timestamp
     * @param {string} senderId - Sender ID
     * @param {*} content - Message content (string or array)
     * @returns {string} Message ID
     */
    generateMessageId(timestamp, senderId, content) {
        const crypto = require('crypto');
        // Extract text from content (handle both string and array formats)
        const textContent = this.extractTextContent(content);
        const payload = `${timestamp}|${senderId || 'unknown'}|${textContent.substring(0, 100)}`;
        const hash = crypto.createHash('sha256').update(payload).digest('hex');
        return `generated_${hash.substring(0, 16)}`;
    }

    /**
     * Extract attachments from message
     * @param {object} message - Raw message
     * @returns {Array<object>} Attachments
     */
    extractAttachments(message) {
        const attachments = [];

        // Handle various attachment formats
        if (message.attachments && Array.isArray(message.attachments)) {
            attachments.push(...message.attachments);
        }

        if (message.photo) {
            attachments.push({
                type: 'image',
                file_path: message.photo.file_path,
                file_url: message.photo.file_url
            });
        }

        if (message.video) {
            attachments.push({
                type: 'video',
                file_path: message.video.file_path,
                file_url: message.video.file_url
            });
        }

        if (message.audio || message.voice) {
            attachments.push({
                type: 'audio',
                file_path: (message.audio || message.voice).file_path,
                file_url: (message.audio || message.voice).file_url
            });
        }

        if (message.document) {
            attachments.push({
                type: 'document',
                file_path: message.document.file_path,
                file_url: message.document.file_url,
                file_name: message.document.file_name
            });
        }

        return attachments;
    }
}

/**
 * Find all session files in OpenClaw directories
 * @param {string} baseDir - Base directory to search (default: ~/.openclaw)
 * @returns {Promise<Array<string>>} Array of session file paths
 */
async function findSessionFiles(baseDir = null) {
    const searchDir = baseDir || path.join(process.env.HOME, '.openclaw');
    
    if (!fs.existsSync(searchDir)) {
        return [];
    }

    const sessionFiles = [];

    /**
     * Recursively search for .jsonl files
     */
    function walkDir(dir) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    // Skip node_modules, .git, etc.
                    if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                        walkDir(fullPath);
                    }
                } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                    // Check if it's in a sessions directory
                    if (fullPath.includes('/sessions/')) {
                        sessionFiles.push(fullPath);
                    }
                }
            }
        } catch (err) {
            // Skip directories we can't read
        }
    }

    walkDir(searchDir);
    return sessionFiles;
}

module.exports = { SessionParser, findSessionFiles };
