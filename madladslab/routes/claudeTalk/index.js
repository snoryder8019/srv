import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import multer from 'multer';
import ssdpPkg from 'node-ssdp';
import axios from 'axios';
import { promisify } from 'util';
import { exec } from 'child_process';
import { tools, executeTool } from '../../lib/vmTools.js';

const { Client } = ssdpPkg;
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const execAsync = promisify(exec);

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Store conversation history per session
const conversations = new Map();

// Store WebSocket connections (Roku displays)
const rokuDisplays = new Set();

// Current waveform state
let currentWaveform = { frequency: 440, amplitude: 0.5, color: '#00FF88' };

// Discovered Roku devices cache
let discoveredRokus = [];
let lastDiscoveryTime = 0;

// GET /claudeTalk - Render chat interface
router.get('/', (req, res) => {
  res.render('claudeTalk/index', {
    title: 'Claude Talk - Chat with AI',
    user: req.user
  });
});

// GET /claudeTalk/voice - Simple voice-only interface
router.get('/voice', (req, res) => {
  res.render('claudeTalk/voice', {
    title: 'Voice Control - Claude Talk',
    user: req.user
  });
});

// POST /claudeTalk/message - Send a message to Claude with VM control tools
router.post('/message', async (req, res) => {
  try {
    const { message, sessionId = 'default', model = 'claude-sonnet-4-20250514' } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation history for this session
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);

    // Add user message to history
    history.push({
      role: 'user',
      content: message
    });

    // Tool use loop - Claude can use tools multiple times
    let response;
    const toolResults = [];
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (iterations < maxIterations) {
      iterations++;

      // Call Claude API with tools
      response = await anthropic.messages.create({
        model: model,
        max_tokens: 4096,
        messages: history,
        tools: tools,
        system: "You are a helpful AI assistant with access to VM control tools. You can manage services, read/write files, execute commands, and check system status. Always explain what you're doing before using tools."
      });

      // Check if Claude wants to use a tool
      const toolUseBlock = response.content.find(block => block.type === 'tool_use');

      if (!toolUseBlock) {
        // No tool use, we're done
        break;
      }

      // Execute the tool
      console.log(`Executing tool: ${toolUseBlock.name}`, toolUseBlock.input);
      const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);

      toolResults.push({
        tool: toolUseBlock.name,
        input: toolUseBlock.input,
        result: toolResult
      });

      // Add assistant's response (including tool use) to history
      history.push({
        role: 'assistant',
        content: response.content
      });

      // Add tool result to history
      history.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(toolResult)
          }
        ]
      });
    }

    // Extract final assistant's text reply
    const textBlock = response.content.find(block => block.type === 'text');
    const assistantMessage = textBlock ? textBlock.text : 'Task completed.';

    // Add final response to history if not already there
    if (iterations === 0) {
      history.push({
        role: 'assistant',
        content: response.content
      });
    }

    // Keep only last 20 messages to prevent context from growing too large
    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }

    // Return response
    res.json({
      success: true,
      response: assistantMessage,
      toolsUsed: toolResults,
      usage: response.usage,
      sessionId: sessionId
    });

  } catch (error) {
    console.error('Claude API Error:', error);
    res.status(500).json({
      error: 'Failed to communicate with Claude',
      details: error.message
    });
  }
});

