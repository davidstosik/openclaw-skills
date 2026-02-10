# OpenClaw Tools

Public collection of skills and scripts for OpenClaw.

## Structure

```
openclaw-tools/
├── project-tracker/           # Skill: Track life projects with context
└── scripts/
    └── rate-limit-auto-switch/  # Auto-failover when Claude hits rate limits
```

## Skills

### project-tracker
Track ongoing life projects with implicit context detection and conversation capture.

**Installation:**
```bash
openclaw skills install project-tracker.skill
```

## Scripts

### rate-limit-auto-switch
Automatically detect Claude API rate limits, switch to GPT-4o, and restore when limit expires.

**Installation:**
```bash
cd scripts/rate-limit-auto-switch
./install.sh
```

See individual directories for detailed documentation.
