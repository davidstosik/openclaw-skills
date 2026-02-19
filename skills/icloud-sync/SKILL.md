---
name: icloud-sync
description: Sync the OpenClaw state directory (~/.openclaw/) to iCloud Drive in near-real-time using launchd WatchPaths + rsync. Use when setting up iCloud backup for OpenClaw, checking sync status, diagnosing sync issues, or switching machines.
---

# iCloud Sync

Syncs `$STATE_DIR/` → `iCloud/Documents/OpenClaw/dot_openclaw/` using launchd `WatchPaths` (FSEvents) + `/usr/bin/rsync` directly. Near-instant on change. No bash wrapper — rsync is the responsible process for TCC.

## Prerequisite

`/usr/bin/rsync` must have **Full Disk Access**:  
System Settings → Privacy & Security → Full Disk Access → `+` → `/usr/bin/rsync`  
(Use `⌘⇧G` in the file picker to type the path.)

## Install

```bash
bash ~/.openclaw/workspace/skills/icloud-sync/scripts/install.sh
```

Detects `OPENCLAW_STATE_DIR` (falls back to `~/.openclaw/`). Generates the launchd plist with correct paths, copies to `~/Library/LaunchAgents/`, and loads it.

## Uninstall

```bash
bash ~/.openclaw/workspace/skills/icloud-sync/scripts/uninstall.sh
```

## Check Status

```bash
launchctl list | grep openclaw.rsync-icloud
# PID column: - = not running (waiting for change), number = running
# Exit code 0 = last run succeeded
```

Log: `~/Library/Logs/openclaw-rsync-icloud.log` (outside state dir — avoids WatchPaths loop)

## How It Works

- `WatchPaths` fires rsync whenever any file in the state dir changes
- rsync calls are coalesced by launchd (burst changes → one sync pass)
- `--delete` keeps iCloud in sync with deletions
- `RunAtLoad` runs an initial sync on install/reboot
- The generated plist lives at `~/Library/LaunchAgents/com.openclaw.rsync-icloud.plist`

## Notes

- Do NOT point `OPENCLAW_STATE_DIR` directly at the iCloud path — gateway startup fails (iCloud file locks + on-demand hydration)
- The iCloud destination is `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/OpenClaw/dot_openclaw/`
- Log lives in `~/Library/Logs/` (not inside state dir) to avoid an infinite WatchPaths loop where rsync writes the log → triggers rsync → writes log again
