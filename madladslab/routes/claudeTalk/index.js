import express from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = express.Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Store conversation history per session
const conversations = new Map();

// GET /claudeTalk - Render chat interface
router.get('/', (req, res) => {
  res.render('claudeTalk/index', {
    title: 'Claude Talk - Chat with AI',
    user: req.user
  });
});

// POST /claudeTalk/message - Send a message to Claude
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

    // Call Claude API
    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 4096,
      messages: history
    });

    // Extract assistant's reply
    const assistantMessage = response.content[0].text;

    // Add assistant's reply to history
    history.push({
      role: 'assistant',
      content: assistantMessage
    });

    // Keep only last 20 messages to prevent context from growing too large
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Return response
    res.json({
      success: true,
      response: assistantMessage,
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

// GET /claudeTalk/sessions - List active sessions
router.get('/sessions', (req, res) => {
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

export default router;
