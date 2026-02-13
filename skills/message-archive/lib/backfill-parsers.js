/**
 * Backfill Parsers
 * 
 * Parse exported chat files from various platforms:
 * - Telegram (JSON exports from Telegram Desktop)
 * - WhatsApp (TXT exports)
 * - Discord (JSON from DiscordChatExporter)
 * 
 * @module backfill-parsers
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Parse Telegram JSON export
 */
class TelegramExportParser {
    /**
     * Parse Telegram Desktop export file
     * @param {string} filePath - Path to result.json
     * @returns {Promise<Array<object>>} Normalized messages
     */
    async parseExport(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (!data.messages || !Array.isArray(data.messages)) {
            throw new Error('Invalid Telegram export format: missing messages array');
        }

        const chatName = data.name || 'Unknown Chat';
        const chatId = data.id || 'unknown';

        return data.messages.map((msg, idx) => this.normalizeMessage(msg, chatName, chatId));
    }

    normalizeMessage(msg, chatName, chatId) {
        // Extract text from various formats
        let contentText = '';
        
        if (typeof msg.text === 'string') {
            contentText = msg.text;
        } else if (Array.isArray(msg.text)) {
            contentText = msg.text
                .map(item => (typeof item === 'string' ? item : item.text || ''))
                .join('');
        } else if (msg.text && msg.text.text) {
            contentText = msg.text.text;
        }

        // Determine content type
        let contentType = 'text';
        if (msg.photo) contentType = 'image';
        else if (msg.video || msg.video_file) contentType = 'video';
        else if (msg.voice_message || msg.audio_file) contentType = 'audio';
        else if (msg.file) contentType = 'document';
        else if (msg.sticker_emoji) contentType = 'sticker';
        else if (msg.location_information) contentType = 'location';

        // Parse timestamp
        const timestamp = new Date(msg.date).getTime();

        return {
            message_id: `telegram_export_${msg.id || timestamp}`,
            session_key: `imported:telegram:${chatId}`,
            
            direction: msg.from === 'You' || msg.from_id === 'user_self' ? 'outbound' : 'inbound',
            sender_id: msg.from_id || null,
            sender_name: msg.from || 'Unknown',
            
            channel: 'telegram',
            
            content_type: contentType,
            content_text: contentText,
            content_json: JSON.stringify(msg),
            
            reply_to_id: msg.reply_to_message_id ? `telegram_export_${msg.reply_to_message_id}` : null,
            
            timestamp,
            created_at: Date.now()
        };
    }
}

/**
 * Parse WhatsApp TXT export
 */
class WhatsAppExportParser {
    /**
     * Parse WhatsApp chat export (TXT format)
     * @param {string} filePath - Path to chat.txt
     * @returns {Promise<Array<object>>} Normalized messages
     */
    async parseExport(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        const messages = [];
        let currentMessage = null;

        for (const line of lines) {
            const parsed = this.parseLine(line);

            if (parsed) {
                // New message
                if (currentMessage) {
                    messages.push(this.normalizeMessage(currentMessage));
                }
                currentMessage = parsed;
            } else if (currentMessage && line.trim()) {
                // Continuation of previous message
                currentMessage.text += '\n' + line;
            }
        }

        // Add last message
        if (currentMessage) {
            messages.push(this.normalizeMessage(currentMessage));
        }

        return messages;
    }

