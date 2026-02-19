#!/bin/bash
# rsync-icloud.sh — Syncs ~/.openclaw/ to iCloud Drive
#
# NOTE: launchd calls rsync DIRECTLY (not this script) to avoid TCC issues.
# This script is for manual use / documentation only.
#
# Active plist:  ~/Library/LaunchAgents/com.openclaw.rsync-icloud.plist
# Source:        ~/.openclaw/workspace/launchd/com.openclaw.rsync-icloud.plist
# Runs every:    10 minutes
# Log:           ~/.openclaw/logs/rsync-icloud.log

SRC="$HOME/.openclaw/"
DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents/OpenClaw/dot_openclaw/"
LOG="$HOME/.openclaw/logs/rsync-icloud.log"

/usr/bin/rsync -a --delete \
  --log-file="$LOG" \
  "$SRC" "$DEST"
