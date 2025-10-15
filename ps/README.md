# Stringborn Universe

A community-driven sci-fi universe with metaphysical domains, species forks, and dynamic planetary zones. Built for 2D gameplay with 3D browser experiences using Three.js.

## Project Information

- **Version:** 0.1.0
- **Created by:** Violet
- **Engine:** Three.js (WebGL 2.0)

## Features

- **Four Unique Species:** Silicates, Lanterns, Devan, and Humans
- **Dynamic Planetary Zones:** Discovery zones and spatial zones with real-time server handoffs
- **Character Creation:** Species-specific talent trees and fork specializations
- **Real-time Communication:** Socket.io for live updates and chat
- **RESTful API:** Full CRUD operations for characters, zones, and universe data

## Tech Stack

- **Backend:** Node.js, Express.js
- **Frontend:** EJS templating, vanilla JavaScript
- **Database:** MongoDB
- **Real-time:** Socket.io
- **Authentication:** Passport.js (Local Strategy)
- **3D Rendering:** Three.js

## Prerequisites

- Node.js (v16 or higher)
- MongoDB database
- npm or yarn

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env` and update with your credentials
   - Set up MongoDB connection string
   - Configure Google OAuth credentials (optional)

4. Start the server:
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

5. Open your browser and navigate to `http://localhost:3003`

## Project Structure

```
ps/
├── api/                    # API routes
│   └── v1/                # API version 1
│       ├── characters/    # Character endpoints
│       ├── zones/         # Zone endpoints
│       └── universe/      # Universe data endpoints
├── bin/                   # Server entry point
├── plugins/               # Core plugins
│   ├── mongo/            # MongoDB connection
│   ├── passport/         # Authentication
│   └── socket/           # Socket.io setup
├── public/                # Static assets
│   ├── javascripts/      # Client-side JS
│   └── stylesheets/      # CSS files
├── routes/                # View routes
│   ├── characters/       # Character pages
│   ├── zones/            # Zone pages
│   └── universe/         # Universe pages
├── utilities/             # Helper functions
├── views/                 # EJS templates
│   ├── auth/             # Authentication pages
│   ├── characters/       # Character views
│   ├── errors/           # Error pages
│   └── partials/         # Reusable components
├── app.js                 # Main application file
├── package.json          # Dependencies
└── .env                  # Environment variables
```

## API Endpoints

### Authentication
- `POST /login` - User login
- `POST /register` - User registration
- `POST /logout` - User logout
- `GET /status` - Check auth status

### Characters (API v1)
- `GET /api/v1/characters` - Get all user characters
- `POST /api/v1/characters` - Create new character
- `GET /api/v1/characters/:id` - Get character by ID
- `PUT /api/v1/characters/:id` - Update character
- `DELETE /api/v1/characters/:id` - Delete character

### Zones (API v1)
- `GET /api/v1/zones` - Get all zones
- `GET /api/v1/zones/:zoneName` - Get zone by name
- `POST /api/v1/zones/handoff` - Request grid handoff

### Universe (API v1)
- `GET /api/v1/universe/galactic-state` - Get galactic state
- `GET /api/v1/universe/species` - Get all species
- `GET /api/v1/universe/talent-trees` - Get talent trees
- `GET /api/v1/universe/planetary-state` - Get planetary state
- `GET /api/v1/universe/events` - Get active events

## Environment Variables

```env
# Google OAuth
GGLAPI=your_google_api_key
GGLSEC=your_google_secret
GGLCID=your_google_client_id

# Session
SESHSEC=your_session_secret
COOKIE_SECRET=your_cookie_secret

# Database
DB_URL=mongodb+srv://username:password@cluster.mongodb.net
DB_NAME=stringbornUniverse

# Server
PORT=3003

# Email (optional)
GMAIL_USER=your_email@gmail.com
GMAIL_PASS=your_app_password
```

## Development

### Running in Development Mode
```bash
npm run dev
```

This will start the server with nodemon, which automatically restarts on file changes.

### Adding New Routes

1. Create route file in `/routes` or `/api/v1`
2. Import and mount in parent router
3. Add corresponding views in `/views`

### Database Collections

- `users` - User accounts
- `characters` - Player characters
- `zones` - Planetary zones
- `species` - Species data
- `talentTrees` - Talent tree configurations
- `galacticState` - Universe state data
- `planetaryState` - Planetary grid data
- `sessions` - Express sessions

## Socket.io Events

### Client to Server
- `gridHandoff` - Request planetary grid transition
- `playerMove` - Send player movement
- `characterUpdate` - Update character data
- `chatMessage` - Send chat message

### Server to Client
- `gridHandoffResponse` - Grid handoff confirmation
- `playerMoved` - Broadcast player movement
- `characterUpdated` - Broadcast character updates
- `chatMessage` - Broadcast chat messages

## Contributing

This is a community-driven project. Contributions are welcome!

## License

Private project - All rights reserved

## Credits

- **Created by:** Violet
- **Boilerplate based on:** madladslab structure
