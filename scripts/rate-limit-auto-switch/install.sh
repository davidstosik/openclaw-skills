#!/bin/bash
# Automated installer for Rate Limit Auto-Switch System
# Run this script to set up the monitoring system

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  Rate Limit Auto-Switch System - Installer                ║"
echo "║  Automatically switches between Claude and GPT-4o          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Configuration
SCRIPTS_DIR="$HOME/.openclaw/workspace/scripts"
MONITOR_SCRIPT="$SCRIPTS_DIR/rate-limit-monitor.py"
NOTIFY_SCRIPT="$SCRIPTS_DIR/send-notification.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
}

info() {
    echo -e "  $1"
}

# Check prerequisites
echo "Checking prerequisites..."

# Check OpenClaw
if ! command -v openclaw &> /dev/null; then
    error "OpenClaw not found. Please install OpenClaw first."
    exit 1
fi
success "OpenClaw installed"

# Check Python
if ! command -v python3 &> /dev/null; then
    error "Python 3 not found. Please install Python 3.7+."
    exit 1
fi
PYTHON_VERSION=$(python3 --version | grep -oP '\d+\.\d+')
success "Python $PYTHON_VERSION installed"

# Check gateway status
if ! openclaw gateway status &> /dev/null; then
    warning "OpenClaw gateway not running. Attempting to start..."
    openclaw gateway start || {
        error "Failed to start gateway. Please start it manually: openclaw gateway start"
        exit 1
    }
    sleep 2
fi
success "OpenClaw gateway running"

# Check scripts exist
echo ""
echo "Checking scripts..."

if [[ ! -f "$MONITOR_SCRIPT" ]]; then
    error "Monitor script not found at: $MONITOR_SCRIPT"
    exit 1
fi
success "Monitor script found"

if [[ ! -f "$NOTIFY_SCRIPT" ]]; then
    warning "Notification script not found (optional)"
else
    success "Notification script found"
fi

# Make scripts executable
echo ""
echo "Setting up scripts..."
chmod +x "$MONITOR_SCRIPT" || error "Failed to make monitor script executable"
success "Monitor script is executable"

if [[ -f "$NOTIFY_SCRIPT" ]]; then
    chmod +x "$NOTIFY_SCRIPT"
    success "Notification script is executable"
fi

# Run a test
echo ""
echo "Running test..."
cd "$SCRIPTS_DIR"

if ./rate-limit-monitor.py > /tmp/rlm-test.log 2>&1; then
    success "Test passed - script runs without errors"
else
    error "Test failed - check /tmp/rlm-test.log for details"
    cat /tmp/rlm-test.log
    exit 1
fi

# Check current model
echo ""
echo "Checking current configuration..."
CURRENT_MODEL=$(openclaw gateway config.get 2>/dev/null | grep -A5 '"agents"' | grep '"model"' || echo "unknown")
info "Current model: $CURRENT_MODEL"

# Offer to add cron job
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  CRON JOB SETUP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "To enable automatic monitoring, add this to your crontab:"
echo ""
echo -e "${GREEN}*/5 * * * * /usr/bin/python3 $MONITOR_SCRIPT >> $SCRIPTS_DIR/cron.log 2>&1${NC}"
echo ""
read -p "Would you like to add this cron job now? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -q "rate-limit-monitor.py"; then
        warning "Cron job already exists. Skipping..."
    else
        # Add cron job
        (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/bin/python3 $MONITOR_SCRIPT >> $SCRIPTS_DIR/cron.log 2>&1") | crontab -
        success "Cron job added successfully"
        
        # Verify
        if crontab -l | grep -q "rate-limit-monitor.py"; then
            success "Cron job verified"
        else
            error "Cron job verification failed"
        fi
    fi
else
    info "Skipping cron setup. You can add it manually later."
    info "Run: crontab -e"
fi

# Test mode option
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TEST MODE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
read -p "Would you like to run a test simulation now? [y/N] " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    info "Running test simulation (will switch to GPT-4o)..."
    ./rate-limit-monitor.py --test
    
    echo ""
    info "Test complete! Check the logs:"
    info "  cat $SCRIPTS_DIR/rate-limit-monitor.log"
    echo ""
    
    read -p "Restore to primary model (Claude)? [Y/n] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        ./rate-limit-monitor.py --restore
        success "Restored to primary model"
    fi
fi

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  INSTALLATION COMPLETE                                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
success "Rate Limit Auto-Switch system is ready!"
echo ""
echo "Next steps:"
info "1. Monitor logs: tail -f $SCRIPTS_DIR/cron.log"
info "2. Check status: cat $SCRIPTS_DIR/.rate-limit-state.json | jq ."
info "3. Read docs: cat $SCRIPTS_DIR/QUICK-REFERENCE.md"
echo ""
echo "Commands:"
info "  Test:    $MONITOR_SCRIPT --test"
info "  Restore: $MONITOR_SCRIPT --restore"
info "  Status:  cat $SCRIPTS_DIR/.rate-limit-state.json"
echo ""
echo "Documentation:"
info "  Installation:     $SCRIPTS_DIR/INSTALL.md"
info "  Testing:          $SCRIPTS_DIR/TEST.md"
info "  Quick Reference:  $SCRIPTS_DIR/QUICK-REFERENCE.md"
echo ""
echo "Happy monitoring! 🚀"
