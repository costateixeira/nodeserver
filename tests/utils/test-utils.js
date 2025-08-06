const express = require('express');
const path = require('path');
const fs = require('fs');
const tmp = require('tmp');

class TestUtils {
  
  /**
   * Create a temporary directory for testing
   */
  static createTempDir() {
    return tmp.dirSync({ unsafeCleanup: true });
  }
  
  /**
   * Create a temporary file for testing
   */
  static createTempFile(content = '') {
    const tmpFile = tmp.fileSync();
    if (content) {
      fs.writeFileSync(tmpFile.name, content);
    }
    return tmpFile;
  }
  
  /**
   * Delay execution for specified milliseconds
   */
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Wait for a condition to be met
   */
  static async waitFor(condition, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await this.delay(50);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
  }
  
  /**
   * Create a test configuration object
   */
  static createTestConfig(overrides = {}) {
    const defaultConfig = {
      server: {
        port: 0, // Use random port for testing
        cors: {
          origin: true,
          credentials: true
        }
      },
      modules: {
        shl: {
          enabled: true,
          database: ':memory:',
          password: 'test-password',
          cleanup: {
            schedule: '0 2 * * *'
          },
          validator: {
            enabled: false, // Disable by default in tests
            version: '6.2.8',
            txServer: 'http://tx.fhir.org',
            port: 8080,
            packages: [],
            timeout: 30000
          },
          certificates: {
            certFile: 'test-cert.pem',
            keyFile: 'test-key.pem',
            kid: 'test-kid'
          },
          vhl: {
            issuer: 'test-issuer'
          }
        },
        vcl: {
          enabled: true
        },
        xig: {
          enabled: true
        },
        packages: {
          enabled: true,
          database: ':memory:',
          mirrorPath: tmp.dirSync().name,
          masterUrl: 'http://localhost:8080/test-feeds.json',
          crawler: {
            enabled: false, // Disable by default in tests
            schedule: '0 * * * *'
          }
        }
      }
    };
    
    return this.deepMerge(defaultConfig, overrides);
  }
  
  /**
   * Deep merge two objects
   */
  static deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
  
  /**
   * Create an in-memory SQLite database for testing
   * Note: This now returns a mock database when sqlite3 is mocked by Jest
   */
  static createTestDatabase() {
    // Use dynamic import to avoid loading sqlite3 at module level
    try {
      const sqlite3 = require('sqlite3');
      return new sqlite3.Database(':memory:');
    } catch (error) {
      // If sqlite3 fails to load, return a simple mock
      return {
        get: jest.fn((sql, params, callback) => {
          if (typeof params === 'function') callback = params;
          setTimeout(() => callback(null, {}), 10);
        }),
        all: jest.fn((sql, params, callback) => {
          if (typeof params === 'function') callback = params;
          setTimeout(() => callback(null, []), 10);
        }),
        run: jest.fn((sql, params, callback) => {
          if (typeof params === 'function') callback = params;
          setTimeout(() => callback.call({ lastID: 1, changes: 1 }, null), 10);
        }),
        close: jest.fn((callback) => {
          if (callback) setTimeout(callback, 10);
        })
      };
    }
  }
  
