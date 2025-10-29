# Stringborn Universe

A community-driven sci-fi universe featuring 3D space exploration, ship combat, and dynamic hierarchical navigation across galaxies, star systems, and planets. Built with Three.js for immersive browser-based gameplay.

## Project Information

- **Version:** 0.1.0
- **Created by:** Violet
- **Engine:** Three.js (WebGL 2.0)
- **Architecture:** Full-stack Node.js with real-time 3D rendering

## Features

### 3D Space Navigation
- **Hierarchical Universe Exploration:** Navigate from galactic view down to individual star systems
- **3D Galactic Map:** Top-down orthographic view of the entire universe with thousands of stars and planets
- **Interactive System Maps:** Full 3D navigation within solar systems with realistic orbital mechanics
- **Asset Management:** Create, upload, and vote on custom sprites and 3D assets

### Ship Combat & Physics
- **Realistic Space Physics:** Newtonian physics with 6-directional thrusters and booster jets
- **Ship Combat System:** Shields, hull integrity, energy management, and weapon systems
- **Orbital Mechanics:** Real-time gravitational physics for planets and stars
- **3D Flight Controls:** Full 6-DOF (degrees of freedom) ship movement

### Character & Species System
- **Four Unique Species:** Silicates, Lanterns, Devan, and Humans
- **Character Creation:** Species-specific talent trees and fork specializations
- **Inventory System:** Item management and equipment

### Real-time Features
- **Socket.io Integration:** Live updates and chat
- **Dynamic State Management:** Persistent universe state across sessions
- **Admin Tools:** Comprehensive dashboard for universe management and monitoring

### RESTful API
- **Full CRUD Operations:** Characters, zones, assets, and universe data
- **3D Physics API:** Server-side physics calculations and collision detection
- **Route Planning:** Inter-system navigation and travel calculations

## Tech Stack

- **Backend:** Node.js (ES Modules), Express.js
- **Frontend:** EJS templating, vanilla JavaScript (ES6+)
- **Database:** MongoDB with Mongoose ODM
- **Real-time:** Socket.io
- **Authentication:** Passport.js (Local, Google OAuth, Facebook)
- **3D Rendering:** Three.js (r160)
- **Physics:** Custom 3D physics engine for orbital mechanics and ship combat
- **Storage:** AWS S3 via AWS SDK for asset uploads
- **Process Management:** PM2 for production deployment

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
├── api/                    # API routes (ES modules)
│   └── v1/                # API version 1
│       ├── characters/    # Character CRUD endpoints
│       ├── assets/        # Asset management & voting
│       ├── inventory/     # Item management
│       ├── models/        # 3D model endpoints
│       ├── physics/       # 3D physics calculations
│       ├── routes/        # Navigation & route planning
│       ├── tickets/       # Support system
│       ├── universe/      # Universe data endpoints
│       └── zones/         # Zone endpoints
├── bin/                   # Server entry point (www)
├── config/                # Configuration files
├── middlewares/           # Express middleware
├── plugins/               # Core plugins
│   ├── mongo/            # MongoDB/Mongoose connection
│   ├── passport/         # Multi-strategy authentication
│   └── socket/           # Socket.io real-time setup
├── public/                # Static assets
│   ├── javascripts/      # Client-side JS
│   │   ├── galactic-map-3d.js    # 3D galaxy renderer
│   │   ├── system-map-3d.js      # 3D solar system view
│   │   └── ship-combat-system.js # Combat & physics
│   └── stylesheets/      # CSS files
├── routes/                # View routes
│   ├── admin/            # Admin dashboard & controls
│   ├── assets/           # Asset builder & management
│   ├── characters/       # Character pages
│   ├── universe/         # Universe exploration views
│   └── zones/            # Zone pages
├── scripts/               # Database & maintenance scripts
├── services/              # Business logic services
├── utilities/             # Helper functions
├── views/                 # EJS templates
│   ├── admin/            # Admin panels
│   ├── assets/           # Asset builder & voting
│   ├── auth/             # Authentication pages
│   ├── characters/       # Character views
│   ├── help/             # Documentation & guides
│   ├── onboarding/       # New user experience
│   ├── universe/         # 3D map views
│   │   ├── galactic-map-3d.ejs  # Galaxy view
│   │   ├── system-map-3d.ejs    # Solar system view
│   │   └── sprite-creator.ejs   # Asset creator
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

### Assets (API v1)
- `GET /api/v1/assets` - Get all assets with pagination
- `POST /api/v1/assets` - Upload new asset (sprites, 3D models)
- `GET /api/v1/assets/:id` - Get specific asset
- `POST /api/v1/assets/:id/vote` - Vote on asset
- `DELETE /api/v1/assets/:id` - Delete asset (owner/admin only)

