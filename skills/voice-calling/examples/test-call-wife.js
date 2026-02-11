#!/usr/bin/env node

/**
 * Vapi.ai Test Call Script - Wife (Japanese Conversation)
 * 
 * This script demonstrates how to:
 * 1. Create a Japanese voice assistant programmatically
 * 2. Make a test call via Vapi API
 * 3. Monitor call status
 * 4. Retrieve transcript and recording
 * 
 * Prerequisites:
 * - Node.js installed
 * - npm install @vapi-ai/server-sdk dotenv
 * - .env file configured (see .env.example)
 * 
 * Usage:
 *   # Web test (free):
 *   WEB_CALLING_ONLY=true node test-call-wife.js
 * 
 *   # Real phone call:
 *   node test-call-wife.js
 * 
 * Author: David
 * Date: 2026-02-11
 */

require('dotenv').config();
const { VapiClient } = require('@vapi-ai/server-sdk');

// Configuration from environment
const config = {
  apiKey: process.env.VAPI_API_KEY,
  wifePhone: process.env.WIFE_PHONE,
  myPhone: process.env.MY_PHONE,
  assistantId: process.env.TEST_ASSISTANT_ID,
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
  webCallingOnly: process.env.WEB_CALLING_ONLY === 'true',
  debugMode: process.env.DEBUG_MODE === 'true',
};

// Validate configuration
if (!config.apiKey) {
  console.error('❌ Error: VAPI_API_KEY not set in .env file');
  process.exit(1);
}

if (!config.webCallingOnly && !config.wifePhone) {
  console.error('❌ Error: WIFE_PHONE not set in .env file');
  console.log('💡 Tip: Set WEB_CALLING_ONLY=true to test via web first');
  process.exit(1);
}

// Initialize Vapi client
const vapi = new VapiClient({
  token: config.apiKey,
});

// Japanese assistant configuration
const japaneseAssistantConfig = {
  name: 'Real Estate Inquiry - Tanaka',
  
  // First message in Japanese
  firstMessage: 'もしもし、つばめ不動産でしょうか。田中と申します。廣川の秘書をしております。物件番号MR-2458についてお伺いしたいのですが、今、お時間よろしいでしょうか。',
  
  // Voice configuration (Azure Japanese)
  voice: {
    provider: 'azure',
    voiceId: 'ja-JP-NanamiNeural',
    speed: 1.0,
    cachingEnabled: true,
  },
  
  // Model configuration
  model: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: `You are a professional assistant for a real estate investor, calling to inquire about a property in Japanese.

IDENTITY & CONTEXT:
- Your name: 田中 (Tanaka)
- You work as an assistant for: 廣川 (Hirokawa), a seasoned real estate investor
- You're calling about: Property #MR-2458
- This is a professional business inquiry to a real estate agency

CONVERSATION GOAL:
1. Introduce yourself politely (already done in first message)
2. Ask 2-3 brief questions about the property:
   - 築年数はどのくらいですか？ (How old is the building?)
   - 駅からの距離はどれくらいでしょうか？ (How far from the station?)
   - 内見は可能でしょうか？ (Is a viewing possible?)
3. Listen to responses and acknowledge naturally
4. Thank them and end professionally

LANGUAGE & TONE:
- Professional business Japanese (丁寧語 - polite form)
- Use です/ます consistently
- Be courteous and respectful
- Sound competent and experienced, not nervous
- Keep responses brief and professional
- Use appropriate business phrases: 恐れ入りますが、よろしくお願いします、etc.

IMPORTANT RULES:
- Keep the entire call under 2-3 minutes
- Stay on topic (property inquiry only)
- Don't ask overly complex questions
- Be respectful of their time
- If they don't have information, accept gracefully
- End professionally with thanks

RESPONSE STYLE:
- Brief acknowledgments: "承知しました", "なるほど", "ありがとうございます"
- Professional but not overly formal (avoid 謙譲語/尊敬語 extremes)
- Natural business conversation pace
- Take brief notes mentally and confirm understanding`,
      },
    ],
  },
  
  // Transcriber configuration (for Japanese)
  transcriber: {
    provider: 'deepgram',
    language: 'ja-JP',
    model: 'nova-2',
  },
  
  // Call configuration
  maxDurationSeconds: parseInt(process.env.MAX_CALL_DURATION || '180', 10),
  firstMessageMode: 'assistant-speaks-first',
  backgroundSound: 'off',
  
  // End call phrases (Japanese - professional)
  endCallPhrases: [
    'ありがとうございました',
    '失礼いたします',
    'それでは失礼します',
    'よろしくお願いします',
  ],
  
  // Recording and transcript
  artifactPlan: {
    recordingEnabled: true,
    transcriptPlan: {
      enabled: true,
      assistantName: 'Tanaka (Assistant)',
      userName: 'Real Estate Agency',
    },
  },
};

