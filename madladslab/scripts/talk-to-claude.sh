#!/bin/bash

# Script to talk to Claude via the API endpoint
# Usage: ./talk-to-claude.sh "Your message here" [sessionId]

# Configuration
API_URL="${API_URL:-http://localhost:3000/claudeTalk/message}"
SESSION_ID="${2:-default}"
MESSAGE="$1"

if [ -z "$MESSAGE" ]; then
    echo "Usage: $0 \"Your message here\" [sessionId]"
    echo ""
    echo "Examples:"
    echo "  $0 \"Hello Claude, how are you?\""
    echo "  $0 \"What is the weather like?\" my-session"
    echo ""
    echo "Environment variables:"
    echo "  API_URL - API endpoint (default: http://localhost:3000/claudeTalk/message)"
    exit 1
fi

# Make the request
RESPONSE=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": $(echo "$MESSAGE" | jq -Rs .),
    \"sessionId\": \"$SESSION_ID\"
  }")

# Check if curl succeeded
if [ $? -ne 0 ]; then
    echo "Error: Failed to connect to API"
    exit 1
fi

# Parse and display response
if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    echo "Claude: $(echo "$RESPONSE" | jq -r '.response')"
    echo ""
    echo "Session: $(echo "$RESPONSE" | jq -r '.sessionId')"
    echo "Tokens: $(echo "$RESPONSE" | jq -r '.usage.input_tokens') in, $(echo "$RESPONSE" | jq -r '.usage.output_tokens') out"
else
    echo "Error: $(echo "$RESPONSE" | jq -r '.error // .details // "Unknown error"')"
    exit 1
fi