### Inventory (API v1)
- `GET /api/v1/inventory/:characterId` - Get character inventory
- `POST /api/v1/inventory/:characterId/items` - Add item to inventory
- `PUT /api/v1/inventory/:characterId/items/:itemId` - Update item
- `DELETE /api/v1/inventory/:characterId/items/:itemId` - Remove item

### Physics & Navigation (API v1)
- `POST /api/v1/physics/calculate-trajectory` - Calculate ship trajectory
- `POST /api/v1/physics/check-collision` - Check collision detection
- `GET /api/v1/routes/plan/:from/:to` - Plan inter-system route

### Universe (API v1)
- `GET /api/v1/universe/galactic-state` - Get complete galactic state
- `GET /api/v1/universe/galaxies` - Get all galaxies
- `GET /api/v1/universe/stars` - Get all stars
- `GET /api/v1/universe/planets` - Get all planets
- `GET /api/v1/universe/species` - Get all species
- `GET /api/v1/universe/talent-trees` - Get talent trees
- `GET /api/v1/universe/events` - Get active events

### Zones (API v1)
- `GET /api/v1/zones` - Get all zones
- `GET /api/v1/zones/:zoneName` - Get zone by name
- `POST /api/v1/zones/handoff` - Request grid handoff

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

# AWS S3 (for asset uploads)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=your_region
S3_BUCKET_NAME=your_bucket_name

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

- `users` - User accounts with authentication data
- `characters` - Player characters with species, stats, and locations
- `galaxies` - Galaxy data with 3D coordinates
- `stars` - Star systems with orbital parameters
- `planets` - Planetary bodies with physical properties
- `assets` - User-created sprites and 3D models
- `inventory` - Character inventories and items
- `zones` - Planetary zones and discovery areas
- `species` - Species data and characteristics
- `talentTrees` - Talent tree configurations
- `tickets` - Support ticket system
- `sessions` - Express sessions

## Socket.io Events

### Client to Server
- `gridHandoff` - Request planetary grid transition
- `playerMove` - Send player movement (3D coordinates)
- `shipUpdate` - Update ship position and state
- `characterUpdate` - Update character data
- `combatAction` - Fire weapons, use abilities
- `chatMessage` - Send chat message

### Server to Client
- `gridHandoffResponse` - Grid handoff confirmation
- `playerMoved` - Broadcast player movement
- `shipState` - Broadcast ship state changes
- `combatEvent` - Broadcast combat actions
- `characterUpdated` - Broadcast character updates
- `universeUpdate` - Real-time universe state changes
- `chatMessage` - Broadcast chat messages

## Key Features in Detail

### 3D Galactic Map
- Orthographic top-down view of entire universe
- Hierarchical navigation: Universe → Galaxy → Star System → Planet
- Interactive asset selection with info panels
- Customizable color schemes and visual effects
- Travel system with distance calculations

### Solar System 3D View
- Full 6-DOF camera controls
- Real-time orbital mechanics
- Gravitational physics simulation
- Planet detail inspection
- Ship combat arena

### Ship Combat System
- Newtonian physics with drag and inertia
- 6-directional thrusters (forward/back, left/right, up/down)
- Boost jets for rapid acceleration
- Shield and hull damage systems
- Energy management
- Weapon systems with cooldowns

### Asset Creation Tools
- In-browser sprite creator with drawing tools
- Upload custom assets (PNG, JPEG, 3D models)
- Community voting system
- Asset moderation and approval workflow
- AWS S3 integration for storage

### Admin Dashboard
- Real-time orbital monitoring
- User analytics and management
- Universe state controls
- Asset moderation
- Game state management tools

## Production Deployment

The application is configured for PM2 process management:

```bash
# Start with PM2
pm2 start bin/www --name "stringborn-universe"

# Monitor
pm2 list
pm2 logs stringborn-universe

# Restart
pm2 restart stringborn-universe
```

## Database Scripts

Multiple utility scripts are available in `/scripts` for:
- Adding 3D coordinates to existing data
- Migrating database schema
- Assigning planets to stars
- Checking character locations
- Analyzing database size
- Testing physics calculations

Run scripts with:
```bash
node scripts/script-name.js
```

## Contributing

This is a community-driven project. Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (3D rendering, physics, database)
5. Submit a pull request

## License

Private project - All rights reserved

## Credits

- **Created by:** Violet
- **Boilerplate based on:** madladslab structure
- **3D Engine:** Three.js
- **Physics:** Custom Newtonian physics implementation
