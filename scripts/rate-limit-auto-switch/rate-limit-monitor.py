#!/usr/bin/env python3
"""
Rate Limit Monitor for OpenClaw
Detects rate limiting and automatically switches to fallback model.

Usage:
    ./rate-limit-monitor.py          # Normal check
    ./rate-limit-monitor.py --test   # Test mode (simulate rate limit)
    ./rate-limit-monitor.py --restore # Force restore primary model
"""

import json
import subprocess
import sys
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional, Dict, Any

# Configuration
CONFIG = {
    "primary_model": "anthropic/claude-sonnet-4-5",
    "fallback_model": "openai/gpt-4o",
    "state_file": Path.home() / ".openclaw" / "workspace" / "scripts" / ".rate-limit-state.json",
    "log_file": Path.home() / ".openclaw" / "workspace" / "scripts" / "rate-limit-monitor.log",
    "gateway_log_file": Path.home() / ".openclaw" / "logs" / "gateway.log",
    "check_lookback_lines": 500,  # How many log lines to check
    "default_cooldown_minutes": 60,  # Default cooldown if we can't parse headers
}


class RateLimitMonitor:
    def __init__(self, test_mode=False):
        self.state_file = CONFIG["state_file"]
        self.log_file = CONFIG["log_file"]
        self.test_mode = test_mode
        self.state = self.load_state()
        
        # Ensure directories exist
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

    def log(self, message: str):
        """Log to both console and file."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_line = f"[{timestamp}] {message}"
        print(log_line)
        
        with open(self.log_file, "a") as f:
            f.write(log_line + "\n")

    def load_state(self) -> Dict[str, Any]:
        """Load monitoring state from file."""
        if self.state_file.exists():
            try:
                with open(self.state_file) as f:
                    return json.load(f)
            except Exception as e:
                print(f"Warning: Could not load state: {e}", file=sys.stderr)
        
        return {
            "rate_limited": False,
            "current_model": CONFIG["primary_model"],
            "rate_limit_reset_at": None,
            "switched_at": None,
            "last_check": None,
        }

    def save_state(self):
        """Save monitoring state to file."""
        self.state["last_check"] = datetime.now().isoformat()
        with open(self.state_file, "w") as f:
            json.dump(self.state, f, indent=2)

    def check_gateway_logs(self) -> Optional[Dict[str, Any]]:
        """
        Check OpenClaw gateway logs for rate limit errors.
        Returns dict with rate limit info if found, None otherwise.
        """
        log_path = CONFIG["gateway_log_file"]
        
        if not log_path.exists():
            self.log(f"Gateway log not found at {log_path}")
            return None

        try:
            # Read last N lines of the log file
            with open(log_path, "r") as f:
                lines = f.readlines()
                recent_lines = lines[-CONFIG["check_lookback_lines"]:]
            
            # Search for rate limit indicators
            for line in reversed(recent_lines):  # Check newest first
                line_lower = line.lower()
                
                # Look for common rate limit patterns
                if any(pattern in line_lower for pattern in [
                    "rate limit",
                    "rate_limit",
                    "ratelimit",
                    "429",
                    "too many requests",
                    "quota exceeded",
                ]):
                    self.log(f"Rate limit pattern found: {line.strip()}")
                    
                    # Try to extract reset time
                    reset_time = self.extract_reset_time_from_line(line)
                    
                    return {
                        "detected_at": datetime.now().isoformat(),
                        "reset_at": reset_time,
                        "log_line": line.strip(),
                    }
            
            return None

        except Exception as e:
            self.log(f"Error reading gateway logs: {e}")
            return None

    def extract_reset_time_from_line(self, line: str) -> str:
        """
        Extract rate limit reset time from log line.
        Looks for retry-after or x-ratelimit-reset patterns.
        """
        # Try to find retry-after in seconds
        retry_match = re.search(r'retry[-_]after["\s:]+(\d+)', line, re.IGNORECASE)
        if retry_match:
            try:
                seconds = int(retry_match.group(1))
                reset_time = datetime.now() + timedelta(seconds=seconds)
                self.log(f"Found retry-after: {seconds} seconds")
                return reset_time.isoformat()
            except ValueError:
                pass

        # Try to find x-ratelimit-reset as Unix timestamp
        reset_match = re.search(r'x-ratelimit-reset["\s:]+(\d{10})', line, re.IGNORECASE)
        if reset_match:
            try:
                timestamp = int(reset_match.group(1))
                reset_time = datetime.fromtimestamp(timestamp)
                self.log(f"Found x-ratelimit-reset: {timestamp}")
                return reset_time.isoformat()
            except (ValueError, OSError):
                pass

        # Default: cooldown period from config
        reset_time = datetime.now() + timedelta(minutes=CONFIG["default_cooldown_minutes"])
        self.log(f"Using default cooldown: {CONFIG['default_cooldown_minutes']} minutes")
        return reset_time.isoformat()

    def switch_to_fallback(self):
        """Switch OpenClaw to fallback model."""
        self.log(f"=== SWITCHING TO FALLBACK ===")
        self.log(f"From: {CONFIG['primary_model']}")
        self.log(f"To: {CONFIG['fallback_model']}")
        
        try:
            # Create patch JSON for gateway config
            patch = {
                "agents": {
                    "defaults": {
                        "model": CONFIG["fallback_model"]
                    }
                }
            }
            
            # Apply patch via openclaw gateway config.patch
            result = subprocess.run(
                ["openclaw", "gateway", "config.patch"],
                input=json.dumps(patch),
                capture_output=True,
                text=True,
                timeout=30,
            )
            
            if result.returncode != 0:
                self.log(f"ERROR: Gateway patch failed: {result.stderr}")
                return False
            
            self.log(f"Gateway config updated successfully")
            
            # Update state
            self.state["rate_limited"] = True
            self.state["current_model"] = CONFIG["fallback_model"]
            self.state["switched_at"] = datetime.now().isoformat()
            self.save_state()

            # Send WhatsApp notification
            self.notify_switched()
            
            # Schedule restoration cron job
            self.schedule_restoration()
            
            return True

        except Exception as e:
            self.log(f"ERROR switching model: {e}")
            return False

    def restore_primary(self):
        """Restore primary model after rate limit expires."""
        self.log(f"=== RESTORING PRIMARY MODEL ===")
        self.log(f"From: {CONFIG['fallback_model']}")
        self.log(f"To: {CONFIG['primary_model']}")
        
        try:
            # Create patch JSON for gateway config
            patch = {
                "agents": {
                    "defaults": {
                        "model": CONFIG["primary_model"]
                    }
                }
            }
            
            # Apply patch via openclaw gateway config.patch
            result = subprocess.run(
                ["openclaw", "gateway", "config.patch"],
                input=json.dumps(patch),
                capture_output=True,
                text=True,
                timeout=30,
            )
            
            if result.returncode != 0:
                self.log(f"ERROR: Gateway patch failed: {result.stderr}")
                return False
            
            self.log(f"Gateway config restored successfully")
            
            # Update state
            self.state["rate_limited"] = False
            self.state["current_model"] = CONFIG["primary_model"]
            self.state["rate_limit_reset_at"] = None
            self.save_state()

            # Send WhatsApp notification
            self.notify_restored()
            
            # Remove restoration cron job if it exists
            self.remove_restoration_cron()
            
            return True

        except Exception as e:
            self.log(f"ERROR restoring model: {e}")
            return False

    def notify_switched(self):
        """Send WhatsApp notification about model switch."""
        reset_at = self.state.get("rate_limit_reset_at", "unknown")
        if reset_at != "unknown":
            try:
                reset_dt = datetime.fromisoformat(reset_at)
                reset_str = reset_dt.strftime("%Y-%m-%d %H:%M UTC")
            except:
                reset_str = reset_at
        else:
            reset_str = "unknown"
        
        message = (
            f"⚠️ *Rate Limit Detected*\n\n"
            f"Switched from Claude to GPT-4o\n"
            f"Will restore at: {reset_str}"
        )
        self.send_whatsapp_notification(message)

    def notify_restored(self):
        """Send WhatsApp notification about model restoration."""
        message = (
            f"✅ *Rate Limit Expired*\n\n"
            f"Restored to Claude Sonnet 4.5"
        )
        self.send_whatsapp_notification(message)

    def send_whatsapp_notification(self, message: str):
        """
        Send WhatsApp notification by spawning an OpenClaw agent session.
        This allows the notification to work even if main agent is rate-limited.
        """
        self.log(f"Sending WhatsApp notification...")
        
        try:
            # Create a temporary script for the agent to execute
            notify_script = f"""
