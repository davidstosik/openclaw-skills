# Rate Limit Auto-Switch System - Testing Guide

Complete testing procedure for the rate limit auto-switch system.

## Test Environment Setup

Before testing, ensure:
- ✅ OpenClaw gateway is running: `openclaw gateway status`
- ✅ Scripts are executable: `ls -la ~/.openclaw/workspace/scripts/*.py`
- ✅ You have both Claude and GPT-4o API keys configured
- ✅ Current model is Claude Sonnet 4.5 (check config)

## Test 1: Basic Script Execution

**Purpose:** Verify the script runs without errors.

```bash
cd ~/.openclaw/workspace/scripts
./rate-limit-monitor.py
```

**Expected Output:**
```
[YYYY-MM-DD HH:MM:SS] ============================================================
[YYYY-MM-DD HH:MM:SS] Starting rate limit check
[YYYY-MM-DD HH:MM:SS] No rate limit detected - all clear
[YYYY-MM-DD HH:MM:SS] Check complete
```

**✅ Pass Criteria:**
- Script exits with code 0
- No Python errors
- Log file created: `rate-limit-monitor.log`
- State file created: `.rate-limit-state.json`

**❌ If Failed:**
- Check Python version: `python3 --version` (need 3.7+)
- Check file permissions: `chmod +x rate-limit-monitor.py`
- Look for errors in output

---

## Test 2: Simulated Rate Limit Detection

**Purpose:** Test detection and fallback switching logic.

```bash
./rate-limit-monitor.py --test
```

**Expected Output:**
```
[...] Starting rate limit check
[...] TEST MODE: Simulating rate limit detection
[...] RATE LIMIT DETECTED!
[...] Details: {
  "detected_at": "...",
  "reset_at": "...",
  "log_line": "TEST: Simulated 429 rate limit error"
}
[...] === SWITCHING TO FALLBACK ===
[...] From: anthropic/claude-sonnet-4-5
[...] To: openai/gpt-4o
[...] Gateway config updated successfully
[...] Sending WhatsApp notification...
[...] NOTIFICATION: ⚠️ *Rate Limit Detected*
[...] Restoration scheduled for: YYYY-MM-DD HH:MM UTC
[...] Successfully switched to fallback model
```

**✅ Pass Criteria:**
- Rate limit detected
- Gateway config patched successfully
- State file shows `"rate_limited": true`
- State file shows `"current_model": "openai/gpt-4o"`
- Restoration time scheduled (~1 hour in future)

**Verify State:**
```bash
cat .rate-limit-state.json | jq .
```

Should show:
```json
{
  "rate_limited": true,
  "current_model": "openai/gpt-4o",
  "rate_limit_reset_at": "2026-02-10T14:50:00",
  "switched_at": "2026-02-10T13:50:00",
  "last_check": "2026-02-10T13:50:05"
}
```

**Verify OpenClaw Config:**
```bash
openclaw gateway config.get
```

Look for:
```json
{
  "agents": {
    "defaults": {
      "model": "openai/gpt-4o"
    }
  }
}
```

**❌ If Failed:**
- Check `openclaw gateway status`
- Verify gateway is running
- Check permissions to modify config
- Look for errors in `rate-limit-monitor.log`

---

## Test 3: Restoration

**Purpose:** Test switching back to primary model.

```bash
./rate-limit-monitor.py --restore
```

**Expected Output:**
```
[...] FORCE RESTORE requested
[...] === RESTORING PRIMARY MODEL ===
[...] From: openai/gpt-4o
[...] To: anthropic/claude-sonnet-4-5
[...] Gateway config restored successfully
[...] Sending WhatsApp notification...
[...] NOTIFICATION: ✅ *Rate Limit Expired*
[...] Restoration cron reference removed
```

**✅ Pass Criteria:**
- Gateway config patched back to Claude
- State file shows `"rate_limited": false`
- State file shows `"current_model": "anthropic/claude-sonnet-4-5"`
- Restoration cron reference removed

