# Rate Limit Auto-Switch System - Architecture

Complete technical architecture documentation.

## System Overview

The Rate Limit Auto-Switch System provides automatic failover when OpenClaw's primary AI model (Claude Sonnet 4.5) encounters rate limits. It seamlessly switches to a fallback model (GPT-4o) and automatically restores the primary when the rate limit expires.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          SYSTEM CRON                                │
│                    (Every 5 minutes: */5)                           │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   RATE LIMIT MONITOR SCRIPT                         │
│                   (rate-limit-monitor.py)                           │
│                                                                     │
│  1. Load State:  .rate-limit-state.json                           │
│  2. Read Logs:   ~/.openclaw/logs/gateway.log                     │
│  3. Parse:       Search last 500 lines for:                        │
│                  • HTTP 429                                         │
│                  • "rate limit" / "rate_limit"                      │
│                  • "too many requests"                              │
│                  • "quota exceeded"                                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Rate Limit     │
                    │ Detected?      │
                    └───┬────────┬───┘
                        │        │
                     NO │        │ YES
                        │        │
        ┌───────────────┘        └──────────────┐
        │                                       │
        ▼                                       ▼
┌──────────────┐              ┌────────────────────────────────────────┐
│              │              │  SWITCH TO FALLBACK                    │
│  Log: "No   │              │                                        │
│  rate limit  │              │  1. Parse Reset Time:                 │
│  detected"   │              │     • retry-after header (seconds)    │
│              │              │     • x-ratelimit-reset (timestamp)   │
│  Exit 0      │              │     • Default: 60 minutes             │
│              │              │                                        │
└──────────────┘              │  2. Create Gateway Patch:             │
                              │     {                                  │
                              │       "agents": {                      │
                              │         "defaults": {                  │
                              │           "model": "openai/gpt-4o"     │
                              │         }                              │
                              │       }                                │
                              │     }                                  │
                              │                                        │
                              │  3. Apply Patch:                       │
                              │     echo $PATCH |                      │
                              │     openclaw gateway config.patch      │
                              │                                        │
                              │  4. Update State:                      │
                              │     • rate_limited = true              │
                              │     • current_model = "gpt-4o"         │
                              │     • rate_limit_reset_at = ISO8601    │
                              │     • switched_at = ISO8601            │
                              │                                        │
                              │  5. Send Notification:                 │
                              │     "⚠️ Rate Limit Detected"           │
                              │                                        │
                              │  6. Log Restoration Schedule:          │
                              │     • Create .restoration-cron.txt     │
                              │     • Document cron command            │
                              │                                        │
                              └────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌────────────────────────────────────────┐
                              │   WAIT FOR EXPIRY                      │
                              │   (rate_limit_reset_at timestamp)      │
                              │                                        │
                              │   Monitoring continues every 5 min:    │
                              │   • Detects: already rate limited      │
                              │   • Logs: time remaining               │
                              │   • Skips: redundant operations        │
                              └────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌────────────────────────────────────────┐
                              │   SCHEDULED RESTORATION                │
                              │   (Cron at reset_time + 5 min buffer)  │
                              │                                        │
                              │   Command:                             │
                              │   ./rate-limit-monitor.py --restore    │
                              │                                        │
                              │   1. Create Gateway Patch:             │
                              │      {                                 │
                              │        "agents": {                     │
                              │          "defaults": {                 │
                              │            "model": "anthropic/        │
                              │                      claude-sonnet-4-5"│
                              │          }                             │
                              │        }                               │
                              │      }                                 │
                              │                                        │
                              │   2. Apply Patch:                      │
                              │      echo $PATCH |                     │
                              │      openclaw gateway config.patch     │
                              │                                        │
                              │   3. Update State:                     │
                              │      • rate_limited = false            │
                              │      • current_model = "claude-..."    │
                              │      • rate_limit_reset_at = null      │
                              │                                        │
                              │   4. Send Notification:                │
                              │      "✅ Rate Limit Expired"           │
                              │                                        │
                              │   5. Cleanup:                          │
                              │      • Remove .restoration-cron.txt    │
                              │                                        │
                              └────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌────────────────────────────────────────┐
                              │   BACK TO NORMAL                       │
                              │   System monitors as usual             │
                              └────────────────────────────────────────┘
