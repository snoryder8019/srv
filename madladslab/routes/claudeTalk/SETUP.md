# Claude Talk Web Interface - Setup Guide

## What's Been Created

1. **Web Interface** - Beautiful chat UI at `/claudeTalk`
2. **API Endpoints** - Backend routes for communication
3. **Session Management** - Multiple conversation tracking
4. **Command-line Script** - Terminal access (optional)

## Quick Setup

### 1. Add Your API Key

Add this line to your `/srv/madladslab/.env` file:

```bash
ANTHROPIC_API_KEY=your-anthropic-api-key-here
```

To get an API key:
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Go to API Keys section
4. Create a new key
5. Copy and paste it into your .env file

### 2. Restart Your Server

```bash
# If using npm run dev
# Just stop (Ctrl+C) and restart:
npm run dev

# If using pm2 or other process manager:
pm2 restart madladslab
```

### 3. Access the Web Interface

Open your browser and go to:
```
http://localhost:3000/claudeTalk
```

Or if accessing from outside:
```
https://yourdomain.com/claudeTalk
```

## Features

### Web Interface
- **Real-time Chat**: Chat with Claude AI in a modern interface
- **Multiple Sessions**: Run different conversations simultaneously
- **Model Selection**: Choose between different Claude models
- **Conversation History**: Maintains context across messages
- **Mobile Responsive**: Works on phones and tablets
- **Token Tracking**: Monitor API usage (in browser console)

### Available Models
- **Claude Sonnet 4** (Default) - Fast, smart, cost-effective
- **Claude 3.5 Sonnet** - Previous generation
- **Claude Opus 4** - Most capable, slower, more expensive

### Session Management
- Create multiple conversation sessions
- Each session maintains its own history
- Clear individual sessions
- View all active sessions

## API Endpoints

All endpoints are prefixed with `/claudeTalk`:

### `GET /claudeTalk`
Renders the web chat interface

### `POST /claudeTalk/message`
Send a message to Claude

**Request:**
```json
{
  "message": "Hello Claude!",
  "sessionId": "my-session",
  "model": "claude-sonnet-4-20250514"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Hello! How can I help you?",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 8
  },
  "sessionId": "my-session"
}
```

### `GET /claudeTalk/sessions`
List all active sessions

### `GET /claudeTalk/session/:sessionId`
Get history for a specific session

### `DELETE /claudeTalk/session/:sessionId`
Clear a session's history

## Usage Examples

### Web Interface Usage

1. **Start a Conversation**
   - Go to http://localhost:3000/claudeTalk
   - Type your message in the input box
   - Press Enter or click Send

2. **Use Multiple Sessions**
   - Change the session ID in the "Session" input
   - Each session keeps its own conversation history
   - Useful for different projects or topics

3. **Clear a Session**
   - Click "Clear Session" button
   - Confirms before deleting
   - Starts fresh conversation

4. **Change Models**
   - Use the "Model" dropdown
   - Different models have different capabilities
   - Opus 4 is most capable but slower

### Command Line Usage

```bash
# Simple message
./scripts/talk-to-claude.sh "What is Express.js?"

# With specific session
./scripts/talk-to-claude.sh "Help me debug this code" debug-session

# API call with curl
curl -X POST http://localhost:3000/claudeTalk/message \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Explain async/await in JavaScript",
    "sessionId": "learning"
  }'
```

## Tips

1. **Session Names**: Use descriptive session names
   - "debug-auth" for authentication debugging
   - "feature-chat" for chat feature development
   - "learning-js" for learning conversations

2. **Model Selection**:
   - Use Sonnet 4 for most tasks (default)
   - Use Opus 4 for complex reasoning or code generation
   - Consider cost vs. capability trade-offs

3. **Conversation Context**:
   - Sessions keep last 20 messages
   - Clear old sessions to save memory
   - Start new sessions for unrelated topics

4. **Best Practices**:
   - Be specific in your questions
   - Provide context when asking about code
   - Use code blocks for better formatting

## Troubleshooting

### "Failed to communicate with Claude"
- Check that ANTHROPIC_API_KEY is set in .env
- Verify the API key is valid
- Check server logs for detailed errors

### Page Not Loading
- Ensure server is running (`npm run dev`)
- Check that route is registered in routes/index.js
- Clear browser cache

### Empty Responses
- Check browser console for errors
- Verify API endpoint is accessible
- Check server logs

### Session Not Clearing
- Make sure session name matches exactly
- Refresh the page and try again
- Check browser network tab for errors

## File Structure

```
/srv/madladslab/
├── routes/
│   └── claudeTalk/
│       ├── index.js          # Route handlers
│       ├── README.md         # API documentation
│       └── SETUP.md          # This file
├── views/
│   └── claudeTalk/
│       └── index.ejs         # Web interface
└── scripts/
    └── talk-to-claude.sh     # CLI helper script
```

## Security Notes

- Never commit your API key to git
- Keep .env file secure
- API keys have usage limits
- Monitor token usage to control costs

## Next Steps

1. Set your ANTHROPIC_API_KEY in .env
2. Restart your server
3. Visit http://localhost:3000/claudeTalk
4. Start chatting with Claude!

## Support

- Anthropic API Docs: https://docs.anthropic.com/
- Claude Models: https://www.anthropic.com/api
- Report issues in your project

Enjoy talking with Claude! 🤖
