/**
 * Test Helper Utilities
 * Simple testing framework without external dependencies
 */

export class TestRunner {
  constructor(name) {
    this.name = name;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  it(description, testFn) {
    this.tests.push({ description, testFn });
  }

  async run() {
    console.log(`\n🧪 ${this.name}`);
    console.log('-'.repeat(60));

    for (const test of this.tests) {
      try {
        await test.testFn();
        console.log(`  ✓ ${test.description}`);
        this.passed++;
      } catch (error) {
        console.log(`  ✗ ${test.description}`);
        console.log(`    ${error.message}`);
        this.failed++;
      }
    }

    console.log('\n' + '-'.repeat(60));
    console.log(`Results: ${this.passed} passed, ${this.failed} failed`);

    if (this.failed > 0) {
      process.exit(1);
    }
  }
}

export function describe(name, fn) {
  const runner = new TestRunner(name);
  fn(runner);
  return runner.run();
}

export class Expect {
  constructor(actual) {
    this.actual = actual;
  }

  toBe(expected) {
    if (this.actual !== expected) {
      throw new Error(`Expected ${expected} but got ${this.actual}`);
    }
  }

  toEqual(expected) {
    if (JSON.stringify(this.actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(this.actual)}`
      );
    }
  }

  toBeTruthy() {
    if (!this.actual) {
      throw new Error(`Expected truthy value but got ${this.actual}`);
    }
  }

  toBeFalsy() {
    if (this.actual) {
      throw new Error(`Expected falsy value but got ${this.actual}`);
    }
  }

  toBeGreaterThan(expected) {
    if (this.actual <= expected) {
      throw new Error(`Expected ${this.actual} to be greater than ${expected}`);
    }
  }

  toBeLessThan(expected) {
    if (this.actual >= expected) {
      throw new Error(`Expected ${this.actual} to be less than ${expected}`);
    }
  }

  toContain(expected) {
    if (!this.actual.includes(expected)) {
      throw new Error(`Expected ${this.actual} to contain ${expected}`);
    }
  }

  toThrow() {
    let threw = false;
    try {
      this.actual();
    } catch (error) {
      threw = true;
    }
    if (!threw) {
      throw new Error('Expected function to throw an error');
    }
  }

  async rejects() {
    let threw = false;
    try {
      await this.actual;
    } catch (error) {
      threw = true;
    }
    if (!threw) {
      throw new Error('Expected promise to reject');
    }
  }

  async resolves() {
    try {
      await this.actual;
    } catch (error) {
      throw new Error(`Expected promise to resolve but it rejected: ${error.message}`);
    }
  }
}

export function expect(actual) {
  return new Expect(actual);
}

export async function before(fn) {
  await fn();
}

export async function after(fn) {
  await fn();
}

export function it(description, testFn) {
  // For use inside describe blocks
  return { description, testFn };
}

/**
 * Mock HTTP request
 */
export function mockRequest(options = {}) {
  return {
    body: options.body || {},
    query: options.query || {},
    params: options.params || {},
    user: options.user || null,
    headers: options.headers || {}
  };
}

/**
 * Mock HTTP response
 */
export function mockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},

    status(code) {
      this.statusCode = code;
      return this;
    },

    json(data) {
      this.body = data;
      return this;
    },

    send(data) {
      this.body = data;
      return this;
    },

    render(view, data) {
      this.view = view;
      this.body = data;
      return this;
    },

    redirect(url) {
      this.redirectUrl = url;
      return this;
    }
  };

  return res;
}

/**
 * Async timeout helper
 */
export function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random test data
 */
export function randomString(length = 10) {
  return Math.random().toString(36).substring(2, length + 2);
}

export function randomNumber(min = 0, max = 100) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomEmail() {
  return `test-${randomString()}@example.com`;
}

export function randomUsername() {
  return `user_${randomString(8)}`;
}
