-- ============================================================================
-- SESSIONS TABLE - Message Archive
-- ============================================================================
-- Tracks all OpenClaw sessions (main, subagent, cron, isolated) with
-- AI-generated summaries for easy navigation and session discovery.
--
-- Version: 1.0
-- Date: 2026-02-13
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
    -- Identity
    id TEXT PRIMARY KEY,                        -- Session UUID (from filename)
    session_key TEXT NOT NULL,                  -- e.g., agent:main:main, agent:main:subagent:UUID
    type TEXT NOT NULL CHECK(type IN ('main', 'subagent', 'cron', 'isolated')),
    
    -- Hierarchy (for subagents)
    parent_id TEXT,                             -- Parent session ID (for subagents)
    
    -- Metadata
    label TEXT,                                 -- Optional label from session metadata
    agent_id TEXT,                              -- Agent identifier (e.g., "main")
    model TEXT,                                 -- Primary model used (e.g., "claude-sonnet-4-5")
    
    -- Timing
    started_at INTEGER NOT NULL,                -- First event timestamp
    ended_at INTEGER,                           -- Last event timestamp (NULL if active)
    
    -- Status
    status TEXT NOT NULL DEFAULT 'active'       -- active | completed | failed
        CHECK(status IN ('active', 'completed', 'failed')),
    
    -- Summary (AI-generated for subagents, "main" for main session)
    title TEXT NOT NULL,                        -- 5-10 word description
    summary TEXT NOT NULL,                      -- 2-3 sentence overview
    
    -- Statistics
    message_count INTEGER DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at INTEGER NOT NULL,                -- When row was created
    updated_at INTEGER NOT NULL,                -- When row was last updated
    
    -- Foreign key
    FOREIGN KEY (parent_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sessions_session_key ON sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, started_at DESC);

-- Full-text search on title and summary
CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
    title,
    summary,
    content=sessions,
    content_rowid=rowid
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-populate FTS on insert
CREATE TRIGGER IF NOT EXISTS sessions_fts_insert AFTER INSERT ON sessions BEGIN
    INSERT INTO sessions_fts(rowid, title, summary)
    VALUES (new.rowid, new.title, new.summary);
END;

-- Auto-update FTS on update
CREATE TRIGGER IF NOT EXISTS sessions_fts_update AFTER UPDATE ON sessions BEGIN
    UPDATE sessions_fts
    SET title = new.title, summary = new.summary
    WHERE rowid = old.rowid;
END;

-- Auto-delete FTS on delete
CREATE TRIGGER IF NOT EXISTS sessions_fts_delete AFTER DELETE ON sessions BEGIN
    DELETE FROM sessions_fts WHERE rowid = old.rowid;
END;

-- Auto-update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS sessions_update_timestamp 
AFTER UPDATE ON sessions
FOR EACH ROW
BEGIN
    UPDATE sessions SET updated_at = (unixepoch() * 1000) WHERE id = NEW.id;
END;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Session with statistics
CREATE VIEW IF NOT EXISTS sessions_with_stats AS
SELECT 
    s.*,
    COUNT(DISTINCT CASE WHEN e.event_type = 'message' THEN e.id END) as actual_message_count,
    COUNT(DISTINCT e.id) as actual_event_count,
    (s.ended_at - s.started_at) / 1000 as duration_seconds
FROM sessions s
LEFT JOIN events e ON e.session_id = s.id
GROUP BY s.id;

-- View: Subagent sessions with parent info
CREATE VIEW IF NOT EXISTS subagent_sessions AS
SELECT 
    s.*,
    p.title as parent_title,
    p.started_at as parent_started_at
FROM sessions s
LEFT JOIN sessions p ON s.parent_id = p.id
WHERE s.type IN ('subagent', 'isolated');

-- ============================================================================
-- NOTES
-- ============================================================================
-- Session types:
--   - main: Primary agent session (agent:main:main)
--   - subagent: Spawned child session for specific tasks
--   - cron: Scheduled task execution
--   - isolated: One-off isolated execution
--
-- Summary generation:
--   - For main sessions: title="Main Session", summary="main"
--   - For others: AI-generated using first/last messages
--
-- Status transitions:
--   - active: Session is currently running
--   - completed: Session finished normally
--   - failed: Session ended with errors
-- ============================================================================
