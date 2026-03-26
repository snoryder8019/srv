# Meeting Module — W2 Marketing

Real-time video meetings with WebRTC, AI-powered notetaking, and collaborative notes/assets.

## Architecture

```
public/
  css/meeting.css          # All meeting UI styles (extracted from meeting.ejs)
  js/meeting-rtc.js        # WebRTC peer connections, media controls, speech recognition
  js/meeting-ui.js         # Share panel, notes/assets sidebar, notetaker controls
plugins/
  socketio.js              # Socket.io namespace /meetings — signaling, notes, transcription
  meetingNotetaker.js       # LLM-powered transcript summarization (TLDR)
routes/
  meetings.js              # Public routes: join, QR, invite, upload, data
  admin/meetings.js         # Admin CRUD: create, list, detail, close, destroy, tags
views/
  meeting.ejs              # Meeting room (thin HTML shell, loads external CSS/JS)
  meeting-error.ejs        # Error page (invalid/expired/closed links)
  admin/meetings/index.ejs # Admin meeting list + create modal
  admin/meetings/detail.ejs # Meeting archive viewer (notes, assets, participants, tags)
```

## Data Model

**Collection:** `w2_meetings`

| Field | Type | Description |
|---|---|---|
| `title` | String | Meeting title |
| `token` | String | Unique 48-char hex token (URL identifier) |
| `status` | String | `active`, `expired`, `closed` |
| `createdBy` | ObjectId | Admin user who created it |
| `createdAt` | Date | Creation timestamp |
| `expiresAt` | Date | Auto-expiry time |
| `maxUses` | Number | Max join count (0 = unlimited) |
| `useCount` | Number | Current join count |
| `participants` | Array | `[{ name, joinedAt }]` |
| `notes` | Array | `[{ _noteId, author, text, isAI, createdAt, replies }]` |
| `notes.replies` | Array | `[{ author, text, createdAt }]` — threaded replies on user notes |
| `assets` | Array | `[{ name, url, size, uploadedBy }]` |
| `tags` | Object | `{ clients: [ObjectId], users: [ObjectId] }` — auto/manual tagging |

## Socket.io Events

**Namespace:** `/meetings`

### Client → Server
| Event | Payload | Description |
|---|---|---|
| `join-room` | `{ token, displayName }` | Join meeting room |
| `webrtc-offer` | `{ targetPeerId, sdp }` | WebRTC SDP offer relay |
| `webrtc-answer` | `{ targetPeerId, sdp }` | WebRTC SDP answer relay |
| `webrtc-ice` | `{ targetPeerId, candidate }` | ICE candidate relay |
| `media-toggle` | `{ kind, enabled }` | Mic/camera state broadcast |
| `meeting-note` | `{ text }` | Create a new note |
| `meeting-note-edit` | `{ noteId, text, createdAt }` | Edit an AI note |
| `meeting-note-reply` | `{ noteId, text }` | Reply to a user note |
| `meeting-asset-uploaded` | `{ asset }` | Notify peers of uploaded file |
| `transcript-line` | `{ text, isFinal }` | Live speech transcript line |
| `transcription-chunk` | `{ transcript }` | Buffered transcript → AI summarization |

### Server → Client
| Event | Payload | Description |
|---|---|---|
| `room-joined` | `{ peers, title }` | Successful join, existing peers list |
| `room-peer-joined` | `{ peerId, displayName, isHost }` | New peer entered |
| `room-peer-left` | `{ peerId }` | Peer disconnected |
| `room-error` | `{ message }` | Join/validation error |
| `webrtc-offer/answer/ice` | SDP/candidate relay | WebRTC signaling |
| `media-toggled` | `{ peerId, kind, enabled }` | Peer toggled mic/cam |
| `meeting-note-added` | Note object | New note created (human or AI) |
| `meeting-note-edited` | `{ noteId, text, editedBy }` | Note text updated |
| `meeting-note-reply-added` | `{ noteId, reply }` | Reply added to a note |
| `meeting-asset-added` | Asset object | File shared by a peer |
| `transcript-line` | `{ speaker, text, isFinal }` | Remote peer's transcript |
| `notetaker-status` | `{ status }` | `listening` or `summarizing` |

## Key Features

### Audio Level Indicator
The mic button shows a green ring when audio input is detected (Web Audio API AnalyserNode). Helps users confirm their mic is working.

### AI Notetaker
1. Uses Web Speech API for continuous speech-to-text
2. Buffers transcript, flushes every 2 minutes or on "TLDR Now" click
3. Server sends chunk to LLM (Ollama qwen2.5:7b) for summarization
4. AI summary saved as a note with `isAI: true`, auto-opens notes sidebar

### Notes System
- **AI notes:** Editable (inline textarea → save persists via socket)
- **User notes:** Threaded replies (tree-like reply chain under each note)
- Notes persist in MongoDB, loaded on page open via `GET /meeting/:token/data`

### Pull-to-Refresh Protection
`beforeunload` prompt + CSS `overscroll-behavior: none` prevents accidental page reload on mobile during active calls.

### Stale Peer Cleanup
Peers that don't establish a WebRTC connection within 15 seconds are removed (handles reload race conditions).

## HTTP Routes

### Public (`/meeting`)
| Method | Path | Description |
|---|---|---|
| GET | `/:token` | Render meeting room |
| GET | `/:token/qr` | QR code as data URL |
| GET | `/:token/data` | JSON: notes + assets |
| POST | `/:token/invite` | Send email invite |
| POST | `/:token/upload` | Upload file asset |

### Admin (`/admin/meetings`)
| Method | Path | Description |
|---|---|---|
| GET | `/` | List meetings (active + history) |
| POST | `/` | Create new meeting |
| GET | `/:id` | Detail view |
| DELETE | `/:id` | Close meeting |
| DELETE | `/:id/destroy` | Permanent delete |
| PUT | `/:id/tags` | Update client/user tags |

## Constraints
- Max 5 participants per room
- Max file upload: 20 MB
- Speech recognition: Chrome/Edge only (Web Speech API)
- Token format: 24 random bytes → 48 hex chars
