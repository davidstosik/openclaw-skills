# Rate Limit Auto-Switch System - Installation Guide

This system automatically detects when Claude API hits rate limits and switches to GPT-4o fallback, then restores when the limit expires.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│  System Cron (every 5 minutes)          │
│  Runs: rate-limit-monitor.py            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Monitor Script Checks:                 │
│  - OpenClaw gateway logs                │
│  - Looks for 429/rate limit errors      │
│  - Parses retry-after headers           │
└──────────────┬──────────────────────────┘
               │
               ▼
        ┌──────┴───────┐
        │ Rate Limit?  │
        └──┬────────┬──┘
           │ No     │ Yes
           │        │
           ▼        ▼
      ┌────────┐  ┌─────────────────────────┐
      │  Done  │  │ 1. Switch to GPT-4o     │
      └────────┘  │ 2. Send WhatsApp alert  │
                  │ 3. Schedule restoration │
                  └─────────────────────────┘
                             │
                             ▼
                  ┌─────────────────────────┐
                  │  Wait for expiry...     │
                  └─────────────────────────┘
                             │
                             ▼
                  ┌─────────────────────────┐
                  │ Restoration Cron Runs:  │
                  │ 1. Restore Claude       │
                  │ 2. Send WhatsApp alert  │
                  └─────────────────────────┘
```

## Prerequisites

1. OpenClaw installed and configured
2. Python 3.7+ (usually pre-installed)
3. Access to system crontab
4. WhatsApp configured in OpenClaw (for notifications)
5. Both Claude Sonnet 4.5 and GPT-4o API keys configured

## Installation Steps

### 1. Verify Scripts Are in Place

All scripts should be in `~/.openclaw/workspace/scripts/`:

```bash
ls -la ~/.openclaw/workspace/scripts/
```

You should see:
- `rate-limit-monitor.py` (executable)
- `send-notification.sh` (executable)
- `.rate-limit-state.json` (created on first run)

### 2. Test the Monitor Script

Run a test to ensure everything works:

```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py --test
```

This simulates a rate limit detection. Check the output for:
- ✅ "RATE LIMIT DETECTED!"
- ✅ "Successfully switched to fallback model"
- ✅ Log file created at `rate-limit-monitor.log`

### 3. Restore to Primary Model

After testing, restore the primary model:

```bash
./rate-limit-monitor.py --restore
```

### 4. Set Up System Cron Job

Add the monitoring script to your system crontab:

```bash
crontab -e
```

Add this line (runs every 5 minutes):

```cron
*/5 * * * * /usr/bin/python3 $HOME/.openclaw/workspace/scripts/rate-limit-monitor.py >> $HOME/.openclaw/workspace/scripts/cron.log 2>&1
```

**Important Notes:**
- Uses full path to Python (`/usr/bin/python3`)
- Uses `$HOME` which expands in cron
- Logs all output to `cron.log` for debugging
- Runs every 5 minutes (`*/5`)

### 5. Verify Cron Job

Check that the cron job was added:

```bash
crontab -l | grep rate-limit
```

You should see your cron entry.

### 6. Monitor the System

Watch the logs to ensure it's running:

```bash
# Monitor cron execution log
tail -f ~/.openclaw/workspace/scripts/cron.log

