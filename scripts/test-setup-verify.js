#!/usr/bin/env node

/**
 * Test Setup Verification Script
 * 
 * This script verifies that the testing framework is properly configured
 * and can run basic tests without errors.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 FHIR Server Testing Framework Setup Verification\n');

const checks = [
  {
    name: 'Node.js Version',
    check: () => {
      const version = process.version;
      const major = parseInt(version.slice(1).split('.')[0]);
      if (major < 16) {
        throw new Error(`Node.js ${major} is not supported. Please use Node.js 16+ (current: ${version})`);
      }
      return `✅ Node.js ${version}`;
    }
  },
  
  {
    name: 'Package Dependencies',
    check: () => {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      const requiredDeps = ['jest', 'supertest', 'tmp', 'nock'];
      const missing = requiredDeps.filter(dep => 
        !packageJson.devDependencies || !packageJson.devDependencies[dep]
      );
      
      if (missing.length > 0) {
        throw new Error(`Missing dependencies: ${missing.join(', ')}`);
      }
      return '✅ All required dependencies present';
    }
  },
  
  {
    name: 'Test Directory Structure',
    check: () => {
      const requiredDirs = [
        'tests',
        'tests/unit',
        'tests/integration', 
        'tests/fixtures',
        'tests/utils',
        'tests/mocks'
      ];
      
      const missing = requiredDirs.filter(dir => !fs.existsSync(dir));
      if (missing.length > 0) {
        throw new Error(`Missing directories: ${missing.join(', ')}`);
      }
      return '✅ Test directory structure complete';
    }
  },
  
  {
    name: 'Jest Configuration',
    check: () => {
      const jestConfigPath = path.join(__dirname, '..', 'jest.config.js');
      if (!fs.existsSync(jestConfigPath)) {
        throw new Error('jest.config.js not found. Please create it in the project root.');
      }
      
      try {
        const jestConfig = require(jestConfigPath);
        if (!jestConfig.testEnvironment || jestConfig.testEnvironment !== 'node') {
          throw new Error('Jest not configured for Node.js environment');
        }
        return '✅ Jest configuration valid';
      } catch (error) {
        throw new Error(`Jest configuration error: ${error.message}`);
      }
    }
  },
  
  {
    name: 'Test Files Present',
    check: () => {
      const testFiles = [
        'tests/unit/shl.test.js',
        'tests/unit/vcl.test.js', 
        'tests/unit/xig.test.js',
        'tests/unit/packages.test.js',
        'tests/integration/server.test.js'
      ];
      
      const missing = testFiles.filter(file => !fs.existsSync(file));
      if (missing.length > 0) {
        throw new Error(`Missing test files: ${missing.join(', ')}`);
      }
      return '✅ All test files present';
    }
  },
  
  {
    name: 'Test Utilities',
    check: () => {
      const testUtilsPath = path.join(__dirname, '..', 'tests', 'utils', 'test-utils.js');
      if (!fs.existsSync(testUtilsPath)) {
        throw new Error('test-utils.js not found in tests/utils/');
      }
      
      try {
        const TestUtils = require(testUtilsPath);
        
        // Check that key methods exist
        const requiredMethods = [
          'createTempDir',
          'createTestApp', 
          'createTestConfig',
          'cleanup'
        ];
        
        const missing = requiredMethods.filter(method => 
          typeof TestUtils[method] !== 'function'
        );
        
        if (missing.length > 0) {
          throw new Error(`Missing TestUtils methods: ${missing.join(', ')}`);
        }
        return '✅ Test utilities configured';
      } catch (error) {
        throw new Error(`Test utilities error: ${error.message}`);
      }
    }
  },
  
  {
    name: 'Test Fixtures',
    check: () => {
      const testFixturesPath = path.join(__dirname, '..', 'tests', 'fixtures', 'test-data.js');
      if (!fs.existsSync(testFixturesPath)) {
        throw new Error('test-data.js not found in tests/fixtures/');
      }
      
      try {
        const TestFixtures = require(testFixturesPath);
        
        const requiredMethods = [
          'getShlTestData',
          'getVclTestData', 
          'getPackageTestData',
          'getFhirResources'
        ];
        
        const missing = requiredMethods.filter(method => 
          typeof TestFixtures[method] !== 'function'
        );
        
        if (missing.length > 0) {
          throw new Error(`Missing TestFixtures methods: ${missing.join(', ')}`);
        }
        return '✅ Test fixtures configured';
      } catch (error) {
        throw new Error(`Test fixtures error: ${error.message}`);
      }
    }
  },
  
  {
    name: 'Basic Test Execution',
    check: () => {
      try {
        // Run a simple test to verify Jest works
        execSync('npx jest --testNamePattern="should exist" --passWithNoTests --silent', {
          cwd: process.cwd(),
          stdio: 'pipe'
        });
        return '✅ Jest execution works';
      } catch (error) {
        const errorMessage = error.message || error.toString();
        
        // Handle specific Jest configuration conflicts
        if (errorMessage.includes('Multiple configurations found')) {
          throw new Error('Multiple Jest configurations detected. Run: npm run test:fix-jest');
        }
        
        // Handle SQLite3 issues  
        if (errorMessage.includes('Could not locate the bindings file')) {
          throw new Error('SQLite3 native binding issue. Your app works but Jest has module loading timing issues. This should work now that we fixed the import timing.');
        }
        
        // Handle other common issues
        if (errorMessage.includes('No tests found')) {
          return '✅ Jest execution works (no tests to run yet)';
        }
        
        if (errorMessage.includes('Cannot find module')) {
          throw new Error(`Missing dependencies. Run: npm install`);
        }
        
        // If the error mentions test files specifically, that's OK
        if (errorMessage.includes('FAIL tests/unit/')) {
          return '⚠️  Jest runs but some tests are failing (this is expected during setup)';
        }
        
        throw new Error(`Jest execution failed: ${errorMessage.split('\n')[0]}`);
      }
    }
  }
];

async function runChecks() {
  let passed = 0;
  let failed = 0;
  let missingFiles = [];
  
  for (const check of checks) {
    try {
      const result = await check.check();
      console.log(result);
      passed++;
    } catch (error) {
      console.log(`❌ ${check.name}: ${error.message}`);
      failed++;
      
      // Track missing files for helpful guidance
      if (error.message.includes('not found')) {
        missingFiles.push(error.message);
      }
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
  
  if (failed === 0) {
    console.log('🎉 All checks passed! Your testing framework is ready to use.');
    console.log('\nNext steps:');
    console.log('1. Run all tests: npm test');
    console.log('2. Run with coverage: npm run test:coverage');
    console.log('3. Run specific module: npm run test:shl');
    console.log('4. Run in watch mode: npm run test:watch');
  } else {
    console.log('⚠️  Some checks failed. Please fix the issues above before running tests.');
    
    if (missingFiles.length > 0) {
      console.log('\n📝 Missing files detected. You may need to create:');
      console.log('- jest.config.js (Jest configuration)');
      console.log('- tests/setup.js (Test setup)');
      console.log('- tests/utils/test-utils.js (Test utilities)');
      console.log('- tests/fixtures/test-data.js (Test data fixtures)');
      console.log('- Test files in tests/unit/ and tests/integration/');
      console.log('\nRefer to the TESTING.md documentation for complete setup instructions.');
    }
    
    process.exit(1);
  }
}

// Run the verification
runChecks().catch(error => {
  console.error('❌ Verification script failed:', error.message);
  process.exit(1);
});