# Enhanced Live Dashboard - Test Metrics & Analytics

Comprehensive test metrics visualization dashboard with real-time charts, 3D graphics, and performance analytics.

## 🚀 New Features

### 1. **Key Metrics Cards**
- **Total Tests**: Real-time count of all tests in the suite
- **Pass Rate**: Percentage of passing tests with color indicators
- **Average Duration**: Mean execution time across test runs
- **Trend Analysis**: Improving/Stable/Declining indicator with trend icons

### 2. **Test Results Distribution Chart** (Chart.js)
- **Type**: Horizontal bar chart
- **Data**: Passed vs Failed tests per suite (API, Integration, Performance)
- **Colors**:
  - Green (#00ff9f) for passed tests
  - Red (#ff5252) for failed tests
- **Features**: Responsive, interactive tooltips

### 3. **Test History Trend Chart** (Chart.js)
- **Type**: Dual-axis line chart
- **Data**: Last 20 test runs
- **Metrics**:
  - Pass Rate % (left axis, green line)
  - Duration in seconds (right axis, blue line)
- **Features**:
  - Filled areas for better visibility
  - Smooth curves (tension: 0.4)
  - Hover interaction

### 4. **3D Performance Visualization** (Three.js)
- **Type**: 3D bar chart
- **Data**: Suite performance as 3D colored bars
- **Colors**:
  - Green (#00ff9f): 100% pass rate
  - Blue (#64b5f6): >50% pass rate
  - Red (#ff5252): <50% pass rate
- **Features**:
  - Rotate button for animated camera movement
  - Real-time rendering at 60fps
  - Phong material with emissive glow
  - Grid floor for spatial reference
  - Suite labels as 3D sprites

### 5. **Suite Performance Breakdown**
- **Type**: Detailed panel cards
- **Per Suite Metrics**:
  - Total tests count
  - Passed tests
  - Execution duration
  - Visual progress bar
- **Color Coding**: Based on pass rate

## 📊 API Endpoints

### GET `/admin/api/tests/metrics`
Returns comprehensive test metrics and history.

**Response:**
```json
{
  "success": true,
  "latest": {
    "total": 7,
    "passed": 7,
    "failed": 0,
    "duration": 13900,
    "suites": [...]
  },
  "history": [...],
  "metrics": {
    "passRate": "100.0",
    "avgDuration": "13900",
    "totalRuns": 20,
    "trend": "stable"
  }
}
```

## 🎨 Visualization Libraries

### Chart.js v4.4.0
- 2D charting library
- Used for: Bar charts, line charts
- CDN: `https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js`

### Three.js v0.158.0
- 3D graphics library
- Used for: 3D bar visualization
- CDN: `https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js`

## 🔄 Auto-Refresh

- **Test Metrics**: Refreshed after each test run
- **System Status**: Every 5 seconds
- **Manual Refresh**: Run test buttons trigger metric updates

## 📈 Trend Calculation

Trends are calculated by comparing:
- Recent 5 test runs
- Older 5 test runs (6-10)

**Categories:**
- **Improving**: Pass rate increased by >5%
- **Declining**: Pass rate decreased by >5%
- **Stable**: Pass rate change within ±5%

## 🎮 Interactive Features

### 3D Chart Controls
- **Rotate Button**: Toggles automatic camera rotation
- **Animation**: Smooth orbital movement around test bars
- **Camera**: Perspective view with dynamic positioning

### Chart Interactions
- **Hover**: Tooltips show exact values
- **Legend**: Click to toggle dataset visibility
- **Responsive**: Adapts to container size

## 🎨 Color Scheme

**Primary Colors:**
- Purple: `#8a4fff` (accent, borders, grids)
- Green: `#00ff9f` (success, passed tests)
- Red: `#ff5252` (failure, failed tests)
- Blue: `#64b5f6` (info, partial success)
- Dark: `#0a0e27` (background)

**Opacity Levels:**
- Cards: `rgba(138, 79, 255, 0.05)`
- Grids: `rgba(138, 79, 255, 0.2)`
- Charts: 80% for bars, 10% for fills

## 📱 Responsive Design

- **Grid Layout**: Auto-fit with minimum 200px per card
- **Charts**: Maintain aspect ratio in containers
- **3D Canvas**: Fixed 400px height, full width
- **Mobile**: Stacks vertically on small screens

## 🚦 Status Indicators

**Test Status Colors:**
- Green: All tests passed
- Red: Some tests failed
- Yellow: Tests running
- Gray: Ready to run

## 📊 Metrics Calculated

1. **Pass Rate**: `(passed / total) × 100`
2. **Average Duration**: Mean of last 20 runs
3. **Total Runs**: Count of test result files
4. **Trend**: Statistical comparison of recent vs older runs

## 🔧 Technical Details

### Chart.js Configuration
- **Responsive**: true
- **Maintain Aspect Ratio**: false (for fixed heights)
- **Font**: Courier New (monospace)
- **Grid Color**: Semi-transparent purple

### Three.js Scene Setup
- **Scene Background**: #0a0e27
- **Camera**: PerspectiveCamera (75° FOV)
- **Lighting**: Ambient + Point light
- **Materials**: MeshPhongMaterial with emissive glow

### Performance
- **3D Render Loop**: requestAnimationFrame (~60fps)
- **Chart Updates**: Only on data change
- **History Limit**: Last 20 runs to prevent memory bloat

## 📍 Access

**URL:** https://ps.madladslab.com/admin/live-dashboard

**Requirements:**
- Admin authentication required
- Modern browser with WebGL support
- JavaScript enabled

## 🎯 Usage Examples

### View Latest Test Results
1. Navigate to dashboard
2. Scroll to "Test Metrics & Analytics" section
3. View key metrics cards at top

### Analyze Trends
1. Check "Test History" chart
2. Observe pass rate trend line
3. Compare with duration trend

### Inspect 3D Visualization
1. Click "Rotate" button to start animation
2. Observe bar heights (higher = better)
3. Note colors (green = perfect)

### Run New Tests
1. Scroll to "Test Runner" section
2. Click desired test suite button
3. Charts auto-update on completion

## 🐛 Troubleshooting

**Charts not displaying:**
- Check browser console for CDN errors
- Verify Chart.js/Three.js loaded successfully
- Ensure canvas elements exist in DOM

**3D visualization blank:**
- Check WebGL support in browser
- Verify Three.js library loaded
- Check container dimensions

**Metrics not updating:**
- Verify `/admin/api/tests/metrics` endpoint responds
- Check test results files exist in `/srv/ps/test/results/`
- Ensure `latest.json` is up to date

## 🔮 Future Enhancements

- [ ] Real-time streaming test output
- [ ] Test coverage visualization
- [ ] Performance regression detection
- [ ] Alert system for failing tests
- [ ] Export metrics to CSV/PDF
- [ ] Test duration heatmap
- [ ] Comparative analysis between runs
- [ ] Custom date range filtering

---

**Created:** 2025-10-29
**Version:** 1.0.0
**Dependencies:** Chart.js 4.4.0, Three.js 0.158.0
