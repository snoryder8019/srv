#!/usr/bin/env node

/**
 * Test Runner for Stringborn Universe
 *
 * Automated test execution with real-time reporting
 * Supports parallel execution and multiple test suites
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test configuration
const config = {
  testDir: __dirname,
  suites: ['api', 'integration', 'performance'],
  parallel: process.argv.includes('--parallel'),
  verbose: process.argv.includes('--verbose'),
  suite: null
};

// Parse CLI arguments
const suiteArg = process.argv.find(arg => arg.startsWith('--suite='));
if (suiteArg) {
  config.suite = suiteArg.split('=')[1];
}

// Test results collector
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  duration: 0,
  suites: []
};

/**
 * Discover test files in a directory
 */
function discoverTests(dir) {
  const tests = [];

  if (!fs.existsSync(dir)) {
    return tests;
  }

  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      tests.push(...discoverTests(fullPath));
    } else if (item.endsWith('.test.js')) {
      tests.push(fullPath);
    }
  }

  return tests;
}

/**
 * Run a single test file
 */
async function runTest(testFile) {
  const startTime = Date.now();
  const relativePath = path.relative(__dirname, testFile);

  try {
    console.log(`  Running: ${relativePath}`);

    const { stdout, stderr } = await execPromise(`node ${testFile}`);

    const duration = Date.now() - startTime;

    if (config.verbose && stdout) {
      console.log(stdout);
    }

    // Ignore certain warnings that don't indicate test failures
    const ignoredWarnings = [
      'ExperimentalWarning',
      'MONGODB DRIVER',
      'useNewUrlParser',
      'useUnifiedTopology'
    ];
    const shouldIgnoreStderr = ignoredWarnings.some(warning => stderr.includes(warning));

    if (stderr && !shouldIgnoreStderr) {
      console.error(stderr);
      return {
        file: relativePath,
        status: 'failed',
        duration,
        error: stderr
      };
    }

    return {
      file: relativePath,
      status: 'passed',
      duration
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      file: relativePath,
      status: 'failed',
      duration,
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr
    };
  }
}

/**
 * Run all tests in a suite
 */
async function runSuite(suiteName) {
  const suiteDir = path.join(__dirname, suiteName);
  console.log(`\n📦 Running ${suiteName} tests...`);

  const tests = discoverTests(suiteDir);

  if (tests.length === 0) {
    console.log(`  ⚠️  No tests found in ${suiteName}/`);
    return {
      name: suiteName,
      tests: [],
      passed: 0,
      failed: 0,
      duration: 0
    };
  }

  const startTime = Date.now();
  let testResults;

  if (config.parallel) {
    testResults = await Promise.all(tests.map(runTest));
  } else {
    testResults = [];
    for (const test of tests) {
      testResults.push(await runTest(test));
    }
  }

  const duration = Date.now() - startTime;
  const passed = testResults.filter(r => r.status === 'passed').length;
  const failed = testResults.filter(r => r.status === 'failed').length;

  // Update global results
  results.total += tests.length;
  results.passed += passed;
  results.failed += failed;
  results.duration += duration;

  const suiteResult = {
    name: suiteName,
    tests: testResults,
    passed,
    failed,
    duration
  };

  results.suites.push(suiteResult);

  console.log(`  ✓ ${passed} passed`);
  if (failed > 0) {
    console.log(`  ✗ ${failed} failed`);
  }
  console.log(`  ⏱  ${duration}ms`);

  return suiteResult;
}

/**
 * Print test summary
 */
function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));

  console.log(`\nTotal Tests: ${results.total}`);
  console.log(`✓ Passed:    ${results.passed} (${((results.passed / results.total) * 100).toFixed(1)}%)`);

  if (results.failed > 0) {
    console.log(`✗ Failed:    ${results.failed} (${((results.failed / results.total) * 100).toFixed(1)}%)`);
  }

  console.log(`⏱  Duration:  ${results.duration}ms`);

  // Print failed tests details
  if (results.failed > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('❌ Failed Tests:');
    console.log('='.repeat(60));

    for (const suite of results.suites) {
      const failedTests = suite.tests.filter(t => t.status === 'failed');

      for (const test of failedTests) {
        console.log(`\n${test.file}`);
        console.log(`  Error: ${test.error}`);

        if (config.verbose && test.stdout) {
          console.log(`  Stdout: ${test.stdout}`);
        }
        if (config.verbose && test.stderr) {
          console.log(`  Stderr: ${test.stderr}`);
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * Save results to JSON
 */
function saveResults() {
  const resultsDir = path.join(__dirname, 'results');

  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test-results-${timestamp}.json`;
  const filepath = path.join(resultsDir, filename);

  const reportData = {
    ...results,
    timestamp: new Date().toISOString(),
    config: {
      parallel: config.parallel,
      suite: config.suite
    }
  };

  fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));

  // Also write latest.json for easy access
  fs.writeFileSync(
    path.join(resultsDir, 'latest.json'),
    JSON.stringify(reportData, null, 2)
  );

  console.log(`📄 Results saved to: ${filename}`);
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 Stringborn Universe Test Runner');
  console.log('='.repeat(60));
  console.log(`Mode: ${config.parallel ? 'Parallel' : 'Sequential'}`);

  if (config.suite) {
    console.log(`Suite: ${config.suite}`);
  }

  const startTime = Date.now();

  try {
    if (config.suite) {
      // Run specific suite
      await runSuite(config.suite);
    } else {
      // Run all suites
      for (const suite of config.suites) {
        await runSuite(suite);
      }
    }

    printSummary();
    saveResults();

    // Exit with appropriate code
    process.exit(results.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Test runner error:', error);
    process.exit(1);
  }
}

// Run tests
main();
