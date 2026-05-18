# README for views/superadmin/scottsGateway

## Purpose
This directory contains code for a superadmin route named `scottsGateway`, which allows authorized users to manage and consolidate data from three tenant accounts on sLab. The primary goals are:
- Combine remote control functionality.
- Update a single view into a calendar consolidating both personal and wife's calendars.
- Leverage the AI capabilities of Ollama LLM for aggregating information.

## Key Files
- `index.js`: Main logic for handling requests.
- `auth.js`: Authentication and authorization setup.
- `calendar-aggregator.js`: Aggregates data from multiple sources.
- `remote-control.js`: Manages remote control functionality.

## Quick Reference

### Access Control
- **Accessible to:** Myself (`madladsalb`) and my wife (w2marketing).
- **Authentication:** Uses tokens from sLab accounts for authorization.

### Routes
- `/scottsGateway/mission-control`: Main view for consolidated information.
- `/remote/:id`: Remote control endpoint for specific devices.

### Features
- Consolidates family activities, bills, events, and birthdays into a single view.
- Utilizes AI to provide aggregated insights.
- Allows updating and switching views on a master main view.

### Usage
1. Ensure you have the necessary tokens from sLab accounts.
2. Navigate to `/scottsGateway/mission-control` in your browser or via API calls.
3. Use `/remote/:id` for remote control functionality.

## Notes
This route is intended for personal and family coordination purposes only.