    parseLine(line) {
        // WhatsApp format: "12/31/23, 10:30 PM - John Doe: Message text"
        // Alternative: "[31/12/23, 22:30:45] John Doe: Message text"
        
        // Try format 1: MM/DD/YY, HH:MM AM/PM
        let regex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*-\s*([^:]+):\s*(.*)$/i;
        let match = line.match(regex);

        if (match) {
            return {
                date: match[1],
                time: match[2],
                sender: match[3].trim(),
                text: match[4]
            };
        }

        // Try format 2: [DD/MM/YY, HH:MM:SS]
        regex = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}:\d{2})\]\s*([^:]+):\s*(.*)$/;
        match = line.match(regex);

        if (match) {
            return {
                date: match[1],
                time: match[2],
                sender: match[3].trim(),
                text: match[4]
            };
        }

        return null;
    }

    normalizeMessage(parsed) {
        // Parse timestamp
        const dateTimeStr = `${parsed.date} ${parsed.time}`;
        let timestamp;
        
        try {
            timestamp = new Date(dateTimeStr).getTime();
        } catch (err) {
            // Fallback to current time if parse fails
            timestamp = Date.now();
        }

        // Detect content type
        let contentType = 'text';
        let contentText = parsed.text;

        if (parsed.text.includes('<Media omitted>') || parsed.text.includes('image omitted')) {
            contentType = 'image';
            contentText = '[Image]';
        } else if (parsed.text.includes('video omitted')) {
            contentType = 'video';
            contentText = '[Video]';
        } else if (parsed.text.includes('audio omitted') || parsed.text.includes('voice message')) {
            contentType = 'audio';
            contentText = '[Audio]';
        } else if (parsed.text.includes('document omitted') || parsed.text.includes('attached:')) {
            contentType = 'document';
            contentText = '[Document]';
        } else if (parsed.text.includes('location:')) {
            contentType = 'location';
        } else if (parsed.text.includes('sticker omitted')) {
            contentType = 'sticker';
            contentText = '[Sticker]';
        }

        return {
            message_id: `whatsapp_export_${timestamp}_${parsed.sender.replace(/\s+/g, '_')}`,
            session_key: 'imported:whatsapp:export',
            
            direction: parsed.sender === 'You' ? 'outbound' : 'inbound',
            sender_name: parsed.sender,
            
            channel: 'whatsapp',
            
            content_type: contentType,
            content_text: contentText,
            content_json: JSON.stringify(parsed),
            
            timestamp,
            created_at: Date.now()
        };
    }
}

/**
 * Parse Discord JSON export (from DiscordChatExporter)
 */
class DiscordExportParser {
    /**
     * Parse Discord export JSON
     * @param {string} filePath - Path to channel export JSON
     * @returns {Promise<Array<object>>} Normalized messages
     */
    async parseExport(filePath) {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);

        if (!data.messages || !Array.isArray(data.messages)) {
            throw new Error('Invalid Discord export format: missing messages array');
        }

        const channelName = data.channel?.name || data.guild?.name || 'Unknown Channel';
        const channelId = data.channel?.id || 'unknown';

        return data.messages.map(msg => this.normalizeMessage(msg, channelName, channelId));
    }

    normalizeMessage(msg, channelName, channelId) {
        // Parse timestamp
        const timestamp = new Date(msg.timestamp || msg.timestampEdited).getTime();

        // Determine content type
        let contentType = 'text';
        if (msg.attachments && msg.attachments.length > 0) {
            const attach = msg.attachments[0];
            if (attach.contentType?.startsWith('image/')) contentType = 'image';
            else if (attach.contentType?.startsWith('video/')) contentType = 'video';
            else if (attach.contentType?.startsWith('audio/')) contentType = 'audio';
            else contentType = 'document';
        }

        return {
            message_id: `discord_export_${msg.id}`,
            session_key: `imported:discord:${channelId}`,
            
            direction: msg.author?.isBot ? 'outbound' : 'inbound',
            sender_id: msg.author?.id || null,
            sender_name: msg.author?.name || msg.author?.nickname || 'Unknown',
            
            channel: 'discord',
            
            content_type: contentType,
            content_text: msg.content || '',
            content_json: JSON.stringify(msg),
            
            reply_to_id: msg.reference?.messageId ? `discord_export_${msg.reference.messageId}` : null,
            
            timestamp,
            edited_at: msg.timestampEdited ? new Date(msg.timestampEdited).getTime() : null,
            created_at: Date.now()
        };
    }
}

module.exports = {
    TelegramExportParser,
    WhatsAppExportParser,
    DiscordExportParser
};
