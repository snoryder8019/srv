# Test Service Quick Start Guide

## 🚀 Getting Started in 30 Seconds

### For Admins - Using the Live Dashboard

1. **Access the Dashboard**
   ```
   Navigate to: http://localhost:3399/admin/live-dashboard
   Or click: ⚡ Live Dashboard from the main menu
   ```

2. **What You'll See**
   - **System Metrics** - CPU, Memory, Database, Uptime (top row)
   - **Service Status** - All microservices with health indicators
   - **Test Runner** - Execute tests with one click
   - **Cron Jobs** - View and trigger scheduled tasks
   - **Database Metrics** - Live collection counts

3. **Run Your First Test**
   - Click **"Run All Tests"** button
   - Watch the output in the console below
   - See results: Total, Passed, Failed, Duration

### For Developers - Running Tests Locally

```bash
# Navigate to project directory
cd /srv/ps

# Run all tests
node test/runner.js

# Run specific suite
node test/runner.js --suite=api
node test/runner.js --suite=integration

# Run tests in parallel (faster)
node test/runner.js --parallel

# Verbose output (detailed logs)
node test/runner.js --verbose
```

### For Developers - Writing Your First Test

1. **Create a test file**
   ```bash
   touch test/api/my-feature.test.js
   ```

2. **Write the test**
   ```javascript
   import { describe, expect } from '../utils/test-helpers.js';

   await describe('My Feature', runner => {
     runner.it('should work correctly', async () => {
       const result = 2 + 2;
       expect(result).toBe(4);
     });

     runner.it('should handle errors', async () => {
       const shouldFail = () => { throw new Error('test'); };
       expect(shouldFail).toThrow();
     });
   });
   ```

3. **Run your test**
   ```bash
   node test/runner.js --suite=api
   ```

## 📊 Test Results Location

- **Latest:** `/srv/ps/test/results/latest.json`
- **Historical:** `/srv/ps/test/results/test-results-<timestamp>.json`

## 🎨 Dashboard Features at a Glance

### Real-Time Monitoring (5-second refresh)
- ✅ CPU Usage with visual progress bar
- ✅ Memory Usage with MB display
- ✅ Database connection status
- ✅ Server uptime tracker

### Service Health Checks
- 🟢 Healthy - Service responding normally
- 🟡 Degraded - Service has issues
- 🔴 Down - Service unavailable

### Test Execution
- **Run All Tests** - Complete test suite
- **API Tests** - Endpoint validation only
- **Integration Tests** - Database and services
- **Performance Tests** - Load and stress tests

### Cron Job Management
- View all scheduled jobs
- See active/inactive status
- Trigger jobs manually
- Refresh job list on-demand

## 🔧 Common Tasks

### Test Database Connection
1. Go to Live Dashboard
2. Find "Database" card
3. Click "Test Connection"
4. See result in alert

### Trigger a Cron Job Manually
1. Scroll to "⏰ Scheduled Jobs"
2. Find the job you want to run
3. Click "Trigger Now"
4. Confirm success in alert

### Monitor Service Health
1. Check "🔧 Services Status" section
2. Green dot = healthy
3. Red dot = needs attention
4. Click "Refresh" to update

### View Test Results
1. Click any test button
2. Watch console output
3. See pass/fail counts
4. Check duration metrics

## 📁 Directory Structure

```
test/
├── api/              ← API endpoint tests
├── integration/      ← Database & service tests
├── performance/      ← Load & stress tests
├── fixtures/         ← Sample test data
├── utils/            ← Test helper functions
└── results/          ← Test execution results
```

## 🎯 What Gets Tested

### API Tests
- Character creation validation
- Asset workflow checks
- Data format verification

### Integration Tests
- MongoDB connection
- Collection existence
- External service health
- Query performance

### Performance Tests
- (Framework ready for your tests!)

## 💡 Pro Tips

1. **Run tests before committing** - Catch issues early
2. **Use `--parallel` for speed** - Faster test execution
3. **Check latest.json** - Quick result review
4. **Monitor CPU/Memory** - System health insights
5. **Trigger cron jobs manually** - Test scheduled tasks

## 🆘 Troubleshooting

### Tests Won't Run
```bash
# Check if MongoDB is running
systemctl status mongod

# Check if server is running
lsof -i :3399

# Try running a single test
node test/api/characters.test.js
```

### Dashboard Not Loading
1. Verify you're logged in as admin
2. Check server logs for errors
3. Clear browser cache
4. Restart the server

### Services Showing "Down"
1. Click "Refresh" to retry
2. Check if service is actually running
3. Verify port numbers are correct
4. Review service logs

## 📚 More Information

- **Full Documentation:** [test/README.md](README.md)
- **Implementation Details:** [TEST_SERVICE_IMPLEMENTATION.md](../TEST_SERVICE_IMPLEMENTATION.md)
- **Project Overview:** [zMDREADME/PROJECT_OVERVIEW.md](../zMDREADME/PROJECT_OVERVIEW.md)

---

**Ready to build and test!** 🚀

*The test service is production-ready and the live dashboard is fully operational.*
