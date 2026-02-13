# Sessions Table - Message Archive

The sessions table provides a high-level view of all OpenClaw sessions with AI-generated summaries for easy navigation and discovery.

## Features

✅ **Session Metadata Tracking**
- Session types: main, subagent, cron, isolated
- Timing information (start/end timestamps)
- Status tracking (active/completed/failed)
- Parent-child relationships for subagents

✅ **AI-Generated Summaries**
- Main sessions: Simple "Main Session" / "main" labels
- Subagents & cron: LLM-generated title (5-10 words) + summary (2-3 sentences)
- Uses Claude Haiku for cost-effective summarization

✅ **Full-Text Search**
- Search sessions by title or summary
- Find specific work quickly across all sessions

✅ **Statistics & Metrics**
- Message counts, event counts
- Session duration, token usage, costs
- Model tracking

## Schema

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,              -- Session UUID
    session_key TEXT NOT NULL,        -- e.g., agent:main:main
    type TEXT NOT NULL,               -- main/subagent/cron/isolated
    parent_id TEXT,                   -- For subagent hierarchy
    label TEXT,                       -- Optional label
    agent_id TEXT,                    -- Agent identifier
    model TEXT,                       -- Primary model used
    started_at INTEGER NOT NULL,      -- First event timestamp
    ended_at INTEGER,                 -- Last event timestamp (NULL if active)
    status TEXT NOT NULL,             -- active/completed/failed
    title TEXT NOT NULL,              -- Short description (5-10 words)
    summary TEXT NOT NULL,            -- Overview (2-3 sentences)
    message_count INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES sessions(id)
);
```

## Usage

### 1. Backfill Existing Sessions

Populate the sessions table with all existing session files:

```bash
# Dry run to see what would happen
npm run sessions-backfill -- --dry-run --limit 5

# Actually populate sessions
npm run sessions-backfill

# Force regenerate summaries for all sessions
npm run sessions-backfill -- --force

# Verbose output
npm run sessions-backfill -- --verbose
```

**Note:** Requires `ANTHROPIC_API_KEY` environment variable for AI summaries. Without it, uses fallback summaries based on metadata.

### 2. Scan for New Sessions

Include sessions in regular archive scans:

```bash
# Scan only sessions
npm run scan -- --mode sessions

# Scan everything (messages + events + sessions)
npm run scan -- --mode all

# Force rescan all sessions
npm run scan -- --mode sessions --force
```

### 3. Query Sessions

List and filter sessions:

```bash
# List all sessions
npm run query -- --sessions

# Filter by type
npm run query -- --sessions --type subagent

# Filter by status
npm run query -- --sessions --status completed

# Search sessions
npm run query -- --sessions --search "database"

# Date range
npm run query -- --sessions --since "2026-02-01" --until "2026-02-13"

# Limit results
npm run query -- --sessions --limit 10

# Export as CSV
npm run query -- --sessions --format csv > sessions.csv
```

### 4. Session Details

Get detailed information about a specific session:

```bash
# View session details + all events
npm run query -- --session-detail <session-id>

# Export as JSON
npm run query -- --session-detail <session-id> --format json
```

## API Usage

### JavaScript

```javascript
const { MessageArchive } = require('./lib/archive-db');

const archive = new MessageArchive();

// Get all sessions
const sessions = archive.querySessions({
    type: 'subagent',
    status: 'completed',
    limit: 50
});

// Get session with stats
const session = archive.getSessionWithStats('session-uuid');

// Search sessions
const results = archive.searchSessions('database setup');

// Get subagent sessions for a parent
const subagents = archive.getSubagentSessions('parent-session-id');

// Update session
archive.upsertSession({
    id: 'session-uuid',
    session_key: 'agent:main:subagent:uuid',
    type: 'subagent',
    started_at: Date.now(),
    ended_at: Date.now() + 60000,
    status: 'completed',
    title: 'Database Migration',
    summary: 'Migrated database schema to version 2.0...'
});

archive.close();
```

## Summary Generation

### Main Sessions
- **Title:** "Main Session"
- **Summary:** "main"
- No LLM call needed

### Subagents, Cron, Isolated
- **Context:** First 5 messages + last 2 messages from session
- **Model:** Claude Haiku (claude-3-5-haiku-20241022)
- **Token Usage:** ~300-500 tokens per session
- **Cost:** ~$0.0001 per session

Example generated summary:
```
Title: "Implement session summarizer with LLM integration"
Summary: "Created a session summarizer module that uses Claude Haiku to generate concise titles and summaries for OpenClaw sessions. Implemented context extraction from events and fallback generation for cases without API access."
```

### Fallback (No API Key)
When `ANTHROPIC_API_KEY` is not available:
```
Title: "Subagent Session"
Summary: "subagent session: <label> with X messages. Duration: Ys"
```

## Performance

- **Backfill 100 sessions:** ~30-60 seconds (with API)
- **Backfill 100 sessions:** ~5 seconds (fallback mode)
- **Query sessions:** <10ms (indexed)
- **Full-text search:** <50ms (FTS5 enabled)

## Maintenance

### Update Session Counts

After archiving new events:

```javascript
archive.updateSessionCounts('session-id');
```

### Mark Session Complete

When a session ends:

```javascript
archive.completeSession('session-id');
```

### Mark Session Failed

If a session errors out:

```javascript
archive.failSession('session-id');
```

## Integration with Events

Sessions are linked to events via `session_id`:

```javascript
// Get all events for a session
const events = archive.getSessionEvents('session-id', {
    includeThinking: true,
    includeUsage: true
});

// Session stats automatically include event counts
const stats = archive.getSessionStats('session-id');
// { total_events, message_count, tool_call_count, total_tokens, total_cost, ... }
```

## Future Enhancements

Potential improvements:
- [ ] Auto-tag sessions based on content (via LLM)
- [ ] Session similarity/clustering
- [ ] Export session as replay-able JSONL
- [ ] Session comparison view
- [ ] Timeline visualization
- [ ] Cost tracking per session

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
Set the environment variable or use `--dry-run` mode for testing without AI summaries.

### Sessions not appearing
Run `npm run scan -- --mode sessions --force` to rescan all session files.

### Summaries are generic
Ensure events are archived first (`npm run scan -- --mode events`) before generating session summaries.

## License

MIT
