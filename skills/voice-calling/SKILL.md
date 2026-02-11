# Voice Calling Skill

AI-powered voice calling using Vapi.ai platform.

## What This Skill Does

Enables making and receiving phone calls with AI voice assistants that can:
- Have natural conversations in 100+ languages
- Understand speech and respond intelligently
- Integrate with your systems via API
- Handle complex conversational workflows

## When to Use

- **Voice customer support** - 24/7 automated support calls
- **Appointment scheduling** - Book appointments via phone
- **Lead qualification** - Outbound sales calls
- **Surveys and feedback** - Automated phone surveys
- **Notifications and reminders** - Proactive outbound calls
- **Voice widgets** - In-app voice interfaces

## Quick Start

### Prerequisites
- Vapi.ai account (https://dashboard.vapi.ai/)
- Payment method (pay-per-use pricing)
- Phone number (optional - can test with web calling first)

### Installation
```bash
cd skills/voice-calling
npm install
cp .env.example .env
# Edit .env with your Vapi API key
```

### Test It
```bash
# Web calling (free):
npm run test:web

# Real phone call:
npm test
```

## Configuration

Edit `.env` file:

```env
VAPI_API_KEY=your_key_here
WIFE_PHONE=+81XXXXXXXXXX
```

## Key Features

### Multilingual Support
- 100+ languages supported
- Optimized Japanese voice configuration included
- Auto language detection available

### Voice Providers
- **Azure** (recommended for Japanese)
- **ElevenLabs** (most natural, higher cost)
- **PlayHT** (good middle ground)
- **Deepgram** (for transcription)

### Models
- GPT-4, GPT-4-turbo
- Claude (via Anthropic)
- Custom models supported

## Cost Structure

Typical 3-minute call:
- Transcription: ~$0.01
- LLM processing: ~$0.10-0.20
- Voice synthesis: ~$0.05
- Phone calling: ~$0.10-0.30
- **Total: ~$0.26-0.56 per 3-min call**

Web calling (browser-to-browser): **FREE**

## Examples

### Example 1: Simple Japanese Assistant
```javascript
const assistant = await vapi.assistants.create({
  name: 'Japanese Assistant',
  firstMessage: 'もしもし、こんにちは。',
  voice: {
    provider: 'azure',
    voiceId: 'ja-JP-NanamiNeural',
  },
  model: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    messages: [{
      role: 'system',
      content: 'You are a helpful Japanese assistant.',
    }],
  },
});
```

### Example 2: Make Outbound Call
```javascript
const call = await vapi.calls.create({
  assistantId: assistant.id,
  customer: { number: '+81XXXXXXXXXX' },
});
```

### Example 3: Monitor Call
```javascript
const call = await vapi.calls.get(callId);
console.log(call.transcript); // Full conversation
console.log(call.cost); // Total cost
```

## Files

- `README.md` - Full documentation
- `.env.example` - Configuration template
- `package.json` - Dependencies
- `examples/test-call-wife.js` - Japanese test call script

## Integration with OpenClaw

Use in your agent code:

```javascript
const voiceCalling = require('./skills/voice-calling/examples/test-call-wife.js');

// Make a call
const call = await voiceCalling.makeCall(assistantId);

// Wait for result
const result = await voiceCalling.waitForCallCompletion(call.id);

// Process transcript
console.log(result.transcript);
```

## Troubleshooting

See `../../projects/vapi-troubleshooting.md` for common issues and fixes.

## Current Status

**Ready for:** Tonight's Japanese test call  
**Tested with:** Dashboard configuration (web calling)  
**Next steps:** Real phone call test, then clinic assistant build

## Resources

- Main Guide: `../../projects/vapi-setup-tonight.md`
- Quick Checklist: `../../projects/vapi-quick-checklist.md`
- Troubleshooting: `../../projects/vapi-troubleshooting.md`
- Vapi Docs: https://docs.vapi.ai
- Vapi Dashboard: https://dashboard.vapi.ai

## Notes

- **Web calling is FREE** - always test there first
- **Japanese voices** - Azure ja-JP-NanamiNeural recommended
- **Cost control** - Set maxDurationSeconds to limit call length
- **Test before production** - Always test with yourself first

---

*Created: 2026-02-11*  
*Status: Ready for testing*