```

## Component Details

### 1. Monitoring Script (rate-limit-monitor.py)

**Language:** Python 3.7+  
**Execution:** Via system cron every 5 minutes  
**Runtime:** < 1 second (normal), < 5 seconds (rate limit detected)

**Key Functions:**
- `check_gateway_logs()` - Reads and parses gateway log file
- `extract_reset_time_from_line()` - Extracts rate limit expiry time
- `switch_to_fallback()` - Patches gateway config to fallback model
- `restore_primary()` - Patches gateway config to primary model
- `notify_switched()` / `notify_restored()` - Send WhatsApp alerts
- `schedule_restoration()` - Creates cron job reference for restoration

**State Management:**
```python
state = {
    "rate_limited": bool,           # Currently limited?
    "current_model": str,           # Active model
    "rate_limit_reset_at": str,     # ISO 8601 timestamp
    "switched_at": str,             # ISO 8601 timestamp
    "last_check": str               # ISO 8601 timestamp
}
```

### 2. Notification Helper (send-notification.sh)

**Language:** Bash  
**Purpose:** Send WhatsApp notifications via OpenClaw agent  
**Execution:** Called by monitoring script

**Flow:**
1. Receives message as argument
2. Creates temporary instruction file
3. Spawns isolated OpenClaw agent (GPT-4o-mini)
4. Agent uses message tool to send WhatsApp
5. Logs execution to notification-sender.log

### 3. Installer (install.sh)

**Language:** Bash  
**Purpose:** Automated setup and validation  
**Features:**
- Prerequisite checking (OpenClaw, Python, gateway)
- Script permission setup
- Test execution
- Cron job installation
- Interactive prompts
- Validation and verification

### 4. State File (.rate-limit-state.json)

**Format:** JSON  
**Location:** `~/.openclaw/workspace/scripts/.rate-limit-state.json`  
**Purpose:** Persistent state tracking  

**Schema:**
```json
{
  "rate_limited": false,
  "current_model": "anthropic/claude-sonnet-4-5",
  "rate_limit_reset_at": null,
  "switched_at": null,
  "last_check": "2026-02-10T13:45:00.123456"
}
```

**States:**
- **Normal:** `rate_limited=false`, `current_model=primary`
- **Rate Limited:** `rate_limited=true`, `current_model=fallback`, `reset_at` populated
- **Restoring:** Transition from rate limited back to normal

### 5. Log Files

| Log File | Purpose | Rotation |
|----------|---------|----------|
| `rate-limit-monitor.log` | Script activity | Manual/logrotate |
| `cron.log` | Cron execution output | Manual/logrotate |
| `notification-sender.log` | WhatsApp notification attempts | Manual/logrotate |

**Log Format:**
```
[YYYY-MM-DD HH:MM:SS] Message text
```

## Data Flow

### Normal Check (No Rate Limit)

```
Cron Trigger
    ↓
Load State (rate_limited=false)
    ↓
Read gateway.log (last 500 lines)
    ↓
Parse for rate limit patterns
    ↓
No match found
    ↓
Log "No rate limit detected"
    ↓
Exit (state unchanged)
```

### Rate Limit Detection

```
Cron Trigger
    ↓
Load State (rate_limited=false)
    ↓
Read gateway.log
    ↓
Parse for rate limit patterns
    ↓
Match found: "HTTP 429" or "rate limit"
    ↓
Extract retry-after: 3600 seconds
    ↓
Calculate reset_at: now + 3600s
    ↓
Create patch: {"model": "gpt-4o"}
    ↓
Apply: openclaw gateway config.patch
    ↓
Update state: rate_limited=true
    ↓
Send notification: "⚠️ Rate Limit Detected"
    ↓
Log restoration schedule
    ↓
Exit (state saved)
```

### Restoration

```
Cron Trigger (at scheduled time)
    ↓
Load State (rate_limited=true)
    ↓
Check: now >= reset_at? YES
    ↓
Create patch: {"model": "claude-sonnet-4-5"}
    ↓
Apply: openclaw gateway config.patch
    ↓
Update state: rate_limited=false
    ↓
Send notification: "✅ Rate Limit Expired"
    ↓
Cleanup: remove .restoration-cron.txt
    ↓
