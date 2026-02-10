# Rate Limit Auto-Switch - Quick Reference

Quick commands for common operations.

## Daily Operations

### Check Current Status
```bash
cat ~/.openclaw/workspace/scripts/.rate-limit-state.json | jq .
```

### View Recent Activity
```bash
tail -20 ~/.openclaw/workspace/scripts/rate-limit-monitor.log
```

### Check Which Model Is Active
```bash
openclaw gateway config.get | grep -A3 '"model"'
```

## Manual Operations

### Force Switch to Fallback
```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py --test
```

### Restore to Primary Model
```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py --restore
```

### Send Test Notification
```bash
cd ~/.openclaw/workspace/scripts
./send-notification.sh "Test message"
```

### Run Manual Check
```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py
```

## Troubleshooting

### Is Cron Running?
```bash
crontab -l | grep rate-limit
```

### Check Cron Logs
```bash
tail -50 ~/.openclaw/workspace/scripts/cron.log
```

### Check Gateway Status
```bash
openclaw gateway status
```

### View Gateway Logs
```bash
tail -100 ~/.openclaw/logs/gateway.log | grep -i "rate\|429\|limit"
```

### Reset Everything
```bash
cd ~/.openclaw/workspace/scripts
rm -f .rate-limit-state.json .restoration-cron.txt
./rate-limit-monitor.py --restore
```

## Monitoring Commands

### Watch Live
```bash
# Monitor the monitor
tail -f ~/.openclaw/workspace/scripts/rate-limit-monitor.log

# Monitor cron
tail -f ~/.openclaw/workspace/scripts/cron.log

# Monitor gateway
tail -f ~/.openclaw/logs/gateway.log
```

### Count Switches Today
```bash
grep "$(date +%Y-%m-%d)" ~/.openclaw/workspace/scripts/rate-limit-monitor.log | grep "SWITCHING TO FALLBACK" | wc -l
```

### See All Switch Events
```bash
grep "SWITCHING TO FALLBACK\|RESTORING PRIMARY" ~/.openclaw/workspace/scripts/rate-limit-monitor.log
```

## File Locations

| Purpose | Path |
|---------|------|
| Main script | `~/.openclaw/workspace/scripts/rate-limit-monitor.py` |
| Current state | `~/.openclaw/workspace/scripts/.rate-limit-state.json` |
| Activity log | `~/.openclaw/workspace/scripts/rate-limit-monitor.log` |
| Cron output | `~/.openclaw/workspace/scripts/cron.log` |
| Gateway log | `~/.openclaw/logs/gateway.log` |

## State File Fields

```json
{
  "rate_limited": false,           // Currently rate limited?
  "current_model": "...",          // Active model
  "rate_limit_reset_at": "...",    // When limit expires (ISO 8601)
  "switched_at": "...",            // When we switched (ISO 8601)
  "last_check": "..."              // Last monitor run (ISO 8601)
}
```

## Cron Schedule

Default: Every 5 minutes
```cron
*/5 * * * * /usr/bin/python3 $HOME/.openclaw/workspace/scripts/rate-limit-monitor.py >> $HOME/.openclaw/workspace/scripts/cron.log 2>&1
```

To change interval:
```bash
crontab -e
# Modify the */5 to your preferred interval
```

## Common Issues

### Cron not running
```bash
systemctl status cron  # Check service
grep CRON /var/log/syslog  # Check logs
```

### Script errors
```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py  # Run manually to see errors
```

### Gateway patch fails
```bash
openclaw gateway status  # Ensure gateway is running
openclaw gateway restart  # Try restarting
```

### State stuck
```bash
rm ~/.openclaw/workspace/scripts/.rate-limit-state.json
./rate-limit-monitor.py --restore
```

## Getting Help

1. Check logs: `cron.log` and `rate-limit-monitor.log`
2. Run script manually to see full output
3. Review `TEST.md` for comprehensive testing
4. See `INSTALL.md` for troubleshooting section

## Emergency: Disable System

```bash
# Remove cron job
crontab -e  # Delete the rate-limit-monitor line

# Restore primary model
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py --restore

# Optionally remove scripts
# rm -rf ~/.openclaw/workspace/scripts/rate-limit-*
```

## Emergency: Force Primary Model

If the script isn't working, manually patch config:

```bash
echo '{"agents":{"defaults":{"model":"anthropic/claude-sonnet-4-5"}}}' | openclaw gateway config.patch
```

## Log Rotation

If logs grow too large:

```bash
# Truncate logs (keep last 1000 lines)
tail -1000 ~/.openclaw/workspace/scripts/rate-limit-monitor.log > /tmp/rlm.log
mv /tmp/rlm.log ~/.openclaw/workspace/scripts/rate-limit-monitor.log

tail -1000 ~/.openclaw/workspace/scripts/cron.log > /tmp/cron.log
mv /tmp/cron.log ~/.openclaw/workspace/scripts/cron.log
```

Or set up logrotate:

```bash
sudo tee /etc/logrotate.d/openclaw-rate-limit << EOF
$HOME/.openclaw/workspace/scripts/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
EOF
```
