#!/bin/bash
# Switch OpenClaw model and notify via WhatsApp
# Usage: ./switch-model.sh [fallback|primary] [optional-message]

set -e

MODE="$1"
MESSAGE="${2:-}"

if [[ "$MODE" != "fallback" && "$MODE" != "primary" ]]; then
    echo "Usage: $0 [fallback|primary] [optional-message]"
    exit 1
fi

# Configuration
PRIMARY_MODEL="anthropic/claude-sonnet-4-5"
FALLBACK_MODEL="openai/gpt-4o"
WORKSPACE_DIR="$HOME/.openclaw/workspace"
STATE_FILE="$WORKSPACE_DIR/scripts/.rate-limit-state.json"

# Determine target model
if [[ "$MODE" == "fallback" ]]; then
    TARGET_MODEL="$FALLBACK_MODEL"
    DEFAULT_MSG="⚠️ Rate limit detected! Switched to GPT-4o"
else
    TARGET_MODEL="$PRIMARY_MODEL"
    DEFAULT_MSG="✅ Rate limit expired! Restored to Claude Sonnet 4.5"
fi

# Use provided message or default
NOTIFY_MSG="${MESSAGE:-$DEFAULT_MSG}"

echo "[$(date)] Switching to $TARGET_MODEL..."

# Create temp patch file
PATCH_FILE=$(mktemp)
cat > "$PATCH_FILE" << EOF
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "$TARGET_MODEL"
      }
    }
  }
}
EOF

# Apply patch via OpenClaw (this needs to be run in a way that OpenClaw can access)
# For now, output the command that needs to be run
echo "Patch file created at: $PATCH_FILE"
echo "Apply with: cat $PATCH_FILE | openclaw gateway config.patch"

# Update state file
if [[ -f "$STATE_FILE" ]]; then
    # Update existing state
    jq ".current_model = \"$TARGET_MODEL\" | .rate_limited = $([ "$MODE" == "fallback" ] && echo "true" || echo "false")" "$STATE_FILE" > "${STATE_FILE}.tmp"
    mv "${STATE_FILE}.tmp" "$STATE_FILE"
else
    # Create new state
    mkdir -p "$(dirname "$STATE_FILE")"
    cat > "$STATE_FILE" << EOF
{
  "current_model": "$TARGET_MODEL",
  "rate_limited": $([ "$MODE" == "fallback" ] && echo "true" || echo "false")
}
EOF
fi

echo "State updated: $STATE_FILE"
echo "Notification message: $NOTIFY_MSG"

# TODO: Send WhatsApp notification
# This would need to call openclaw's message functionality
# For now, just log it
echo "$NOTIFY_MSG" >> "$WORKSPACE_DIR/scripts/rate-limit-notifications.log"

rm -f "$PATCH_FILE"
echo "Done!"