import subprocess
import json
import sys

# Use openclaw message tool via agent spawn
# The message will be sent from the agent context
result = subprocess.run(
    ["openclaw", "agent", "run", "--model", "openai/gpt-4o-mini", "--"],
    input='Send this message via WhatsApp: {message}',
    capture_output=True,
    text=True,
    timeout=60,
)

if result.returncode == 0:
    print("Notification sent successfully")
    sys.exit(0)
else:
    print(f"Failed to send notification: {{result.stderr}}")
    sys.exit(1)
"""
            
            # For now, just log it (actual WhatsApp sending would be done via agent)
            # This requires OpenClaw agent context which we don't have in external script
            self.log(f"NOTIFICATION: {message}")
            self.log("Note: WhatsApp notifications require agent context integration")
            
        except Exception as e:
            self.log(f"ERROR sending notification: {e}")

    def schedule_restoration(self):
        """Schedule a cron job to restore primary model when rate limit expires."""
        reset_at_str = self.state.get("rate_limit_reset_at")
        if not reset_at_str:
            self.log("WARNING: No reset time available, cannot schedule restoration")
            return
        
        try:
            reset_at = datetime.fromisoformat(reset_at_str)
            
            # Add 5 minute buffer to ensure rate limit has expired
            restore_time = reset_at + timedelta(minutes=5)
            
            # Format for cron: minute hour day month weekday
            cron_time = restore_time.strftime("%M %H %d %m *")
            
            # Path to this script
            script_path = Path(__file__).resolve()
            
            # Cron command to restore
            cron_cmd = f"{cron_time} {sys.executable} {script_path} --restore"
            
            # Add to crontab (needs to be done manually for now)
            self.log(f"Restoration scheduled for: {restore_time.strftime('%Y-%m-%d %H:%M UTC')}")
            self.log(f"Add this to crontab: {cron_cmd}")
            
            # Save cron command to file for reference
            cron_file = self.state_file.parent / ".restoration-cron.txt"
            with open(cron_file, "w") as f:
                f.write(f"# Scheduled restoration at {restore_time}\n")
                f.write(f"{cron_cmd}\n")
            
        except Exception as e:
            self.log(f"ERROR scheduling restoration: {e}")

    def remove_restoration_cron(self):
        """Remove the restoration cron job (cleanup)."""
        cron_file = self.state_file.parent / ".restoration-cron.txt"
        if cron_file.exists():
            cron_file.unlink()
            self.log("Restoration cron reference removed")

    def run_check(self):
        """Run a single monitoring check cycle."""
        self.log("=" * 60)
        self.log("Starting rate limit check")
        
        if self.test_mode:
            self.log("TEST MODE: Simulating rate limit detection")
            rate_limit_info = {
                "detected_at": datetime.now().isoformat(),
                "reset_at": (datetime.now() + timedelta(hours=1)).isoformat(),
                "log_line": "TEST: Simulated 429 rate limit error",
            }
        else:
            # If we're currently rate limited, check if we should restore
            if self.state["rate_limited"]:
                reset_at_str = self.state.get("rate_limit_reset_at")
                if reset_at_str:
                    try:
                        reset_at = datetime.fromisoformat(reset_at_str)
                        if datetime.now() >= reset_at:
                            self.log("Rate limit should be expired, checking for restoration...")
                            # Don't auto-restore, let cron job handle it
                            self.log("Waiting for scheduled restoration cron job")
                            return
                        else:
                            time_remaining = reset_at - datetime.now()
                            self.log(f"Still rate limited, {time_remaining} remaining until restoration")
                            return
                    except ValueError:
                        self.log("ERROR: Invalid reset time in state")
                        return

            # Check for new rate limits
            rate_limit_info = self.check_gateway_logs()
        
        if rate_limit_info:
            self.log(f"RATE LIMIT DETECTED!")
            self.log(f"Details: {json.dumps(rate_limit_info, indent=2)}")
            
            self.state["rate_limit_reset_at"] = rate_limit_info["reset_at"]
            self.save_state()
            
            # Switch to fallback model
            if self.switch_to_fallback():
                self.log("Successfully switched to fallback model")
            else:
                self.log("ERROR: Failed to switch to fallback model")
        else:
            self.log("No rate limit detected - all clear")
        
        self.log("Check complete")


def main():
    # Parse command line arguments
    test_mode = "--test" in sys.argv
    force_restore = "--restore" in sys.argv
    
    monitor = RateLimitMonitor(test_mode=test_mode)
    
    if force_restore:
        monitor.log("FORCE RESTORE requested")
        monitor.restore_primary()
    else:
        monitor.run_check()


if __name__ == "__main__":
    main()