  /**
   * Create test certificates for SHL module
   */
  static createTestCertificates(tempDir) {
    const certContent = `-----BEGIN CERTIFICATE-----
MIIBkTCB+wIJALZNtQ8JjjGwMA0GCSqGSIb3DQEBCwUAMBExDzANBgNVBAMTBnRl
c3QxMB4XDTI0MDEwMTAwMDAwMFoXDTI1MDEwMTAwMDAwMFowETEPMA0GA1UEAxMG
dGVzdDEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATtest
-----END CERTIFICATE-----`;
    
    const keyContent = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgtest
-----END PRIVATE KEY-----`;
    
    const certPath = path.join(tempDir, 'test-cert.pem');
    const keyPath = path.join(tempDir, 'test-key.pem');
    
    fs.writeFileSync(certPath, certContent);
    fs.writeFileSync(keyPath, keyContent);
    
    return { certPath, keyPath };
  }
  
  /**
   * Create a test Express app with specific modules
   * This version safely handles modules that might use sqlite3
   */
  static async createTestApp(config = null, enabledModules = ['shl', 'vcl', 'xig', 'packages']) {
    const testConfig = config || this.createTestConfig();
    
    const app = express();
    app.use(express.json());
    app.use(express.raw({ type: 'application/fhir+json', limit: '10mb' }));
    app.use(express.raw({ type: 'application/fhir+xml', limit: '10mb' }));
    
    const modules = {};
    
    try {
      // Initialize only requested modules with proper error handling
      if (enabledModules.includes('shl') && testConfig.modules.shl.enabled) {
        try {
          const SHLModule = require('../../shl/shl.js');
          modules.shl = new SHLModule();
          await modules.shl.initialize(testConfig.modules.shl);
          app.use('/shl', modules.shl.router);
        } catch (error) {
          console.warn('SHL module failed to load:', error.message);
          // Create a mock SHL module
          modules.shl = {
            router: express.Router(),
            shutdown: async () => {},
            getStatus: () => ({ enabled: false, error: error.message })
          };
          app.use('/shl', modules.shl.router);
        }
      }
      
      if (enabledModules.includes('vcl') && testConfig.modules.vcl.enabled) {
        try {
          const VCLModule = require('../../vcl/vcl.js');
          modules.vcl = new VCLModule();
          await modules.vcl.initialize(testConfig.modules.vcl);
          app.use('/VCL', modules.vcl.router);
        } catch (error) {
          console.warn('VCL module failed to load:', error.message);
          modules.vcl = {
            router: express.Router(),
            shutdown: async () => {},
            getStatus: () => ({ enabled: false, error: error.message })
          };
          app.use('/VCL', modules.vcl.router);
        }
      }
      
      if (enabledModules.includes('xig') && testConfig.modules.xig.enabled) {
        try {
          const xigModule = require('../../xig/xig.js');
          await xigModule.initializeXigModule();
          app.use('/xig', xigModule.router);
          modules.xig = xigModule;
        } catch (error) {
          console.warn('XIG module failed to load:', error.message);
          modules.xig = {
            router: express.Router(),
            shutdown: async () => {},
            getCacheStats: () => ({ loaded: false }),
            isCacheLoaded: () => false
          };
          app.use('/xig', modules.xig.router);
        }
      }
      
      if (enabledModules.includes('packages') && testConfig.modules.packages.enabled) {
        try {
          const PackagesModule = require('../../packages/packages.js');
          modules.packages = new PackagesModule();
          await modules.packages.initialize(testConfig.modules.packages);
          app.use('/packages', modules.packages.router);
        } catch (error) {
          console.warn('Packages module failed to load:', error.message);
          modules.packages = {
            router: express.Router(),
            shutdown: async () => {},
            getStatus: () => ({ enabled: false, error: error.message })
          };
          app.use('/packages', modules.packages.router);
        }
      }
      
    } catch (error) {
      console.error('Error creating test app:', error);
    }
    
    // Add health check
    app.get('/health', (req, res) => {
      res.json({ status: 'OK', timestamp: new Date().toISOString() });
    });
    
    return { app, modules, config: testConfig };
  }
  
  /**
   * Mock HTTP requests for external services
   */
  static mockExternalServices() {
    const nock = require('nock');
    
    // Mock FHIR package feeds
    nock('http://localhost:8080')
      .get('/test-feeds.json')
      .reply(200, {
        feeds: [
          {
            name: 'test-feed',
            url: 'http://localhost:8080/test-feed'
          }
        ]
      });
    
    // Mock FHIR TX server
    nock('http://tx.fhir.org')
      .persist()
      .get(/.*/)
      .reply(200, { resourceType: 'OperationOutcome', issue: [] });
    
    return nock;
  }

  /**
   * Clean up test resources
   */
  static async cleanup(modules) {
    if (!modules) return;
    
    for (const [moduleName, moduleInstance] of Object.entries(modules)) {
      try {
        if (moduleInstance && typeof moduleInstance.shutdown === 'function') {
          await moduleInstance.shutdown();
        }
      } catch (error) {
        console.warn(`Error shutting down ${moduleName}:`, error.message);
      }
    }
  }
  
  /**
   * Wait for database to be ready
   */
  static waitForDatabase(db, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      
      const check = () => {
        if (Date.now() - start > timeout) {
          reject(new Error('Database timeout'));
          return;
        }
        
        db.get('SELECT 1', (err) => {
          if (err) {
            setTimeout(check, 50);
          } else {
            resolve();
          }
        });
      };
      
      check();
    });
  }
  
  /**
   * Create test data for SHL module
   */
  static createTestSHLData() {
    return {
      validSHL: {
        vhl: false,
        password: 'test-password',
        days: 7
      },
      validFiles: [
        {
          cnt: Buffer.from('test file content').toString('base64'),
          type: 'application/fhir+json'
        }
      ]
    };
  }
  
  /**
   * Create test data for Packages module
   */
  static createTestPackageData() {
    return {
      packages: [
        {
          id: 'test.package',
          version: '1.0.0',
          content: Buffer.from('test package content'),
          url: 'http://example.com/test.package-1.0.0.tgz'
        }
      ]
    };
  }
}

module.exports = TestUtils;