**Verify:**
```bash
cat .rate-limit-state.json | jq .
openclaw gateway config.get | grep -A2 model
```

---

## Test 4: Repeated Detection (Already Rate Limited)

**Purpose:** Ensure script doesn't switch multiple times.

```bash
# First, trigger rate limit
./rate-limit-monitor.py --test

# Run again immediately
./rate-limit-monitor.py
```

**Expected Output:**
```
[...] Starting rate limit check
[...] Still rate limited, ... remaining until restoration
```

**✅ Pass Criteria:**
- Script recognizes already rate limited
- Does NOT switch again
- Shows time remaining until restoration

---

## Test 5: Cron Simulation

**Purpose:** Test as if running from cron.

Create a test cron script:
```bash
cat > /tmp/test-cron.sh << 'EOF'
#!/bin/bash
cd $HOME/.openclaw/workspace/scripts
/usr/bin/python3 ./rate-limit-monitor.py >> cron-test.log 2>&1
EOF

chmod +x /tmp/test-cron.sh
```

Run it:
```bash
/tmp/test-cron.sh
cat ~/.openclaw/workspace/scripts/cron-test.log
```

**✅ Pass Criteria:**
- Script runs successfully
- Output logged to `cron-test.log`
- No "command not found" errors
- State file updated with `last_check` timestamp

---

## Test 6: Log Parsing (Real Gateway Logs)

**Purpose:** Test actual log file parsing.

Create a fake rate limit entry in gateway logs:

```bash
echo '[2026-02-10 13:00:00] ERROR: HTTP 429 Too Many Requests - retry-after: 3600' >> ~/.openclaw/logs/gateway.log
```

Now run the monitor:
```bash
./rate-limit-monitor.py
```

**✅ Pass Criteria:**
- Detects the fake rate limit in gateway log
- Extracts retry-after value (3600 seconds = 1 hour)
- Calculates correct reset time
- Switches to fallback

**Cleanup:**
```bash
./rate-limit-monitor.py --restore
```

---

## Test 7: Edge Cases

### 7a: Missing Gateway Log

```bash
# Temporarily rename gateway log
mv ~/.openclaw/logs/gateway.log ~/.openclaw/logs/gateway.log.bak

./rate-limit-monitor.py

# Restore
mv ~/.openclaw/logs/gateway.log.bak ~/.openclaw/logs/gateway.log
```

**✅ Pass Criteria:**
- Script handles missing log gracefully
- Logs warning but doesn't crash
- Returns "no rate limit detected"

### 7b: Corrupted State File

```bash
echo "invalid json" > .rate-limit-state.json
./rate-limit-monitor.py
```

**✅ Pass Criteria:**
- Script handles corrupted state
- Creates fresh state
- Continues normally

### 7c: Gateway Unavailable

```bash
# Stop gateway temporarily
openclaw gateway stop

./rate-limit-monitor.py --test

# Restart gateway
openclaw gateway start
```

**✅ Pass Criteria:**
- Script detects gateway patch failure
- Logs error appropriately
- Doesn't corrupt state

---

## Test 8: End-to-End Workflow

**Purpose:** Complete workflow from detection to restoration.

```bash
# 1. Start with clean state
./rate-limit-monitor.py --restore
cat .rate-limit-state.json

# 2. Simulate rate limit
./rate-limit-monitor.py --test

# 3. Verify switched to fallback
openclaw gateway config.get | grep model

# 4. Run check while rate limited (should skip)
./rate-limit-monitor.py

# 5. Force restoration
./rate-limit-monitor.py --restore

# 6. Verify back to primary
openclaw gateway config.get | grep model
```

**✅ Pass Criteria:**
- Clean flow through all states
- Appropriate logs at each step
- State file accurately reflects status
- Gateway config correctly updated

---

## Test 9: WhatsApp Notification (Manual)

