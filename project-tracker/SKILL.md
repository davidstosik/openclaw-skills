---
name: project-tracker
description: Track ongoing life projects, capture conversations, notes, decisions, and context across multiple topics. Use when the user mentions existing projects, wants to create/list/view projects, asks to add notes or save conversation to a project, or when discussing topics that map to known projects (homelab, books, goals, investments, etc.). Maintains continuity across sessions without requiring explicit context switching.
---

# Project Tracker

Track ongoing life projects with conversation capture, notes, and context management. Designed for maintaining continuity across multiple projects in a flat linear chat without explicit switching.

## Core Operations

### 1. List Projects

Show all projects with basic info.

**Triggers:**
- "What projects am I working on?"
- "List my projects"
- "Show projects"

**Implementation:**
```bash
ls -1 projects/*.md | sed 's|projects/||' | sed 's|\.md$||'
```

Display as a readable list with project names extracted from frontmatter.

### 2. Create Project

Start tracking a new project.

**Triggers:**
- "Create a project for [topic]"
- "Start tracking [project name]"
- User mentions a new ongoing initiative

**Template:**
```markdown
---
name: [Project Name]
created: [YYYY-MM-DD]
status: active
tags: [relevant, tags]
---

# Overview
[Brief description of the project]

# Sessions

## [YYYY-MM-DD HH:MM UTC] - [Session Title]
[Initial notes]
```

**File naming:** Slugify the project name (lowercase, hyphens, alphanumeric).

### 3. View Project

Display project details and all captured content.

**Triggers:**
- "Show me the [project name] project"
- "What have we discussed about [project]?"
- "View [project] notes"

**Implementation:** Read and display the markdown file, formatted for readability.

### 4. Add Note (Explicit)

User explicitly requests adding a note to a project.

**Triggers:**
- "Add a note to [project]: [text]"
- "Note for [project]: [text]"
- "Remember this for [project]: [text]"

**Format:**
```markdown
## [YYYY-MM-DD HH:MM UTC] - Quick Note
[User's text]
```

Append to the project file under a new timestamped section.

### 5. Capture Conversation (Explicit)

User asks to save recent conversation to a project.

**Triggers:**
- "Save this conversation to [project]"
- "Capture these notes to [project]"
- "Add this to [project]"

**Behavior:**
- Look back at recent messages (last 5-10 exchanges)
- Summarize key points: questions asked, answers given, code written, decisions made
- Structure as a session entry

**Format:**
```markdown
## [YYYY-MM-DD HH:MM UTC] - [Generated Session Title]

**Summary:** [Brief overview of what was discussed]

**Key Points:**
- [Point 1]
- [Point 2]

**Q:** [User question]  
**A:** [Your answer]

**Code/Scripts:** [If any code was written]
\`\`\`language
[code]
\`\`\`

**Decisions:** [Any decisions made]

**Tasks:** [Any action items identified]
- [ ] Task 1
- [ ] Task 2
```

### 6. Implicit Context Detection

Monitor conversation for mentions of existing projects and track context automatically.

**Detection Strategy:**
- Read `projects/` at session start to know existing projects
- Match keywords/topics from user messages to project names and tags
- When detected, maintain awareness of "current project context"
- At natural breakpoints (topic shift, extended silence), optionally capture notes

**Natural breakpoints:**
- User switches topics
- Clear end of discussion on current topic
- Session ending

**Behavior at breakpoint:**
- Summarize what was discussed
- Optionally prompt: "Should I save these notes to [project]?"
- Or silently append if conversation was clearly project-focused

**Avoid over-capturing:** Only save substantive exchanges, not brief Q&A or off-topic chat.

### 7. Archive Project

Mark a project as complete or inactive.

**Triggers:**
- "Archive [project]"
- "Mark [project] as complete"

**Implementation:** Update frontmatter `status: archived` and optionally move to `projects/archive/`.

## Project File Structure

All projects live in `projects/` directory:

```
projects/
├── .current                    # (Optional) Tracks most recently active project
├── opnsense-ha.md
├── openclaw-setup.md
├── atomic-habits.md
├── couples-that-work.md
├── 5-year-goals.md
├── real-estate-japan.md
└── project-tracker.md          # Meta: tracking this skill's development
```

## Usage Patterns

**Natural flow (implicit):**
```
User: "I'm configuring CARP on my OPNsense routers"
You: [Detect: opnsense-ha project] "For CARP configuration..."
     [Track context, capture at breakpoint]
```

**Explicit commands:**
```
User: "Add note to real estate project: found interesting property in Shibuya"
You: [Append note to real-estate-japan.md]

User: "Save this conversation to the OpenClaw project"
You: [Capture last N exchanges and append to openclaw-setup.md]
```

**Creating projects:**
```
User: "I want to start tracking my Japanese study progress"
You: [Create projects/japanese-study.md]
```

## Guidelines

1. **Be context-aware:** Recognize when discussion relates to an existing project without requiring explicit switches.

2. **Capture meaningfully:** Save substantive exchanges, not trivial chat. Focus on:
   - Questions and answers
   - Code/scripts/instructions
   - Decisions and rationale
   - Action items
   - Research findings

3. **Act, don't ask:** When you notice something relevant to a project (limitations, decisions, findings, etc.), add it immediately and inform the user. Don't ask permission - just do it and tell them: "📝 Added notes to [project]"

4. **Use timestamps:** Always include UTC timestamps for new entries.

5. **Structure for readability:** Use markdown headers, lists, code blocks to make notes scannable.

6. **Meta-awareness:** This skill itself should be tracked in `projects/project-tracker.md`.

7. **Notify on capture:** Always inform the user when notes are added to a project: "📝 Added notes to [project]"

8. **Only active projects:** Only load active (status: active) projects into context. Completed or paused projects should only be accessed when explicitly requested.

## Initialization

On first use, create the `projects/` directory if it doesn't exist:

```bash
mkdir -p projects
```

The skill is immediately ready to use - no configuration required.