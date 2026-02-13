---
name: message-archive
description: Complete conversation history archive with backfill capability. Captures all messages (sent + received) in a queryable SQLite database for context recovery, search, and memory synthesis.
version: 1.0.0
author: OpenClaw
---

# Message Archive Skill

Comprehensive message archiving system that preserves your complete conversation history in a local SQLite database with full-text search, backfill from exported chats, and context reconstruction.

## Features

✨ **Complete History**: Every message (inbound + outbound) with full metadata  
🔍 **Full-Text Search**: Find any conversation by content  
📥 **Backfill Support**: Import historical messages from Telegram, WhatsApp, Discord exports  
🔄 **Context Recovery**: Rebuild conversation context after session compaction  
📊 **Audit Trail**: Track all communications across channels  
🧠 **Memory Synthesis**: Help agent learn from past conversations  
📎 **Media Tracking**: Reference all attachments, images, documents  
😊 **Reaction History**: Preserve emoji reactions and edits  

## Quick Start

### 1. Initialize Archive

```bash
cd ~/.openclaw/workspace/skills/message-archive
npm install
node tools/archive-init.js
```

Creates database at `~/.openclaw/archive/messages.db`

### 2. Scan Existing Messages

```bash
node tools/archive-scan.js
```

This scans all OpenClaw session files and archives messages.

### 3. Import Historical Data (Optional)

**From Telegram Export:**
```bash
node tools/archive-backfill.js telegram-export --file ~/Downloads/ChatExport_2026/result.json
```

**From WhatsApp Export:**
```bash
node tools/archive-backfill.js whatsapp-export --file ~/Downloads/WhatsApp_Chat.txt
```

**From Discord Export:**
```bash
node tools/archive-backfill.js discord-export --file ~/Downloads/channel_123456.json
```

**Bulk Import All Sessions:**
```bash
node tools/archive-backfill.js sessions-bulk --dir ~/.openclaw/agents/main/sessions
```

## Querying Messages

### Search by Text

```bash
node tools/archive-query.js --search "kubernetes deployment" --limit 20
```

### Query by Time Range

```bash
node tools/archive-query.js \
    --since "2026-02-01" \
    --until "2026-02-13" \
    --session agent:main:main
```

### Filter by Channel

```bash
node tools/archive-query.js --channel telegram --limit 50 --format markdown
```

### Export Context for LLM

```bash
node tools/archive-query.js \
    --export-context \
    --since "2026-02-13 10:00" \
    --until "2026-02-13 12:00" \
    --format markdown > context.md
```

### View Statistics

```bash
node tools/archive-query.js --stats
```

## Automatic Archiving

Add to your `HEARTBEAT.md`:

```markdown
## Message Archive Scan (every 5 minutes)

Check last scan time:
- Read checkpoint from database
- If >5 min since last scan, run: `node ~/.openclaw/workspace/skills/message-archive/tools/archive-scan.js`
```

Or manually trigger:
```bash
node tools/archive-scan.js --force
```

## Export Formats

The query tool supports multiple output formats:

- **JSON** (default): Machine-readable format
- **Markdown**: Human-readable with formatting
- **Text**: Plain text transcript
- **CSV**: Spreadsheet-compatible

Example:
```bash
node tools/archive-query.js --search "docker" --format markdown > docker-discussions.md
```

## Database Location

```
~/.openclaw/archive/messages.db
```

**💾 Backup Recommended**: This database grows over time. Regular backups advisable.

```bash
# Backup
cp ~/.openclaw/archive/messages.db ~/backups/messages-$(date +%Y%m%d).db

# Restore
cp ~/backups/messages-20260213.db ~/.openclaw/archive/messages.db
```

## Programmatic API

Use from your code:

```javascript
const { MessageArchive } = require('./skills/message-archive/lib/archive-db');
const archive = new MessageArchive();

// Get recent context
const context = await archive.getConversationContext(
    Date.now() - 3600000,  // 1 hour ago
    Date.now(),
    'agent:main:main'
);

// Search messages
const results = await archive.queryMessages({
    contentMatch: 'kubernetes',
    channel: 'telegram',
    limit: 50
});

// Full-text search
const searchResults = archive.search('deployment strategy', 20);

// Get stats
const stats = archive.getStats();
console.log(`Total messages: ${stats.totalMessages}`);

archive.close();
```

## Exporting Chat Files

### Telegram

1. Open Telegram Desktop
2. Go to the chat you want to export
3. Click the three dots (⋮) → Export chat history
4. Select "Machine-readable JSON" format
5. Export and use the `result.json` file

