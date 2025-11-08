#!/bin/bash

# Helper script to add media URLs to graffiti-tv carousel
# Usage: ./add-media.sh <filename> <type>
# Example: ./add-media.sh my-video.mp4 video
# Example: ./add-media.sh street-art.jpg image

if [ $# -lt 2 ]; then
    echo "Usage: $0 <filename> <type>"
    echo "Example: $0 my-video.mp4 video"
    echo "Example: $0 street-art.jpg image"
    exit 1
fi

FILENAME=$1
TYPE=$2
BASE_URL="https://madladslab.us-ord-1.linodeobjects.com/graffiti-tv"
API_FILE="/srv/graffiti-tv/routes/api.js"

# Create the new media entry
NEW_ENTRY="      {
        url: \`\${baseUrl}/${FILENAME}\`,
        type: '${TYPE}',
      },"

# Find the mediaItems array and add the new entry
# This is a simplified version - you'll want to manually verify the addition

echo "Adding media entry:"
echo "  URL: ${BASE_URL}/${FILENAME}"
echo "  Type: ${TYPE}"
echo ""
echo "Add this to ${API_FILE} in the mediaItems array:"
echo ""
echo "${NEW_ENTRY}"
echo ""
echo "Or edit the file manually and add your media items to the mediaItems array."
