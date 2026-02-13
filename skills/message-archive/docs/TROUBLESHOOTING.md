# Message Archive Troubleshooting

## Foreign Key Constraint Errors During Event Scanning

### Symptoms
- Archive scan completes but reports errors (e.g., "⚠️ 221 errors occurred")
- Errors are concentrated in specific session files
- Error message: `FOREIGN KEY constraint failed` or `NOT NULL constraint failed: events.session_id`

### Root Cause
The `events` table has a foreign key constraint: `FOREIGN KEY (parent_event_id) REFERENCES events(event_id)`. 

When events are scanned incrementally (using the checkpoint system), if any events fail to insert or are missed for any reason, **all subsequent child events that reference them as parents will also fail**. This creates a cascade of failures that can grow to hundreds of events.

Example failure chain:
```
Event A (timestamp: 13:43:36) ❌ Missing from DB
  └─ Event B (timestamp: 13:43:49) ❌ Fails (parent A missing)
      └─ Event C (timestamp: 13:44:03) ❌ Fails (parent B missing)
          └─ ... (cascade continues for all descendants)
```

### Solution

**Immediate Fix:**
Run a force scan with foreign key constraints disabled to backfill missing events:

```bash
cd /home/sto/.openclaw/workspace/skills/message-archive/tools
node archive-scan.js --mode events --force
```

The `--force` flag:
- Ignores the checkpoint (scans all events)
- Temporarily disables foreign key constraints during insertion
- Allows backfilling of incomplete event history

**Verification:**
After the force scan, run a regular scan to confirm 0 errors:

```bash
node archive-scan.js --mode both
```

### Prevention

1. **Monitor scan results** - Check for errors in cron job output
2. **Handle scanner crashes gracefully** - If the scanner crashes mid-scan, checkpoint may advance but some events may be missed
3. **Periodic force scans** - Consider running `--force` weekly to catch any gaps

### Technical Details

**Why --force works:**
The scanner code temporarily disables foreign key constraints when `force=true`:

```javascript
if (disableForeignKeys) {
    this.db.prepare('PRAGMA foreign_keys = OFF').run();
}
```

This allows insertion of events even if their parents don't exist yet (e.g., when backfilling partial history).

**Event table schema:**
```sql
CREATE TABLE events (
    event_id TEXT UNIQUE NOT NULL,
    parent_event_id TEXT,
    session_id TEXT NOT NULL,
    ...
    FOREIGN KEY (parent_event_id) REFERENCES events(event_id)
)
```

---

## Session ID Missing Errors

### Symptoms
- Error: `NOT NULL constraint failed: events.session_id`
- Events have `session_id: null` in parser output

### Root Cause
The EventParser sets `session_id: null` for all non-session events, expecting the scanner to fill it in from:
1. The filename (session UUID)
2. Or the first session event in the parsed batch

If both fail, events remain with null session_id.

### Solution
Check that:
1. Session files are named with valid UUIDs: `UUID.jsonl`
2. Session files contain a session initialization event (type: "session") as the first event

### Debugging
```javascript
const sessionId = path.basename(sessionFile, '.jsonl');
console.log('Extracted sessionId:', sessionId); // Should be a UUID
```

---

## Date: 2026-02-13
## Fixed By: Subagent (archive-scan-errors)