/**
 * Create or update the Japanese test assistant
 */
async function createAssistant() {
  console.log('🤖 Creating Japanese test assistant...');
  
  try {
    const assistant = await vapi.assistants.create(japaneseAssistantConfig);
    console.log('✅ Assistant created successfully!');
    console.log(`   ID: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}`);
    console.log('');
    console.log('💡 Save this assistant ID to your .env file:');
    console.log(`   TEST_ASSISTANT_ID=${assistant.id}`);
    console.log('');
    
    return assistant;
  } catch (error) {
    console.error('❌ Failed to create assistant:', error.message);
    throw error;
  }
}

/**
 * Make a phone call to real estate agency
 */
async function makeCall(assistantId) {
  console.log('📞 Initiating call...');
  console.log(`   To: ${config.wifePhone} (Real Estate Agency)`);
  console.log(`   Assistant: ${assistantId}`);
  console.log('');
  
  try {
    const call = await vapi.calls.create({
      assistantId: assistantId,
      phoneNumberId: config.phoneNumberId,
      customer: {
        number: config.wifePhone,
      },
    });
    
    console.log('✅ Call initiated successfully!');
    console.log(`   Call ID: ${call.id}`);
    console.log(`   Status: ${call.status}`);
    console.log('');
    console.log('🎧 Monitor the call in dashboard:');
    console.log(`   https://dashboard.vapi.ai/calls/${call.id}`);
    console.log('');
    
    return call;
  } catch (error) {
    console.error('❌ Failed to make call:', error.message);
    throw error;
  }
}

/**
 * Get call status and details
 */
async function getCallStatus(callId) {
  try {
    const call = await vapi.calls.get(callId);
    return call;
  } catch (error) {
    console.error('❌ Failed to get call status:', error.message);
    throw error;
  }
}

/**
 * Wait for call to complete and retrieve results
 */
async function waitForCallCompletion(callId) {
  console.log('⏳ Waiting for call to complete...');
  console.log('   (This may take a few minutes)');
  console.log('');
  
  let attempts = 0;
  const maxAttempts = 60; // 5 minutes max wait
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
    const call = await getCallStatus(callId);
    
    if (config.debugMode) {
      console.log(`   Status check ${attempts + 1}: ${call.status}`);
    }
    
    if (call.status === 'ended') {
      console.log('✅ Call completed!');
      console.log('');
      return call;
    }
    
    attempts++;
  }
  
  console.log('⚠️  Call still in progress after 5 minutes');
  console.log('   Check dashboard for status');
  return null;
}

/**
 * Display call results
 */
