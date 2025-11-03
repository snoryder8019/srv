# Script Control Panel

A comprehensive admin interface for executing database scripts, seeding operations, and maintenance tasks.

## Access

- **URL**: `/admin/control-panel`
- **Permission**: Admin only
- **Navigation**: Available from Admin Dashboard (⚡ Script Control Panel button)

## Features

### 1. **Organized Script Categories**

Scripts are organized into 7 categories:

#### Database Checks
- **Check Asset Coordinates** - View asset positions in database
- **Check Galaxies** - List all galaxies
- **Check Galaxy Stars** - View stars in each galaxy
- **Check Zones** - List all zones and hubs
- **Check Star Status** - View star approval status
- **Check Character Location** - View character positions

#### Galaxy Seeding
- **Seed All Galaxies** - Create all galaxy systems (⚠️ Requires confirmation)
- **Seed Andromeda** - Populate Andromeda Spiral
- **Seed Elysium Cluster** - Populate Elysium Cluster
- **Seed Elysium Planets** - Add planets to Elysium
- **Seed Crimson Nebula Stars** - Add stars to Crimson Nebula
- **Seed Crimson Planets** - Add planets to Crimson stars
- **Seed Quantum Singularity** - Create Quantum Singularity galaxy

#### Asset Management
- **Create Field Test Assets** - Create starter equipment
- **Equip All Characters** - Give field test gear to all characters
- **Publish Galaxies & Stars** - Make galaxies/stars visible
- **Create Space Hubs** - Generate faction hubs
- **Create Sample Assets** - Generate test assets

#### Database Fixes
- **Fix Galaxy Coordinates** - Set proper galaxy positions (⚠️ Requires confirmation)
- **Fix Crimson Stars Status** - Approve Crimson Nebula stars
- **Fix Hub Status** - Repair hub data
- **Fix Orbital Relationships** - Link orbitals to planets
- **Add Missing Locations** - Add location data to assets

#### User Management
- **Make Admin** - Grant admin privileges (requires username input)
- **Remove Admin** - Revoke admin privileges (requires username input)
- **Add User Roles** - Initialize user role system
- **Initialize User Analytics** - Set up analytics tracking
- **Get User Info** - View user details (requires username input)

#### Database Maintenance
- **Cleanup Space** - Free up MongoDB storage (⚠️ Requires confirmation)
- **Reset Planet Generation** - Clear planet chunks (⚠️ Requires confirmation)
- **Reset Galactic Map** - Clear all positions (⚠️ Requires confirmation)
- **Reset All Characters** - Reset character data (⚠️ Requires confirmation)

#### Verification
- **Verify Elysium Planets** - Check Elysium seeding
- **Verify Crimson Nebula** - Check Crimson seeding
- **Verify Distributed Assets** - Check asset distribution
- **List Zones Detailed** - Show detailed zone info

### 2. **Real-Time Output Terminal**

- Live streaming output as script executes
- Color-coded messages:
  - 🟢 **Green** - Success messages (✓, ✅)
  - 🔴 **Red** - Errors (ERROR, ✗, ❌)
  - 🟡 **Yellow** - Warnings (⚠️, WARNING)
  - 🔵 **Blue** - Info messages (🔍, 📊, ℹ️)
  - ⚪ **Gray** - Prompts and general output

### 3. **Safety Features**

- **Confirmation Dialogs**: Destructive operations require explicit confirmation
- **Visual Warnings**: Dangerous scripts have orange borders
- **Status Indicators**:
  - 🟢 Ready - System idle
  - 🟡 Executing - Script running

### 4. **User Input Support**

Some scripts require input (e.g., username for admin operations):
- Input field appears automatically when needed
- Script won't execute without required input
- Clear labeling of what input is needed

### 5. **Execution Controls**

- **Execute Script** - Run the selected script
- **Clear Output** - Clear the terminal output
- **Category Collapse** - Click category headers to expand/collapse

## Architecture

### Backend API

**Route**: `/admin/scripts/*`

#### Endpoints:

1. **GET /admin/scripts/categories**
   - Returns all script categories and their scripts
   - Response includes script metadata (name, file, description, confirm flag)

2. **POST /admin/scripts/execute**
   - Executes a script by filename
   - Streams output in real-time using chunked transfer encoding
   - Body: `{ scriptFile: string, args?: string[] }`

### Security

- **Authentication**: Requires logged-in user
- **Authorization**: Requires `user.isAdmin === true`
- **Script Validation**: Only scripts from predefined categories can be executed
- **Path Security**: Scripts must exist in `/srv/ps/scripts/` directory

### File Structure

```
/srv/ps/
├── routes/admin/
│   ├── index.js          # Main admin routes (updated)
│   └── scripts.js        # NEW: Script execution API
├── views/admin/
│   ├── dashboard.ejs     # Updated with control panel link
│   └── control-panel.ejs # NEW: Control panel UI
└── scripts/              # 47 executable scripts
    ├── check-*.js        # Database checks (6 scripts)
    ├── seed-*.js         # Galaxy seeding (7 scripts)
    ├── fix-*.js          # Database fixes (5 scripts)
    ├── create-*.js       # Asset creation (5 scripts)
    ├── verify-*.js       # Verification (4 scripts)
    ├── reset-*.js        # Maintenance (4 scripts)
    └── [other scripts]   # User management, etc.
```

## UI Design

### Layout

- **Narrow margins and padding** throughout (8-12px)
- **Compact controls** for maximum screen utilization
- **Monospace font** (Courier New) for terminal aesthetic
- **Dark theme** with neon green accents (#4ade80)

### Responsive

- **Desktop**: Sidebar (280px) + Main content
- **Mobile**: Stacked layout, sidebar becomes scrollable dropdown

### Color Scheme

- Background: `#0a0a0a` (near black)
- Panels: `#111` (dark gray)
- Borders: `#333` (medium gray)
- Primary: `#4ade80` (neon green)
- Warning: `#f59e0b` (orange)
- Danger: `#ef4444` (red)
- Info: `#60a5fa` (blue)

## Usage Example

1. Navigate to Admin Dashboard
2. Click "⚡ Script Control Panel"
3. Select a category (e.g., "Database Checks")
4. Click a script (e.g., "Check Galaxies")
5. Review script details in info panel
6. Click "Execute Script" (red button)
7. Watch real-time output in terminal
8. Status bar shows execution state

## Script Output Examples

### Success
```
🌌 GALAXIES:
  Stellar Crown
    Published: true
    Coords: (2500, 1000, 0)
  ✅ 5 galaxies found
```

### Error
```
❌ Error: Failed to connect to database
ERROR: Connection timeout after 5000ms
```

### Warning
```
⚠️ WARNING: This will delete 807 planet chunks
Are you sure you want to continue?
```

## Future Enhancements

- [ ] Script scheduling (cron-like)
- [ ] Script history and logs
- [ ] Batch script execution
- [ ] Script output export
- [ ] Custom script upload
- [ ] Script parameters/configuration
- [ ] Script favorites
- [ ] Search/filter scripts

## Troubleshooting

### Script won't execute
- Check admin permissions
- Verify script file exists in `/srv/ps/scripts/`
- Check console for errors
- Ensure required inputs are provided

### No output appearing
- Check network connection
- Verify server is running
- Look for errors in browser console
- Check server logs

### 403 Forbidden
- User must have `isAdmin: true` in database
- Use "Make Admin" script to grant permissions

## Related Documentation

- [Admin Routes](/routes/admin/index.js)
- [Script API](/routes/admin/scripts.js)
- [Individual Scripts](/scripts/)
