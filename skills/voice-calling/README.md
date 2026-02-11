# Voice Calling Skill (Vapi.ai)

Voice AI calling integration using Vapi.ai platform for making and receiving phone calls with AI assistants.

## Features

- 🗣️ Natural voice conversations in 100+ languages
- 📞 Inbound and outbound calling
- 🌐 Web-based calling (browser to browser)
- 🎌 Optimized for Japanese conversations
- 🔧 Fully configurable via API or Dashboard
- 📊 Real-time transcription and monitoring
- 💰 Pay-per-use pricing

## Quick Start

### Prerequisites

1. Node.js 18+ installed
2. Vapi.ai account (https://dashboard.vapi.ai/)
3. Phone number (optional - can test with web calling first)

### Installation

```bash
cd skills/voice-calling
npm install
```

### Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Edit `.env` and add your credentials:
```env
VAPI_API_KEY=your_api_key_here
WIFE_PHONE=+81XXXXXXXXXX
```

3. Get your API key:
   - Go to https://dashboard.vapi.ai/
   - Settings → API Keys → Create API Key

### Test Run (Web Calling - FREE)

Test without making a real phone call:

```bash
npm run test:web
```

This will:
1. Create a Japanese voice assistant
2. Give you an assistant ID
3. Tell you to test it in the dashboard via web calling

### Real Phone Call

Once you've tested via web and are ready:

```bash
npm test
# or
node examples/test-call-wife.js
```

## Project Structure

```
skills/voice-calling/
├── .env.example          # Environment configuration template
├── package.json          # Node.js dependencies
├── README.md            # This file
├── examples/
│   └── test-call-wife.js  # Japanese test call script
└── recordings/          # Call recordings saved here
    └── transcripts/     # Transcripts saved here
```

## Usage Examples

### Example 1: Create Assistant Programmatically

```javascript
const Vapi = require('@vapi-ai/server-sdk');

const vapi = new Vapi({ apiKey: process.env.VAPI_API_KEY });

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
      content: 'You are a helpful Japanese voice assistant.',
    }],
  },
});
```

### Example 2: Make Outbound Call

```javascript
const call = await vapi.calls.create({
  assistantId: 'asst_xxxxx',
  customer: {
    number: '+81XXXXXXXXXX',
  },
});
```

### Example 3: Monitor Call Status

```javascript
const call = await vapi.calls.get('call_xxxxx');
console.log(call.status); // 'queued', 'ringing', 'in-progress', 'ended'
console.log(call.transcript); // Full conversation
console.log(call.cost); // Total cost in USD
```

## Voice Options

### Recommended Japanese Voices (Azure)

- **ja-JP-NanamiNeural** (Female) - Most natural, recommended for wife call
- **ja-JP-KeitaNeural** (Male) - Natural male voice
- **ja-JP-MayuNeural** (Female) - Slightly higher pitch
- **ja-JP-NaokiNeural** (Male) - Deep male voice

### Testing Different Voices

Edit the assistant configuration in dashboard or update `voiceId` in code:

```javascript
voice: {
  provider: 'azure',
  voiceId: 'ja-JP-KeitaNeural', // Try different voices
  speed: 1.0, // Adjust speed: 0.8 (slower) to 1.2 (faster)
}
```

## Cost Estimation

For a 3-minute call:

| Component | Provider | Cost/min | 3-min Total |
|-----------|----------|----------|-------------|
| Transcription | Deepgram | $0.004 | $0.012 |
| LLM | GPT-4-turbo | ~$0.05 | ~$0.15 |
| Voice | Azure TTS | $0.016 | $0.048 |
| Phone | Vapi/Twilio | $0.03-$0.10 | $0.09-$0.30 |
| **Total** | | | **$0.30-$0.51** |

**Free options:**
- Web calling (browser to browser): FREE
- Dashboard testing: FREE

## Troubleshooting

### "Call doesn't connect"

- Verify phone number format: `+81XXXXXXXXXX` (E.164 format)
- Check Vapi account has payment method configured
- Try web calling first to isolate phone issues

### "Voice sounds robotic"

- Try different voice: `ja-JP-MayuNeural` or others
- Adjust speed: Try 0.9 or 1.1
- Use GPT-4 instead of GPT-3.5 (better natural language)

### "High latency (slow responses)"

- Use Deepgram transcriber (fastest)
- Use GPT-4-turbo (faster than GPT-4)
- Simplify system prompt (less processing)

### "Doesn't understand Japanese"

- Verify transcriber language is set to `ja` (Japanese)
- Use GPT-4 (better multilingual support)
- Speak clearly and at normal pace

## Integration with OpenClaw

This skill can be integrated with OpenClaw agent for automated calling:

```javascript
// In your OpenClaw skill:
const voiceCalling = require('./skills/voice-calling/examples/test-call-wife.js');

// Make a call
const call = await voiceCalling.makeCall(assistantId);

// Wait for completion
const result = await voiceCalling.waitForCallCompletion(call.id);

// Process results
console.log('Transcript:', result.transcript);
```

## API Reference

### Environment Variables

See `.env.example` for all available configuration options.

### Key Functions

- `createAssistant()` - Create a new voice assistant
- `makeCall(assistantId)` - Initiate outbound call
- `getCallStatus(callId)` - Check call status
- `waitForCallCompletion(callId)` - Wait for call to end and get results

## Additional Resources

- **Vapi Documentation**: https://docs.vapi.ai
- **Vapi Dashboard**: https://dashboard.vapi.ai
- **Community Discord**: https://discord.gg/vapi
- **Azure Voices**: https://learn.microsoft.com/azure/ai-services/speech-service/language-support

## Tonight's Test Call Guide

See detailed setup guide: `../../projects/vapi-setup-tonight.md`

This includes:
- Step-by-step setup instructions
- Pre-flight checklist
- Test scenario design
- Post-call evaluation template
- Troubleshooting guide
- Cost analysis

## License

MIT

## Support

For issues or questions:
1. Check `projects/vapi-setup-tonight.md` for detailed troubleshooting
2. Review Vapi documentation: https://docs.vapi.ai
3. Join Vapi Discord: https://discord.gg/vapi

---

**Last updated**: 2026-02-11  
**Status**: Ready for tonight's test call  
**Next**: Follow `projects/vapi-setup-tonight.md` guide
