#!/bin/bash
# uninstall.sh — Remove OpenClaw iCloud sync launchd agent
set -euo pipefail

PLIST_LABEL="com.openclaw.rsync-icloud"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

launchctl unload "$PLIST_PATH" 2>/dev/null && echo "Unloaded $PLIST_LABEL" || echo "(not loaded)"
rm -f "$PLIST_PATH" && echo "Removed $PLIST_PATH"
echo "✅ Uninstalled"
