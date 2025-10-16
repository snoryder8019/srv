# Claude Talk API

This API allows you to communicate with Claude (Anthropic's AI) from your VM via HTTP endpoints.

## Setup

1. **Add your Anthropic API key** to your environment variables:
   ```bash
   export ANTHROPIC_API_KEY="your-api-key-here"
   ```

   Or add it to your `.env` file:
   ```
   ANTHROPIC_API_KEY=your-api-key-here
   ```

2. **Restart your server** to load the new route:
   ```bash
   npm run dev
   ```

## API Endpoints

### POST /claudeTalk/message
Send a message to Claude and get a response.

**Request:**
```bash
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello Claude, can you help me debug this code?",
    "sessionId": "my-session",
    "model": "claude-sonnet-4-20250514"
  }'
```

**Parameters:**
- `message` (required): Your message to Claude
- `sessionId` (optional): Session ID to maintain conversation context (default: "default")
- `model` (optional): Claude model to use (default: "claude-sonnet-4-20250514")

**Response:**
```json
{
  "success": true,
  "response": "Claude's response here...",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 456
  },
  "sessionId": "my-session"
}
```

### GET /claudeTalk/sessions
List all active conversation sessions.

**Request:**
```bash
curl http://localhost:3000/claudeTalk/sessions
```

**Response:**
```json
{
  "sessions": [
    {
      "sessionId": "default",
      "messageCount": 10
    },
    {
      "sessionId": "my-session",
      "messageCount": 4
    }
  ]
}
```

### GET /claudeTalk/session/:sessionId
Get conversation history for a specific session.

**Request:**
```bash
curl http://localhost:3000/claudeTalk/session/my-session
```

**Response:**
```json
{
  "sessionId": "my-session",
  "history": [
    {
      "role": "user",
      "content": "Hello Claude"
    },
    {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    }
  ]
}
```

### DELETE /claudeTalk/session/:sessionId
Clear a conversation session.

**Request:**
```bash
curl -X DELETE http://localhost:3000/claudeTalk/session/my-session
```

**Response:**
```json
{
  "success": true,
  "message": "Session my-session cleared"
}
```

## Quick Start Script

Use the provided bash script for easier interaction:

```bash
# Simple message
./scripts/talk-to-claude.sh "What is Node.js?"

# With session ID
./scripts/talk-to-claude.sh "Remember I'm working on Express" my-project

# Continue conversation in same session
./scripts/talk-to-claude.sh "Can you help me with routing?" my-project
```

## Usage Examples

### Example 1: Getting help with code
```bash
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "I have an Express route that is not working. How do I debug it?"
  }'
```

### Example 2: Multi-turn conversation
```bash
# First message
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{"message": "I am working on a MongoDB schema", "sessionId": "dev-session"}'

# Follow-up (maintains context)
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{"message": "How do I add validation to it?", "sessionId": "dev-session"}'
```

### Example 3: Code review
```bash
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Can you review this code: async function getData() { const data = await db.find({}); return data; }",
    "sessionId": "code-review"
  }'
```

## Features

- **Conversation Memory**: Each session maintains conversation history
- **Multiple Sessions**: Run different conversations simultaneously with different session IDs
- **Automatic Cleanup**: Keeps only the last 20 messages per session to manage memory
- **Error Handling**: Comprehensive error responses for debugging
- **Token Usage**: See how many tokens each request consumes

## Notes

- Conversation history is stored in memory and will be lost when the server restarts
- Each session keeps up to 20 messages (10 exchanges) in history
- Make sure your `ANTHROPIC_API_KEY` is set before making requests
- The default model is Claude Sonnet 4, which is fast and cost-effective
