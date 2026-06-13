# Main Menu System

## Overview

A beautiful, organized main menu page that provides easy access to all features of the Stringborn Universe, including the new Asset Builder system.

## Route

**URL:** `/menu`

## Features

### For All Visitors
- **Game Features Section**
  - Explore Zones
  - Species Information
  - Galactic State

- **Community Section**
  - Community Voting (public access)
  - Login/Register (for non-authenticated users)

### For Authenticated Users
- **My Content Section**
  - My Characters
  - Create Character
  - Asset Builder (highlighted)

### For Admins
- **Administration Section**
  - Admin Dashboard
  - Generate Assets
  - Asset Approvals (highlighted)

## Design

- Clean, card-based layout
- Emoji icons for visual appeal
- Highlighted cards for key features (Asset Builder, Voting)
- Special styling for admin features
- Fully responsive design
- Hover animations

## Navigation

The menu is accessible from:
1. **Header** - "Main Menu" button (always visible)
2. **Home page** - Large "View Main Menu" button
3. **Direct URL** - `/menu`

## Files

- **View:** [/srv/ps/views/menu.ejs](views/menu.ejs)
- **Styles:** [/srv/ps/public/stylesheets/menu.css](public/stylesheets/menu.css)
- **Route:** [/srv/ps/routes/index.js](routes/index.js) (line 35-40)

## Card Types

### Standard Card
- Game features
- Default gradient background
- Blue hover border

### Highlight Card (Purple Gradient)
- Asset Builder
- Community Voting
- White text on purple/violet gradient

### Admin Card (Pink/Red Gradient)
- Admin features only
- White text on pink gradient
- Only visible to admins

## Usage

1. Click "Main Menu" in the navigation header
2. Browse available features organized by section
3. Click any card to navigate to that feature
4. Sections and cards shown are based on user role:
   - Public: Game Features + Community
   - Authenticated: + My Content
   - Admin: + Administration

## Responsive Behavior

- **Desktop:** Multi-column grid layout
- **Tablet:** 2-column grid
- **Mobile:** Single column, stacked cards
- Cards resize and maintain readability on all screens

## Integration with Asset Builder

The menu prominently features:
- **Asset Builder** (purple highlight card) - for authenticated users
- **Community Voting** (purple highlight card) - for all visitors
- **Asset Approvals** (pink admin card) - for admins only

This provides clear discovery and access to the new asset creation workflow.
