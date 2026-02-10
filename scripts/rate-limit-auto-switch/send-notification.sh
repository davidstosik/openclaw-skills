#!/bin/bash
# Send notification via OpenClaw agent (auto-routes to active channel)
# This script spawns an isolated agent session to send notifications
# Supports: WhatsApp, iMessage, Telegram, Discord, etc.
# Usage: ./send-notification.sh "Your message here"

set -e

MESSAGE="${1:-}"

if [[ -z "$MESSAGE" ]]; then
    echo "Usage: $0 \"message text\""
    exit 1
fi

# Create temporary file with agent instructions
TMPFILE=$(mktemp)
cat > "$TMPFILE" << EOF
Send this notification message to the main user (via whatever channel is currently active):

$MESSAGE

Use the message tool to deliver this notification. The message will automatically route to the correct channel (WhatsApp, iMessage, Telegram, etc.). Keep it brief, just send the message.
EOF

echo "[$(date)] Sending notification via agent (auto-routing to active channel)..."

# Spawn OpenClaw agent with GPT-4o-mini (cheap, fast, always available)
# Use isolated session so it doesn't interfere with main agent
openclaw agent run \
    --model "openai/gpt-4o-mini" \
    --label "notification-sender" \
    --prompt "$(cat $TMPFILE)" \
    2>&1 | tee -a "$HOME/.openclaw/workspace/scripts/notification-sender.log"

EXIT_CODE=$?

rm -f "$TMPFILE"

if [[ $EXIT_CODE -eq 0 ]]; then
    echo "Notification sent successfully"
else
    echo "Failed to send notification (exit code: $EXIT_CODE)"
fi

exit $EXIT_CODE
