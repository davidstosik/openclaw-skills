#!/bin/bash
# install.sh — Set up OpenClaw iCloud sync via launchd WatchPaths + rsync
# Prereq: /usr/bin/rsync must have Full Disk Access in System Settings
set -euo pipefail

PLIST_LABEL="com.openclaw.rsync-icloud"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
ICLOUD_DEST="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Documents/OpenClaw/dot_openclaw/"
LOG_FILE="$HOME/Library/Logs/openclaw-rsync-icloud.log"

echo "OpenClaw iCloud Sync Installer"
echo "  State dir:   $STATE_DIR"
echo "  Destination: $ICLOUD_DEST"
echo ""
echo "Prerequisite: /usr/bin/rsync must have Full Disk Access."
echo "  System Settings → Privacy & Security → Full Disk Access → + → /usr/bin/rsync"
echo ""
read -r -p "Have you granted Full Disk Access to /usr/bin/rsync? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Please grant FDA first, then re-run this script."
    exit 1
fi

# Create dirs
mkdir -p "$ICLOUD_DEST"

# Generate plist with expanded paths (launchd doesn't expand shell vars)
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/rsync</string>
        <string>-a</string>
        <string>--delete</string>
        <string>--log-file=$LOG_FILE</string>
        <string>$STATE_DIR/</string>
        <string>$ICLOUD_DEST</string>
    </array>

    <!-- Fire on any change in state dir -->
    <key>WatchPaths</key>
    <array>
        <string>$STATE_DIR</string>
    </array>

    <!-- Also run on install/reboot -->
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
PLIST

# Load (unload first if already running)
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "✅ Installed: $PLIST_LABEL"
echo "   Plist: $PLIST_PATH"
echo "   Log:   $LOG_FILE"