function displayResults(call) {
  console.log('📊 Call Results:');
  console.log('='.repeat(60));
  console.log('');
  
  console.log('📞 Call Details:');
  console.log(`   Duration: ${Math.floor(call.duration || 0)} seconds`);
  console.log(`   Started: ${call.startedAt || 'N/A'}`);
  console.log(`   Ended: ${call.endedAt || 'N/A'}`);
  console.log(`   Status: ${call.status}`);
  console.log('');
  
  if (call.transcript) {
    console.log('📝 Transcript:');
    console.log('-'.repeat(60));
    call.transcript.forEach((entry, index) => {
      const speaker = entry.role === 'assistant' ? 'Tanaka' : 'Agency';
      console.log(`${speaker}: ${entry.text}`);
    });
    console.log('-'.repeat(60));
    console.log('');
  }
  
  if (call.cost) {
    console.log('💰 Cost Breakdown:');
    console.log(`   Total: $${call.cost.toFixed(4)}`);
    console.log(`   Transcription: $${call.costs?.transcription?.toFixed(4) || 'N/A'}`);
    console.log(`   LLM: $${call.costs?.model?.toFixed(4) || 'N/A'}`);
    console.log(`   Voice: $${call.costs?.voice?.toFixed(4) || 'N/A'}`);
    console.log(`   Phone: $${call.costs?.phone?.toFixed(4) || 'N/A'}`);
    console.log('');
    
    if (call.cost > 1.0) {
      console.log('⚠️  WARNING: Call cost exceeded $1.00 budget!');
      console.log('');
    }
  }
  
  if (call.recordingUrl) {
    console.log('🎵 Recording:');
    console.log(`   ${call.recordingUrl}`);
    console.log('');
  }
  
  console.log('🌐 View full details in dashboard:');
  console.log(`   https://dashboard.vapi.ai/calls/${call.id}`);
  console.log('');
}

/**
 * Main execution
 */
async function main() {
  console.log('');
  console.log('🏢 Vapi.ai Real Estate Inquiry Test (Japanese)');
  console.log('='.repeat(60));
  console.log('');
  
  if (config.webCallingOnly) {
    console.log('🌐 WEB CALLING MODE');
    console.log('   No phone call will be made');
    console.log('   Use dashboard to test via web calling');
    console.log('');
    console.log('Steps:');
    console.log('1. Run this script to create the assistant');
    console.log('2. Go to dashboard.vapi.ai');
    console.log('3. Select your assistant');
    console.log('4. Click the phone icon to test via web');
    console.log('5. Speak Japanese to test conversation');
    console.log('6. Once satisfied, set WEB_CALLING_ONLY=false and run again');
    console.log('');
  }
  
  try {
    // Step 1: Create or get assistant
    let assistantId = config.assistantId;
    
    if (!assistantId) {
      console.log('No existing assistant found, creating new one...');
      const assistant = await createAssistant();
      assistantId = assistant.id;
      
      if (config.webCallingOnly) {
        console.log('✅ Assistant created! Test it in the dashboard first.');
        console.log('   Then come back and make a real call.');
        return;
      }
    } else {
      console.log(`✅ Using existing assistant: ${assistantId}`);
      console.log('');
    }
    
    // Step 2: Make the call (if not web-only mode)
    if (!config.webCallingOnly) {
      console.log('⚠️  WARNING: About to make a REAL phone call!');
      console.log(`   Calling: ${config.wifePhone}`);
      console.log('');
      console.log('Press Ctrl+C to cancel, or wait 5 seconds...');
      
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const call = await makeCall(assistantId);
      
      // Step 3: Wait for completion
      const completedCall = await waitForCallCompletion(call.id);
      
      // Step 4: Display results
      if (completedCall) {
        displayResults(completedCall);
      }
      
      console.log('✅ Test complete!');
      console.log('');
      console.log('📋 Next steps:');
      console.log('   1. Review the transcript above');
      console.log('   2. Listen to the recording');
      console.log('   3. Get feedback from Yuko (how natural did it sound?)');
      console.log('   4. Evaluate if this can handle real clinic/agency calls');
      console.log('   5. Check cost per minute for budget planning');
      console.log('');
    }
    
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    if (config.debugMode) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// Export for use in other scripts
module.exports = {
  createAssistant,
  makeCall,
  getCallStatus,
  waitForCallCompletion,
};
