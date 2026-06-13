# Test Suite - Stringborn Universe

Comprehensive testing framework with performance monitoring and visual analytics.

## 📁 Directory Structure

```
test/
├── api/                      # API endpoint tests
│   ├── assets.test.js        # Asset API tests
│   └── characters.test.js    # Character API tests
├── integration/              # Integration tests
│   ├── database.test.js      # MongoDB integration tests
│   └── services.test.js      # External service tests
├── performance/              # Performance benchmarks
│   ├── database.test.js      # Database query performance
│   ├── api-response.test.js  # API response time tests
│   └── memory-usage.test.js  # Memory and resource tests
├── utils/                    # Test utilities
│   └── test-helpers.js       # Custom test framework
├── results/                  # Test result JSON files
│   ├── latest.json          # Most recent test run
│   └── test-results-*.json  # Historical results
├── runner.js                 # Main test runner
├── PERFORMANCE_TESTS.md      # Performance test documentation
├── DASHBOARD_FEATURES.md     # Dashboard features guide
└── README.md                 # This file
```

## 🚀 Quick Start

### Run All Tests
```bash
node /srv/ps/test/runner.js
```

### Run Specific Suite
```bash
# API tests only
node /srv/ps/test/runner.js --suite=api

# Integration tests
node /srv/ps/test/runner.js --suite=integration

# Performance tests
node /srv/ps/test/runner.js --suite=performance
```

### Run Individual Test
```bash
node /srv/ps/test/api/assets.test.js
node /srv/ps/test/performance/database.test.js
```

## 📊 Test Suites

### API Tests (2 tests)
- Asset API endpoints
- Character API endpoints
- **Duration:** ~245ms

### Integration Tests (2 tests)
- Database connectivity and operations
- External service integration
- **Duration:** ~1.4s

### Performance Tests (3 tests)
- Database query performance (7 sub-tests)
- API response times (7 sub-tests)
- Memory and resource usage (7 sub-tests)
- **Duration:** ~12s

**Total:** 7 test files, 21 sub-tests, ~14s duration

## ✅ Current Status

```
Test Suite: ████████████████████████████████ 100%
Total Tests: 7
Passed: 7
Failed: 0
Pass Rate: 100%
Avg Duration: 13.9s
```

## 📈 Live Dashboard

Access the enhanced test metrics dashboard:

**URL:** https://ps.madladslab.com/admin/live-dashboard

### Features:
- ✅ **Real-time Metrics Cards**
- 📊 **Chart.js 2D Charts** (bar & line charts)
- 🎮 **Three.js 3D Visualization** (rotating 3D bars)
- 📋 **Suite Performance Breakdown**
- 📈 **Test History Trends** (last 20 runs)
- 🔄 **Auto-refresh** after test runs

## 🧪 Test Framework

Custom lightweight testing framework (no external dependencies):

```javascript
import { describe, expect } from '../utils/test-helpers.js';

await describe('My Test Suite', runner => {
  runner.it('should do something', async () => {
    const result = await myFunction();
    expect(result).toBe(expected);
  });
});
```

### Available Assertions:
- `expect(value).toBe(expected)`
- `expect(value).toEqual(expected)`
- `expect(value).toBeTruthy()`
- `expect(value).toBeFalsy()`
- `expect(value).toBeGreaterThan(n)`
- `expect(value).toBeLessThan(n)`
- `expect(value).toContain(substring)`
- `expect(fn).toThrow()`
- `expect(promise).rejects()`
- `expect(promise).resolves()`

## 📦 Test Results

Results are automatically saved to `/srv/ps/test/results/`:

### Format:
```json
{
  "total": 7,
  "passed": 7,
  "failed": 0,
  "duration": 13900,
  "timestamp": "2025-10-29T01:45:09.227Z",
  "suites": [
    {
      "name": "api",
      "passed": 2,
      "failed": 0,
      "duration": 245,
      "tests": [...]
    }
  ]
}
```

## 🎯 Performance Thresholds

### Database
- Simple queries: < 100ms
- Indexed queries: < 100ms
- Complex queries: < 500ms

### API
- Health checks: < 50ms
- Simple GET: < 200ms
- API endpoints: < 500ms

### Memory
- Event loop lag: < 10ms
- Memory leak tolerance: < 50MB

## 🔧 Configuration

### Test Runner Options:
- `--suite=<name>`: Run specific suite
- `--parallel`: Run tests in parallel (faster but may cause race conditions)
- `--verbose`: Show detailed output

### Environment Variables:
- `DB_URL`: MongoDB connection string
- `DB_NAME`: Database name
- `BASE_URL`: Application base URL (default: http://localhost:3399)
- `GAME_STATE_SERVICE_URL`: Game state service URL

## 📝 Writing Tests

### Example Test:
```javascript
import { describe, expect } from '../utils/test-helpers.js';

await describe('Feature Name', runner => {
  runner.it('should test specific behavior', async () => {
    // Arrange
    const input = 'test';

    // Act
    const result = await processInput(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

### Best Practices:
1. **Cleanup**: Always close connections (database, files, etc.)
2. **Isolation**: Tests should not depend on each other
3. **Clear Names**: Describe what the test validates
4. **Fast Tests**: Keep tests under 1 second when possible
5. **Error Handling**: Test both success and failure cases

## 🔍 Debugging Tests

### Run with verbose output:
```bash
node /srv/ps/test/runner.js --verbose
```

### Check individual test:
```bash
node /srv/ps/test/integration/database.test.js
```

### View test results:
```bash
cat /srv/ps/test/results/latest.json | python3 -m json.tool
```

## 📚 Documentation

- [Performance Tests Guide](PERFORMANCE_TESTS.md)
- [Dashboard Features](DASHBOARD_FEATURES.md)
- Test Helpers: `/srv/ps/test/utils/test-helpers.js`

## 🤝 Contributing

### Adding New Tests:
1. Create test file in appropriate directory
2. Follow naming convention: `*.test.js`
3. Import test helpers
4. Write tests using `describe` and `expect`
5. Ensure cleanup (close connections, etc.)
6. Run tests to verify

### Adding New Suite:
1. Create new directory under `test/`
2. Add suite name to `runner.js` config
3. Write tests following existing patterns
4. Update documentation

## 🚨 Troubleshooting

### Tests Hanging:
- Ensure all database connections are closed
- Check for missing `process.exit()`
- Look for unclosed timers/intervals

### Tests Failing:
- Check environment variables are set
- Verify database connection
- Ensure services are running
- Review error messages in output

### Performance Tests Slow:
- Network latency to MongoDB Atlas
- System load/resources
- Concurrent operations

## 📞 Support

For issues or questions:
1. Check test output for error messages
2. Review relevant documentation
3. Check live dashboard for system status
4. Review recent code changes

---

**Last Updated:** 2025-10-29
**Total Tests:** 7 test files, 21 sub-tests
**Pass Rate:** 100%
**Coverage:** API, Integration, Performance