**Purpose:** Test notification helper script.

```bash
./send-notification.sh "🧪 Test notification from rate limit system"
```

**✅ Pass Criteria:**
- Script spawns OpenClaw agent
- Agent sends WhatsApp message
- Message received on WhatsApp
- Logged to `notification-sender.log`

**Note:** This requires WhatsApp to be configured in OpenClaw. If not set up, this test can be skipped.

---

## Test 10: Cron Job Integration

**Purpose:** Add to actual crontab and verify it runs.

```bash
# Add cron job (temporary - runs every minute for testing)
(crontab -l 2>/dev/null; echo "* * * * * /usr/bin/python3 $HOME/.openclaw/workspace/scripts/rate-limit-monitor.py >> $HOME/.openclaw/workspace/scripts/cron-test.log 2>&1") | crontab -

# Wait 2 minutes and check logs
sleep 120
cat ~/. openclaw/workspace/scripts/cron-test.log
```

**✅ Pass Criteria:**
- Cron executes every minute
- Multiple check entries in log
- No cron errors in `/var/log/syslog`

**Cleanup:**
```bash
# Remove test cron job
crontab -l | grep -v 'rate-limit-monitor.py' | crontab -

# Add back the proper one (every 5 minutes)
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/bin/python3 $HOME/.openclaw/workspace/scripts/rate-limit-monitor.py >> $HOME/.openclaw/workspace/scripts/cron.log 2>&1") | crontab -
```

---

## Test Results Checklist

- [ ] Test 1: Basic execution
- [ ] Test 2: Simulated rate limit detection
- [ ] Test 3: Restoration
- [ ] Test 4: Repeated detection handling
- [ ] Test 5: Cron simulation
- [ ] Test 6: Log parsing
- [ ] Test 7a: Missing log handling
- [ ] Test 7b: Corrupted state handling
- [ ] Test 7c: Gateway unavailable handling
- [ ] Test 8: End-to-end workflow
- [ ] Test 9: WhatsApp notifications (optional)
- [ ] Test 10: Cron integration

---

## Performance Benchmarks

Expected execution times:
- Normal check (no rate limit): < 1 second
- Rate limit detected + switch: < 5 seconds
- Restoration: < 5 seconds

Check script performance:
```bash
time ./rate-limit-monitor.py
```

---

## Monitoring in Production

After deployment, monitor these:

```bash
# Watch for rate limit events
grep "RATE LIMIT DETECTED" ~/.openclaw/workspace/scripts/rate-limit-monitor.log

# Check switch frequency
grep "SWITCHING TO FALLBACK" ~/.openclaw/workspace/scripts/rate-limit-monitor.log | wc -l

# View current status
cat ~/.openclaw/workspace/scripts/.rate-limit-state.json | jq .

# Check cron execution
tail -f ~/.openclaw/workspace/scripts/cron.log
```

---

## Debugging Tips

1. **Enable verbose logging:** Edit script and add debug prints
2. **Run manually:** Execute script outside cron to see full output
3. **Check gateway health:** `openclaw gateway status`
4. **Verify API keys:** Both Claude and GPT-4o must be configured
5. **Check disk space:** Ensure logs can be written
6. **Review permissions:** All scripts must be executable

---

## Production Readiness Checklist

Before going live:

- [ ] All tests passing
- [ ] Cron job configured (every 5 minutes)
- [ ] WhatsApp notifications working (or disabled if not available)
- [ ] Logs rotating (consider logrotate setup)
- [ ] Monitoring dashboard or alerts configured
- [ ] Both API keys valid and funded
- [ ] Gateway stable and running
- [ ] Backup/restore procedure documented
- [ ] Team notified of the system

---

## Next Steps

Once all tests pass:

1. Configure proper cron interval (every 5 minutes)
2. Set up log rotation if needed
3. Configure monitoring/alerting
4. Document for your team
5. Monitor for first few days

**System is ready for production! 🚀**