# Monitor the monitor script log
tail -f ~/.openclaw/workspace/scripts/rate-limit-monitor.log
```

## Configuration

Edit `rate-limit-monitor.py` to customize:

```python
CONFIG = {
    "primary_model": "anthropic/claude-sonnet-4-5",    # Your primary model
    "fallback_model": "openai/gpt-4o",                 # Fallback when rate limited
    "check_lookback_lines": 500,                       # How many log lines to check
    "default_cooldown_minutes": 60,                    # Default cooldown if no header
}
```

## File Locations

| File | Purpose | Location |
|------|---------|----------|
| Monitor script | Main monitoring logic | `~/.openclaw/workspace/scripts/rate-limit-monitor.py` |
| Notification helper | Send WhatsApp alerts | `~/.openclaw/workspace/scripts/send-notification.sh` |
| State file | Current status tracking | `~/.openclaw/workspace/scripts/.rate-limit-state.json` |
| Monitor log | Script execution log | `~/.openclaw/workspace/scripts/rate-limit-monitor.log` |
| Cron log | Cron execution log | `~/.openclaw/workspace/scripts/cron.log` |
| Gateway log | OpenClaw gateway (checked for 429) | `~/.openclaw/logs/gateway.log` |

## How It Works

### Detection Phase (Every 5 Minutes)

1. Cron triggers `rate-limit-monitor.py`
2. Script reads last 500 lines of OpenClaw gateway log
3. Searches for rate limit indicators:
   - HTTP status 429
   - "rate limit" / "rate_limit" / "ratelimit" text
   - "too many requests"
   - "quota exceeded"
4. If found, extracts reset time from:
   - `retry-after` header (seconds)
   - `x-ratelimit-reset` header (Unix timestamp)
   - Falls back to 60-minute default

### Switch Phase

1. Creates gateway config patch:
   ```json
   {
     "agents": {
       "defaults": {
         "model": "openai/gpt-4o"
       }
     }
   }
   ```
2. Applies via: `openclaw gateway config.patch`
3. Updates state file with:
   - `rate_limited: true`
   - `current_model: "openai/gpt-4o"`
   - `rate_limit_reset_at: "2026-02-10T14:30:00"`
   - `switched_at: "2026-02-10T13:30:00"`
4. Sends WhatsApp notification (via agent spawn)
5. Creates restoration cron reference

### Restoration Phase

1. At scheduled time (reset time + 5 min buffer):
   ```cron
   35 14 10 02 * python3 ~/.openclaw/workspace/scripts/rate-limit-monitor.py --restore
   ```
2. Switches back to Claude Sonnet 4.5
3. Sends WhatsApp "restored" notification
4. Cleans up state

## Troubleshooting

### Cron Job Not Running

Check cron service status:
```bash
systemctl status cron  # Debian/Ubuntu
systemctl status crond # RedHat/CentOS
```

Check system logs:
```bash
grep CRON /var/log/syslog
```

### Script Errors

Check the logs:
```bash
cat ~/.openclaw/workspace/scripts/cron.log
cat ~/.openclaw/workspace/scripts/rate-limit-monitor.log
```

Run manually to see errors:
```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py
```

### Gateway Patch Fails

Verify OpenClaw gateway is running:
```bash
openclaw gateway status
```

Test patch manually:
```bash
echo '{"agents":{"defaults":{"model":"openai/gpt-4o"}}}' | openclaw gateway config.patch
```

### WhatsApp Notifications Not Sending

The notification system requires agent context. For now, notifications are logged to:
- `rate-limit-monitor.log`
- `notification-sender.log`

To manually test WhatsApp:
```bash
./send-notification.sh "Test notification"
```

### State File Corruption

Reset the state:
```bash
rm ~/.openclaw/workspace/scripts/.rate-limit-state.json
./rate-limit-monitor.py --restore
```

## Maintenance

### View Current State

```bash
cat ~/.openclaw/workspace/scripts/.rate-limit-state.json | jq .
```

### Force Switch to Fallback

```bash
./rate-limit-monitor.py --test
```

### Force Restore to Primary

```bash
./rate-limit-monitor.py --restore
```

### Clear All State

```bash
cd ~/.openclaw/workspace/scripts
rm -f .rate-limit-state.json .restoration-cron.txt
./rate-limit-monitor.py --restore
```

## Uninstallation

1. Remove cron job:
   ```bash
   crontab -e
   # Delete the rate-limit-monitor line
   ```

2. Restore primary model:
   ```bash
   ~/.openclaw/workspace/scripts/rate-limit-monitor.py --restore
   ```

3. Remove scripts (optional):
   ```bash
   rm -rf ~/.openclaw/workspace/scripts/rate-limit-*
   rm -f ~/.openclaw/workspace/scripts/.rate-limit-state.json
   ```

## Security Considerations

- Scripts run with your user permissions (no elevation needed)
- State file contains no sensitive data (just model names and timestamps)
- Gateway patch is applied via official OpenClaw CLI
- Logs may contain API error messages (review before sharing)

## Support

For issues:
1. Check logs: `cron.log` and `rate-limit-monitor.log`
2. Run script manually with verbose output
3. Verify OpenClaw gateway is healthy
4. Check that both API keys (Claude + GPT-4o) are valid
