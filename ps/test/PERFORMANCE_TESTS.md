# Performance Tests

Comprehensive performance testing suite for the Stringborn Universe platform.

## Overview

The performance test suite measures critical application metrics including:
- Database query performance
- API response times
- Memory usage and leak detection
- Resource utilization
- Concurrent operation handling

## Test Suites

### 1. Database Performance (`database.test.js`)

Tests database query performance with strict thresholds to ensure optimal data access.

**Tests Include:**
- Simple queries (< 100ms)
- Indexed queries (< 100ms)
- Aggregation queries (< 500ms)
- Filtered asset queries (< 100ms)
- Character lookup by user (< 100ms)
- Complex join operations (< 500ms)
- Collection size metrics

**Typical Duration:** ~1.5s

### 2. API Response Performance (`api-response.test.js`)

Measures HTTP endpoint response times and throughput.

**Tests Include:**
- Health check response time (< 50ms)
- Static page load times (< 200ms)
- Concurrent request handling (10 parallel requests)
- Game State Service connectivity (< 500ms)
- Latency distribution analysis (20 requests)
- Timeout handling
- Response payload size monitoring

**Typical Duration:** ~500ms

### 3. Memory & Resource Usage (`memory-usage.test.js`)

Monitors memory consumption and detects potential memory leaks.

**Tests Include:**
- Baseline memory usage measurement
- Memory leak detection during database operations
- Large query result handling
- Event loop lag measurement (< 10ms average)
- Concurrent operation memory usage
- Module compilation time
- Final resource usage report

**Typical Duration:** ~10s

## Running Performance Tests

### From Command Line

```bash
# Run all tests including performance
node /srv/ps/test/runner.js

# Run only performance tests
node /srv/ps/test/runner.js --suite=performance

# Run individual test
node /srv/ps/test/performance/database.test.js
```

### From Live Dashboard

Navigate to: https://ps.madladslab.com/admin/live-dashboard

Click the **"Performance Tests"** button in the Automated Testing section.

## Performance Thresholds

### Database
- Simple Query: 100ms
- Complex Query: 500ms
- Indexed Query: 100ms
- Bulk Operation: 1000ms

### API
- Health Check: 50ms
- Simple GET: 200ms
- API Endpoint: 500ms
- Heavy Endpoint: 1000ms

### Memory
- Memory Leak Tolerance: 50MB increase
- Event Loop Lag: < 10ms average

## Test Results

Results are automatically saved to `/srv/ps/test/results/` with:
- Timestamped JSON files
- `latest.json` for easy access
- Detailed metrics per test

## Current Status

✅ **All Performance Tests Passing (3/3)**

- API Response: 488ms
- Database: 1538ms
- Memory Usage: 10258ms
- **Total Duration: ~12.3s**

## Interpreting Results

### Success Indicators
- All tests pass within thresholds
- Memory increase < 50MB
- Event loop lag < 10ms
- Response times consistent across runs

### Warning Signs
- Increasing response times over time
- Memory usage growing beyond baseline
- Event loop lag spikes
- Failed concurrent request handling

## Continuous Monitoring

The performance tests should be run:
- Before each deployment
- After major code changes
- Weekly as part of maintenance
- When investigating performance issues

## Integration

Performance tests are integrated with:
- Test runner (`runner.js`)
- Live dashboard API endpoint
- Result tracking system
- CI/CD pipeline (recommended)

## Future Enhancements

Planned additions:
- Load testing (concurrent users)
- Stress testing (resource limits)
- Endurance testing (long-running)
- Network latency simulation
- Database connection pool monitoring
- Cache hit rate metrics

## Notes

- Tests use MongoDB Atlas (network latency included)
- Thresholds account for cloud database latency
- Memory tests are informational and adaptive
- Some tests may vary based on system load

---

**Last Updated:** 2025-10-29
**Test Coverage:** 7 total tests (2 API, 2 Integration, 3 Performance)
**Pass Rate:** 100%