### WhatsApp

1. Open WhatsApp on mobile
2. Go to the chat → Menu → More → Export chat
3. Choose "Without Media" or "Include Media"
4. Save the `.txt` file
5. Transfer to your computer

### Discord

Use [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter):

```bash
# Install
dotnet tool install -g DiscordChatExporter.Cli

# Export channel
DiscordChatExporter.Cli export -c CHANNEL_ID -t YOUR_TOKEN -f Json
```

## Privacy & Security

🔒 **Local Only**: Database stored on your machine  
🚫 **No External Sync**: Messages never leave your system  
🗑️ **Soft Deletes**: Deleted messages marked, not removed (can be purged)  
🔐 **Encryption**: Use disk encryption for additional security  

## Maintenance

### Check Database Size

```bash
du -h ~/.openclaw/archive/messages.db
```

### Optimize Database

```bash
sqlite3 ~/.openclaw/archive/messages.db "VACUUM; ANALYZE;"
```

### View Backfill History

```bash
node tools/archive-backfill.js history
```

### Purge Old Messages

```javascript
// Delete messages older than 1 year (custom script)
const archive = new MessageArchive();
const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);

archive.db.prepare('DELETE FROM messages WHERE timestamp < ?').run(oneYearAgo);
archive.db.prepare('VACUUM').run();
```

## Troubleshooting

### Archive not updating?

- Check `archive_state` table for last scan timestamp
- Verify heartbeat is running
- Manually run `node tools/archive-scan.js` to test
- Check session file paths with `--dir` option

### Query performance slow?

- Run `VACUUM; ANALYZE;` on database
- Check query filters (avoid full table scans)
- Limit full-text searches with time ranges

### Missing messages?

- Archive started after message was sent
- Session file rotated before scan (rare)
- Check backfill history: `node tools/archive-backfill.js history`
- Verify session file format with parser tests

### Import errors?

- Telegram: Ensure JSON format (not HTML)
- WhatsApp: Check date format matches parser regex
- Discord: Use DiscordChatExporter JSON format
- Run with Node.js 16+ for better error messages

## Use Cases

### Post-Compaction Recovery

When session gets compacted and agent loses context:

```javascript
const lostContext = await archive.getConversationContext(
    sessionStartTime,
    compactionTimestamp,
    'agent:main:main'
);
// Inject summary into next prompt
```

### Conversation Replay

User asks: "What did we discuss about Docker yesterday?"

```bash
node tools/archive-query.js \
    --search "Docker" \
    --since "2026-02-12" \
    --until "2026-02-13" \
    --format markdown
```

### Memory Synthesis

Monthly review for MEMORY.md updates:

```javascript
const monthlyMessages = await archive.queryMessages({
    sessionKey: 'agent:main:main',
    startTime: monthAgo,
    endTime: now,
    limit: 10000
});

// Analyze patterns, extract insights, update MEMORY.md
```

### Audit & Compliance

Track all outbound messages for a specific period:

```bash
node tools/archive-query.js \
    --since "2026-02-01" \
    --until "2026-02-28" \
    --format csv > february-messages.csv
```

## Advanced: Custom Queries

Direct SQL access for complex queries:

```javascript
const { MessageArchive } = require('./skills/message-archive/lib/archive-db');
const archive = new MessageArchive();

// Most active senders
const topSenders = archive.db.prepare(`
    SELECT sender_name, COUNT(*) as count 
    FROM messages 
    WHERE deleted_at IS NULL
    GROUP BY sender_name 
    ORDER BY count DESC 
    LIMIT 10
`).all();

// Messages per channel per day
const dailyStats = archive.db.prepare(`
    SELECT 
        channel,
        DATE(timestamp/1000, 'unixepoch') as date,
        COUNT(*) as count
    FROM messages
    WHERE deleted_at IS NULL
    GROUP BY channel, date
    ORDER BY date DESC
`).all();

archive.close();
```

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- Database operations (insert, query, deduplication)
- Message parsing (JSONL session files)
- Backfill parsers (Telegram, WhatsApp, Discord)
- Full-text search
- Batch operations

## Support

For issues or questions:
1. Check this documentation
2. Review test files for usage examples
3. Examine the design doc: `workspace/message-archive-design.md`
4. Ask your agent to help debug!

## Version History

### v1.0.0 (2026-02-13)
- ✨ Initial release
- 📥 Backfill support for Telegram, WhatsApp, Discord
- 🔍 Full-text search with FTS5
- 🔄 Session JSONL parsing
- 📊 Query interface with multiple formats
- ✅ Comprehensive test suite