// Voice input endpoint (from browser mic)
router.post('/voice', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file.buffer;
    const { sessionId = 'default' } = req.body;

    console.log('Voice input received, size:', audioBuffer.length, 'session:', sessionId);

    // Notify displays that we're listening
    broadcastToRoku({
      type: 'listening',
      sessionId
    });

    // Get transcript from client (Web Speech API does transcription in browser)
    const transcript = req.body.transcript || "[Voice input received]";
    console.log('Transcription:', transcript);

    // Show user's speech on display FIRST
    broadcastToRoku({
      type: 'user_speech',
      transcript: transcript,
      sessionId
    });

    // Wait a moment for user to see what they said
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Process with Claude
    const response = await processWithClaude(transcript, sessionId);

    // Update wavelength visualization
    updateWaveform(response.sentiment);

    // Broadcast to all Roku displays
    broadcastToRoku({
      type: 'response',
      text: response.text,
      transcript: transcript,
      waveform: currentWaveform,
      sessionId
    });

    res.json({
      success: true,
      transcript,
      response: response.text,
      sentiment: response.sentiment
    });
  } catch (error) {
    console.error('Voice processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /claudeTalk/sessions - List active sessions
router.get('/sessions', (_req, res) => {
  const sessions = Array.from(conversations.keys()).map(sessionId => ({
    sessionId,
    messageCount: conversations.get(sessionId).length
  }));

  res.json({ sessions });
});

// DELETE /claudeTalk/session/:sessionId - Clear a conversation session
router.delete('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (conversations.has(sessionId)) {
    conversations.delete(sessionId);
    res.json({ success: true, message: `Session ${sessionId} cleared` });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// GET /claudeTalk/session/:sessionId - Get conversation history
router.get('/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (conversations.has(sessionId)) {
    res.json({
      sessionId,
      history: conversations.get(sessionId)
    });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// GET /claudeTalk/roku/discover - Discover Roku devices on network
router.get('/roku/discover', async (req, res) => {
  try {
    console.log('Starting Roku discovery...');

    // Use cache if recent (within 30 seconds)
    const now = Date.now();
    if (discoveredRokus.length > 0 && (now - lastDiscoveryTime) < 30000) {
      console.log('Returning cached Roku devices:', discoveredRokus.length);
      return res.json({ success: true, devices: discoveredRokus });
    }

    const rokus = await discoverRokuDevices();
    discoveredRokus = rokus;
    lastDiscoveryTime = now;

    console.log('Discovered Roku devices:', rokus.length);
    res.json({ success: true, devices: rokus });
  } catch (error) {
    console.error('Roku discovery error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /claudeTalk/roku/cast - Cast display to specific Roku
router.post('/roku/cast', async (req, res) => {
  try {
    const { rokuIp, displayUrl } = req.body;

    if (!rokuIp) {
      return res.status(400).json({ success: false, error: 'Roku IP required' });
    }

    console.log('Casting to Roku:', rokuIp, displayUrl);

    // Launch browser on Roku and navigate to display URL
    const serverUrl = displayUrl || 'http://104.237.138.28/claudeTalk/display';

    await launchRokuBrowser(rokuIp, serverUrl);

    res.json({
      success: true,
      message: `Casting to Roku at ${rokuIp}`,
      url: serverUrl
    });
  } catch (error) {
    console.error('Roku cast error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /claudeTalk/roku/control - Send control commands to Roku
router.post('/roku/control', async (req, res) => {
  try {
    const { rokuIp, command } = req.body;

    if (!rokuIp || !command) {
      return res.status(400).json({ success: false, error: 'Roku IP and command required' });
    }

    console.log('Sending command to Roku:', rokuIp, command);

    const result = await sendRokuCommand(rokuIp, command);

    res.json({ success: true, result });
  } catch (error) {
    console.error('Roku control error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /claudeTalk/roku/info/:ip - Get info about specific Roku
router.get('/roku/info/:ip', async (req, res) => {
  try {
    const { ip } = req.params;
    const info = await getRokuInfo(ip);
    res.json({ success: true, info });
  } catch (error) {
    console.error('Roku info error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Roku display endpoint with waveform visualization
router.get('/display', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Claude Voice Assistant Display</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: 'Segoe UI', Arial, sans-serif;
      overflow: hidden;
    }
    #waveform {
      width: 100vw;
      height: 40vh;
      display: block;
    }
    #content {
      padding: 2rem 3rem;
      font-size: 2.5rem;
      line-height: 1.6;
      max-height: 50vh;
      overflow-y: auto;
    }
    #status {
      position: absolute;
      top: 1rem;
      right: 1rem;
      padding: 0.5rem 1rem;
      background: rgba(0, 255, 136, 0.2);
      border: 2px solid #00FF88;
      border-radius: 8px;
      font-size: 1rem;
    }
    #debug {
      position: absolute;
      bottom: 1rem;
      left: 1rem;
      padding: 0.5rem;
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid #444;
      font-size: 0.8rem;
      max-width: 400px;
      max-height: 200px;
      overflow-y: auto;
    }
    .listening {
      background: rgba(255, 136, 0, 0.2) !important;
      border-color: #FF8800 !important;
    }
    .speaking {
      background: rgba(0, 136, 255, 0.2) !important;
      border-color: #0088FF !important;
    }
  </style>
</head>
<body>
  <div id="status">Initializing...</div>
  <canvas id="waveform"></canvas>
  <div id="content">Waiting for voice input...</div>
  <div id="debug">Debug log:<br></div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const debugLog = (msg) => {
      console.log('[DEBUG]', msg);
      const debugDiv = document.getElementById('debug');
      debugDiv.innerHTML += new Date().toLocaleTimeString() + ': ' + msg + '<br>';
      debugDiv.scrollTop = debugDiv.scrollHeight;
    };

    debugLog('Script started');

    // Use direct server connection - bypasses Apache WebSocket proxy issues
    const serverUrl = 'http://104.237.138.28:3000';
    debugLog('Creating Socket.IO connection to ' + serverUrl + '/claudeTalk-display');

    const socket = io(serverUrl + '/claudeTalk-display', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    debugLog('Socket object created');
    const canvas = document.getElementById('waveform');
    const ctx = canvas.getContext('2d');
    const statusDiv = document.getElementById('status');
    const contentDiv = document.getElementById('content');

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.4;

    let waveform = { frequency: 440, amplitude: 0.5, color: '#00FF88' };
    let phase = 0;
    let animationId;

    socket.on('connect', () => {
      debugLog('✅ Connected to server!');
      console.log('Socket.IO connected');
      statusDiv.textContent = 'Connected';
      statusDiv.className = '';
    });

    socket.on('connect_error', (error) => {
      debugLog('❌ Connection error: ' + error.message);
      statusDiv.textContent = 'Connection Error';
      statusDiv.style.background = 'rgba(255, 0, 0, 0.3)';
    });

    socket.on('disconnect', (reason) => {
      debugLog('⚠️ Disconnected: ' + reason);
      statusDiv.textContent = 'Disconnected';
      statusDiv.className = '';
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      debugLog('🔄 Reconnecting... attempt ' + attemptNumber);
    });

    socket.on('update', (data) => {
      console.log('Received:', data);

      if (data.type === 'init') {
        waveform = data.waveform || waveform;
      } else if (data.type === 'response') {
        waveform = data.waveform || waveform;

        // Show transcript if available
        if (data.transcript) {
          contentDiv.innerHTML = '<div style="font-size: 1.5rem; color: #888; margin-bottom: 1rem;">You said: ' + data.transcript + '</div>' + data.text;
        } else {
          contentDiv.textContent = data.text || '';
        }

        statusDiv.textContent = 'Speaking';
        statusDiv.className = 'speaking';

        // Text-to-speech
        if (data.text && 'speechSynthesis' in window) {
          // Cancel any ongoing speech
          window.speechSynthesis.cancel();

          const utterance = new SpeechSynthesisUtterance(data.text);
          utterance.rate = 0.9; // Slightly slower for clarity
          utterance.pitch = 1.0;
          utterance.volume = 1.0;

          utterance.onend = () => {
            statusDiv.textContent = 'Ready';
            statusDiv.className = '';
          };

          utterance.onerror = (error) => {
            console.error('Speech synthesis error:', error);
            statusDiv.textContent = 'Ready';
            statusDiv.className = '';
          };

          window.speechSynthesis.speak(utterance);
        } else {
          setTimeout(() => {
            statusDiv.textContent = 'Ready';
            statusDiv.className = '';
          }, 3000);
        }
      } else if (data.type === 'listening') {
        statusDiv.textContent = 'Listening...';
        statusDiv.className = 'listening';
        contentDiv.innerHTML = '<div style="font-size: 2rem; color: #FF8800;">🎤 Listening...</div>';
      } else if (data.type === 'user_speech') {
        // Show what the user said
        statusDiv.textContent = 'Processing...';
        statusDiv.className = 'listening';
        contentDiv.innerHTML = '<div style="font-size: 1.8rem; color: #00FF88; margin-bottom: 1rem;">You said:</div><div style="font-size: 2.5rem; font-weight: bold;">' + data.transcript + '</div>';
      } else if (data.type === 'mode_change') {
        waveform = data.waveform || waveform;
        statusDiv.textContent = 'Mode: ' + (data.mode || 'default');
        setTimeout(() => {
          statusDiv.textContent = 'Ready';
          statusDiv.className = '';
        }, 2000);
      }
    });

    function drawWave() {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = waveform.color;
      ctx.lineWidth = 4;
      ctx.beginPath();

      for (let x = 0; x < canvas.width; x++) {
        const y = canvas.height / 2 +
          Math.sin((x / canvas.width) * Math.PI * 2 * (waveform.frequency / 100) + phase) *
          canvas.height * 0.3 * waveform.amplitude;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      phase += 0.05;
      animationId = requestAnimationFrame(drawWave);
    }
    drawWave();

    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight * 0.4;
    });
  </script>
</body>
</html>
  `);
});

// Helper function to process input with Claude
async function processWithClaude(userInput, sessionId = 'default') {
  // Get or create conversation history
  if (!conversations.has(sessionId)) {
    conversations.set(sessionId, []);
  }
  const history = conversations.get(sessionId);

  // Add user message
  history.push({
    role: 'user',
    content: userInput
  });

  // Call Claude API with MCP tools
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: history,
    tools: [
      {
        name: 'get_current_time',
        description: 'Get the current date and time',
        input_schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_weather',
        description: 'Get weather information (simulated)',
        input_schema: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'City name or location'
            }
          },
          required: ['location']
        }
      },
      {
        name: 'search_web',
        description: 'Search the web for information (simulated)',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            }
          },
          required: ['query']
        }
      },
      {
        name: 'set_roku_display_mode',
        description: 'Change the visual mode of the Roku display',
        input_schema: {
          type: 'object',
          properties: {
            mode: {
              type: 'string',
              enum: ['calm', 'energetic', 'alert'],
              description: 'Display mode: calm (slow wave), energetic (fast wave), alert (pulsing)'
            }
          },
          required: ['mode']
        }
      }
    ]
  });

  // Check if response contains tool use
  const hasToolUse = response.content.some(block => block.type === 'tool_use');

  if (hasToolUse) {
    // Add assistant's tool use to history
    history.push({
      role: 'assistant',
      content: response.content
    });

    // Execute tools and build tool results
    const toolResultsContent = [];
    for (const content of response.content) {
      if (content.type === 'tool_use') {
        const toolResult = await executeToolCall(content.name, content.input);
        toolResultsContent.push({
          type: 'tool_result',
          tool_use_id: content.id,
          content: toolResult
        });
      }
    }

    // Add tool results to history
    history.push({
      role: 'user',
      content: toolResultsContent
    });

    // Get final response from Claude with tool results
    const finalResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: history
    });

    // Extract final text
    let finalText = '';
    for (const content of finalResponse.content) {
      if (content.type === 'text') {
        finalText += content.text;
      }
    }

    // Add final response to history
    history.push({
      role: 'assistant',
      content: finalResponse.content
    });

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    return {
      text: finalText,
      sentiment: analyzeSentiment(finalText)
    };
  } else {
    // No tool use, simple text response
    let finalText = '';
    for (const content of response.content) {
      if (content.type === 'text') {
        finalText += content.text;
      }
    }

    // Add to history
    history.push({
      role: 'assistant',
      content: response.content
    });

    // Keep only last 20 messages
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    return {
      text: finalText,
      sentiment: analyzeSentiment(finalText)
    };
  }
}

// Execute tool calls
async function executeToolCall(toolName, input) {
  console.log('Executing tool:', toolName, 'with input:', input);

  switch (toolName) {
    case 'get_current_time':
      const now = new Date();
      return now.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      });

    case 'get_weather':
      // Simulated weather data
      return `Weather in ${input.location}: 72°F, Partly Cloudy, Humidity 65%, Wind 8mph`;

    case 'search_web':
      // Simulated search result
      return `Found information about "${input.query}": This is a simulated search result. In production, this would return real web search data.`;

    case 'set_roku_display_mode':
      // Change display mode and broadcast
      const modeSettings = {
        calm: { frequency: 200, amplitude: 0.3, color: '#4A90E2' },
        energetic: { frequency: 800, amplitude: 0.8, color: '#FF6B6B' },
        alert: { frequency: 600, amplitude: 0.9, color: '#FFA500' }
      };

      currentWaveform = modeSettings[input.mode] || currentWaveform;

      broadcastToRoku({
        type: 'mode_change',
        mode: input.mode,
        waveform: currentWaveform
      });

      return `Display mode set to ${input.mode}`;

    default:
      return 'Tool not implemented';
  }
}

// Analyze sentiment for wavelength visualization
function analyzeSentiment(text) {
  const positiveWords = ['good', 'great', 'excellent', 'happy', 'yes', 'success', 'wonderful', 'perfect', 'amazing'];
  const negativeWords = ['bad', 'error', 'failed', 'no', 'problem', 'issue', 'wrong', 'unfortunately'];

  const lower = text.toLowerCase();
  let score = 0.5;

  positiveWords.forEach(word => {
    if (lower.includes(word)) score += 0.1;
  });
  negativeWords.forEach(word => {
    if (lower.includes(word)) score -= 0.1;
  });

  return Math.max(0, Math.min(1, score));
}

// Update wavelength based on sentiment
function updateWaveform(sentiment) {
  const sentimentValue = sentiment || 0.5; // 0 (negative) to 1 (positive)

  currentWaveform = {
    frequency: 300 + (sentimentValue * 400), // 300-700 Hz
    amplitude: 0.3 + (Math.abs(sentimentValue - 0.5) * 0.4),
    color: sentimentToColor(sentimentValue)
  };
}

// Convert sentiment to visible wavelength color
function sentimentToColor(sentiment) {
  // Map 0-1 to visible spectrum (red ~700nm to violet ~400nm)
  const hue = sentiment * 280; // 0-280 degrees (red to violet range)
  return `hsl(${hue}, 80%, 60%)`;
}

// Broadcast to all Roku displays via Socket.IO
function broadcastToRoku(data) {
  console.log('📡 Broadcasting to', rokuDisplays.size, 'displays:', data.type);
  rokuDisplays.forEach(socket => {
    if (socket.connected) {
      console.log('  ✅ Sending to connected display');
      socket.emit('update', data);
    } else {
      console.log('  ❌ Display not connected');
    }
  });

  if (rokuDisplays.size === 0) {
    console.log('  ⚠️ No displays connected!');
  }
}

// Discover Roku devices on network using SSDP
async function discoverRokuDevices() {
  return new Promise((resolve) => {
    const devices = [];
    const client = new Client();
    const timeout = 5000; // 5 second discovery

    client.on('response', async (headers, statusCode, rinfo) => {
      try {
        // Check if it's a Roku device
        if (headers.SERVER && headers.SERVER.includes('Roku')) {
          const ip = rinfo.address;

          // Avoid duplicates
          if (!devices.find(d => d.ip === ip)) {
            // Get device info
            let deviceInfo = {
              ip: ip,
              name: 'Roku Device',
              model: 'Unknown',
              server: headers.SERVER
            };

            try {
              const info = await getRokuInfo(ip);
              deviceInfo = { ...deviceInfo, ...info };
            } catch (e) {
              console.log('Could not get detailed info for', ip);
            }

            devices.push(deviceInfo);
            console.log('Found Roku:', deviceInfo);
          }
        }
      } catch (error) {
        console.error('Error processing SSDP response:', error);
      }
    });

    // Search for Roku devices
    client.search('roku:ecp');

    // Also try alternate method - scan common Roku port
    setTimeout(async () => {
      try {
        // Fallback: Try scanning port 8060 on local network
        const localDevices = await scanRokuPort();
        localDevices.forEach(device => {
          if (!devices.find(d => d.ip === device.ip)) {
            devices.push(device);
          }
        });
      } catch (e) {
        console.log('Port scan fallback failed:', e.message);
      }

      client.stop();
      resolve(devices);
    }, timeout);
  });
}

// Fallback: Scan for Roku devices on port 8060
async function scanRokuPort() {
  const devices = [];

  try {
    // Get local network range
    const { stdout } = await execAsync("ip route | grep -oP 'src \\K[0-9.]+' | head -1");
    const localIp = stdout.trim();

    if (!localIp) {
      return devices;
    }

    // Get network prefix (e.g., 192.168.1)
    const prefix = localIp.split('.').slice(0, 3).join('.');

    // Scan common IP range (last octet 1-254)
    // For speed, only check a subset
    const promises = [];
    for (let i = 1; i <= 254; i += 10) { // Check every 10th IP for speed
      const ip = `${prefix}.${i}`;
      promises.push(checkRokuAtIP(ip));
    }

    const results = await Promise.allSettled(promises);
    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        devices.push(result.value);
      }
    });
  } catch (error) {
    console.error('Network scan error:', error);
  }

  return devices;
}

// Check if Roku exists at specific IP
async function checkRokuAtIP(ip) {
  try {
    const response = await axios.get(`http://${ip}:8060/query/device-info`, {
      timeout: 1000
    });

    if (response.data) {
      const info = parseRokuDeviceInfo(response.data);
      return { ip, ...info };
    }
  } catch (error) {
    // Not a Roku or not reachable
    return null;
  }
}

// Get detailed info about Roku device
async function getRokuInfo(ip) {
  try {
    const response = await axios.get(`http://${ip}:8060/query/device-info`, {
      timeout: 3000
    });

    return parseRokuDeviceInfo(response.data);
  } catch (error) {
    throw new Error(`Could not get info from Roku at ${ip}: ${error.message}`);
  }
}

// Parse Roku device info XML
function parseRokuDeviceInfo(xmlData) {
  const info = {
    name: 'Roku Device',
    model: 'Unknown',
    serialNumber: 'Unknown'
  };

  try {
    // Simple XML parsing (could use xml2js for more robust parsing)
    const nameMatch = xmlData.match(/<user-device-name>(.*?)<\/user-device-name>/);
    const modelMatch = xmlData.match(/<model-name>(.*?)<\/model-name>/);
    const serialMatch = xmlData.match(/<serial-number>(.*?)<\/serial-number>/);

    if (nameMatch) info.name = nameMatch[1];
    if (modelMatch) info.model = modelMatch[1];
    if (serialMatch) info.serialNumber = serialMatch[1];
  } catch (e) {
    console.error('Error parsing Roku info:', e);
  }

  return info;
}

// Launch Roku browser and navigate to URL
async function launchRokuBrowser(rokuIp, url) {
  try {
    // First, try to launch Web Browser channel (channel ID 20445)
    // This is the official Roku browser
    const launchUrl = `http://${rokuIp}:8060/launch/20445?contentID=${encodeURIComponent(url)}`;

    await axios.post(launchUrl, '', {
      timeout: 5000
    });

    console.log(`Launched browser on Roku ${rokuIp} with URL: ${url}`);
    return { success: true };
  } catch (error) {
    // Fallback: Try alternate methods
    console.error('Browser launch error, trying alternatives:', error.message);

    // Try sending input to navigate
    try {
      await sendRokuCommand(rokuIp, 'Home');
      await new Promise(resolve => setTimeout(resolve, 500));

      // You could implement more complex navigation here
      throw new Error('Roku browser channel may not be installed. Please install a web browser channel on your Roku first.');
    } catch (fallbackError) {
      throw new Error(`Could not launch browser: ${error.message}. ${fallbackError.message}`);
    }
  }
}

// Send control command to Roku (Home, Select, Up, Down, etc.)
async function sendRokuCommand(rokuIp, command) {
  try {
    const commandUrl = `http://${rokuIp}:8060/keypress/${command}`;

    await axios.post(commandUrl, '', {
      timeout: 3000
    });

    console.log(`Sent ${command} to Roku ${rokuIp}`);
    return { success: true, command };
  } catch (error) {
    throw new Error(`Could not send command to Roku: ${error.message}`);
  }
}

// Socket.IO setup function (to be called from main app)
export function setupWebSocket(io) {
  // Create namespace for claudeTalk display
  const displayNamespace = io.of('/claudeTalk-display');

  displayNamespace.on('connection', (socket) => {
    console.log('✅ Roku display connected via Socket.IO');

    // Add to active displays
    rokuDisplays.add(socket);

    // Send initial waveform
    socket.emit('update', {
      type: 'init',
      waveform: currentWaveform
    });

    socket.on('disconnect', () => {
      console.log('❌ Roku display disconnected');
      rokuDisplays.delete(socket);
    });
  });

  console.log('🚀 Claude Talk Socket.IO namespace ready: /claudeTalk-display');
}

export default router;