Exit (state saved)
```

## Error Handling

### Gateway Log Missing

**Trigger:** `~/.openclaw/logs/gateway.log` doesn't exist  
**Action:** Log warning, return "no rate limit detected", exit cleanly  
**Impact:** None, system waits for next check

### Gateway Unavailable

**Trigger:** `openclaw gateway config.patch` fails  
**Action:** Log error, don't update state, exit with error code  
**Impact:** Retry on next cron cycle

### Corrupted State File

**Trigger:** JSON parse error on `.rate-limit-state.json`  
**Action:** Log warning, create fresh default state  
**Impact:** System continues with clean state

### Invalid Reset Time

**Trigger:** Cannot parse retry-after or x-ratelimit-reset  
**Action:** Fall back to 60-minute default cooldown  
**Impact:** System uses conservative estimate

### Notification Failure

**Trigger:** WhatsApp notification script fails  
**Action:** Log error, continue with model switch  
**Impact:** Switch succeeds, but user not notified (check logs)

## Security Considerations

### Permissions

- **User-level:** All scripts run as the user (no sudo/elevation)
- **File access:** Only reads gateway logs, writes to workspace
- **Config changes:** Uses official OpenClaw CLI (`gateway config.patch`)

### Data Sensitivity

- **State file:** Contains only model names and timestamps (no secrets)
- **Logs:** May contain API error messages (sanitize before sharing)
- **Notifications:** Sent via OpenClaw's existing WhatsApp integration

### Network Access

- **No direct network:** Script doesn't make HTTP requests
- **Via OpenClaw:** All API calls go through OpenClaw gateway
- **Isolation:** Runs independently of main agent sessions

## Performance Characteristics

### Resource Usage

| Resource | Normal Check | Rate Limit Event |
|----------|-------------|------------------|
| CPU | < 0.1% for 1s | < 1% for 5s |
| Memory | ~20 MB | ~30 MB |
| Disk I/O | Read 100 KB | Write 10 KB |
| Network | None | Via OpenClaw gateway |

### Timing

| Operation | Duration |
|-----------|----------|
| Script startup | 100-200 ms |
| Log parsing | 100-300 ms |
| Gateway patch | 1-3 seconds |
| Notification | 2-5 seconds |
| Total (normal) | < 1 second |
| Total (rate limit) | < 5 seconds |

### Scalability

- **Frequency:** Can run every 1-10 minutes (default: 5)
- **Log size:** Handles logs up to 100 MB efficiently
- **Concurrent runs:** State file prevents race conditions
- **Long-term:** Logs should be rotated after 7-30 days

## Integration Points

### OpenClaw Gateway

**Interface:** `openclaw gateway config.patch`  
**Format:** JSON via stdin  
**Purpose:** Update model configuration  

**Example:**
```bash
echo '{"agents":{"defaults":{"model":"openai/gpt-4o"}}}' | \
  openclaw gateway config.patch
```

### WhatsApp Notifications

**Interface:** OpenClaw agent + message tool  
**Method:** Spawn isolated agent session  
**Model:** GPT-4o-mini (cheap, fast, always available)  

**Flow:**
```bash
openclaw agent run \
  --model "openai/gpt-4o-mini" \
  --label "notification-sender" \
  --prompt "Send WhatsApp: $MESSAGE"
```

### System Cron

**Interface:** User crontab  
**Schedule:** `*/5 * * * *` (every 5 minutes)  
**Command:** `/usr/bin/python3 $SCRIPT >> $LOG 2>&1`

## Testing Strategy

### Unit Tests

- ✅ Script execution
- ✅ State management
- ✅ Log parsing
- ✅ Error handling

### Integration Tests

- ✅ Gateway patching
- ✅ Cron execution
- ✅ State persistence
- ✅ End-to-end workflow

### Edge Case Tests

- ✅ Missing logs
- ✅ Corrupted state
- ✅ Gateway unavailable
- ✅ Duplicate detection
- ✅ Invalid timestamps

### Simulation Tests

- ✅ Test mode (--test flag)
- ✅ Force restore (--restore flag)
- ✅ Fake log entries
- ✅ Manual state manipulation

See [TEST.md](TEST.md) for complete test suite.

## Deployment Architecture

### Development

```
Laptop/Workstation
├── Scripts in workspace
├── Manual testing
└── State in local filesystem
```

### Production

```
Server/VPS
├── Scripts in ~/.openclaw/workspace/scripts
├── Cron managed by system
├── State in persistent storage
├── Logs rotated automatically
└── Monitoring/alerting configured
```

## Monitoring & Observability

### Metrics to Track

1. **Rate Limit Events**
   - Frequency (per day/week)
   - Duration (time in fallback mode)
   - Pattern (time of day, day of week)

2. **System Health**
   - Script execution success rate
   - Gateway patch success rate
   - Notification delivery rate

3. **Performance**
   - Script execution time
   - Log parsing time
   - State file size

### Monitoring Commands

```bash
# Events today
grep "$(date +%Y-%m-%d)" rate-limit-monitor.log | \
  grep "SWITCHING TO FALLBACK" | wc -l

# Average time in fallback
grep "switched_at\|rate_limit_reset_at" .rate-limit-state.json

# Script health
tail -100 cron.log | grep -c "Check complete"

# Current status
cat .rate-limit-state.json | jq .
```

## Future Architecture Considerations

### Scalability

For multiple OpenClaw instances:
- Separate state files per instance
- Centralized monitoring dashboard
- Shared rate limit budget tracking

### Reliability

For mission-critical deployments:
- Redundant cron jobs (primary + backup)
- Alerting on script failures
- Automatic recovery procedures

### Observability

For production monitoring:
- Metrics export (Prometheus/Grafana)
- Centralized logging (ELK/Loki)
- Real-time dashboards

---

**Document Version:** 1.0  
**Last Updated:** 2026-02-10  
**Status:** Production Ready ✅
