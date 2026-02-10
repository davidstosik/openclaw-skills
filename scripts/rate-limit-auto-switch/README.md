# Rate Limit Auto-Switch System

Automatically detect rate limits and switch between Claude and GPT-4o.

## Quick Start

```bash
./install.sh
```

## Documentation

| Document | Purpose |
|----------|---------|
| [INSTALL.md](INSTALL.md) | Complete installation guide |
| [TEST.md](TEST.md) | Testing procedures (10 tests) |
| [QUICK-REFERENCE.md](QUICK-REFERENCE.md) | Daily operations cheat sheet |
| [../projects/rate-limit-auto-switch.md](../projects/rate-limit-auto-switch.md) | Project overview |

## Commands

```bash
# Test the system (simulate rate limit)
./rate-limit-monitor.py --test

# Restore to primary model
./rate-limit-monitor.py --restore

# Run manual check
./rate-limit-monitor.py

# Check status
cat .rate-limit-state.json | jq .

# View logs
tail -f rate-limit-monitor.log
```

## Architecture

```
Cron (every 5 min) → Monitor Script → Check Logs → Rate Limit?
                                                      ├─ No  → Done
                                                      └─ Yes → Switch Model
                                                              → Notify
                                                              → Schedule Restore
```

## System Status

Check if the system is active:

```bash
# Is cron configured?
crontab -l | grep rate-limit

# Last check time
cat .rate-limit-state.json | jq -r .last_check

# Current model
cat .rate-limit-state.json | jq -r .current_model

# Rate limited?
cat .rate-limit-state.json | jq -r .rate_limited
```

## Files

- `rate-limit-monitor.py` - Main monitoring script
- `send-notification.sh` - WhatsApp notification helper
- `install.sh` - Automated installer
- `.rate-limit-state.json` - Current state (auto-created)
- `rate-limit-monitor.log` - Activity log (auto-created)
- `cron.log` - Cron execution log (auto-created)

## Features

✅ Automatic detection every 5 minutes  
✅ Intelligent rate limit parsing  
✅ Seamless model switching  
✅ WhatsApp notifications  
✅ Automatic restoration  
✅ Comprehensive error handling  
✅ Production-ready and tested  

## Need Help?

1. Read [QUICK-REFERENCE.md](QUICK-REFERENCE.md) for common commands
2. Read [INSTALL.md](INSTALL.md) for troubleshooting
3. Read [TEST.md](TEST.md) for testing procedures
4. Check logs: `tail -f rate-limit-monitor.log`

## Emergency

Force restore to Claude:
```bash
./rate-limit-monitor.py --restore
```

Or manually:
```bash
echo '{"agents":{"defaults":{"model":"anthropic/claude-sonnet-4-5"}}}' | openclaw gateway config.patch
```

---

**Status:** Production Ready ✅ | **Version:** 1.0 | **Date:** 2026-02-10
