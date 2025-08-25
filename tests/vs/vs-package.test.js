const fs = require('fs').promises;
const path = require('path');
const { describe, beforeAll, afterAll, test, expect } = require('@jest/globals');
const { PackageManager } = require('../../library/package-manager');
const { PackageValueSetProvider } = require('../../tx/vs/vs-package');

describe('PackageValueSetProvider', () => {
  let packageManager;
  let packagePath;
  let provider;
  const packageCacheDir = path.join(__dirname, '../../package-cache');
  const packageId = 'hl7.fhir.uv.tools';
  const packageVersion = '0.8.0';

  beforeAll(async () => {
    // Setup package manager
    packageManager = new PackageManager(
      ['https://packages.simplifier.net', 'https://packages2.fhir.org/packages'],
      packageCacheDir
    );

    try {
      // Fetch the test package
      console.log(`Fetching package ${packageId}#${packageVersion}...`);
      packagePath = await packageManager.fetch(packageId, packageVersion);
      console.log(`Package extracted to: ${packagePath}`);

      // Create provider
      const fullPackagePath = path.join(packageCacheDir, packagePath);
      provider = new PackageValueSetProvider(fullPackagePath);

      // Initialize provider (this creates the database if needed)
      await provider.initialize();
      console.log('Provider initialized successfully');

    } catch (error) {
      console.error('Failed to setup test package:', error);
      throw error;
    }
  }, 60000); // 60 second timeout for package fetch

  afterAll(async () => {
    // Cleanup is not strictly necessary as test files can remain
    // But we could add database cleanup here if needed
  });

  describe('Initialization and Statistics', () => {
    test('should initialize without errors', async () => {
      expect(provider).toBeDefined();
      expect(provider.initialized).toBe(true);
    });

    test('should return statistics', async () => {
      const stats = await provider.getStatistics();

      expect(stats).toHaveProperty('totalValueSets');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('totalSystems');
      expect(typeof stats.totalValueSets).toBe('number');
      expect(stats.totalValueSets).toBeGreaterThan(0);

      console.log('Package statistics:', stats);
    });

    test('should have valuesets loaded in map', () => {
      const mapSize = provider.getMapSize();
      expect(mapSize).toBeGreaterThan(0);
      console.log(`ValueSets loaded in map: ${mapSize}`);
    });
  });

  describe('fetchValueSet', () => {
    test('should fetch valueset by exact URL and version', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/additional-binding-purpose';
      const version = '0.8.0';

      const valueSet = await provider.fetchValueSet(url, version);

      expect(valueSet).toBeDefined();
      expect(valueSet.resourceType).toBe('ValueSet');
      expect(valueSet.url).toBe(url);
      expect(valueSet.version).toBe(version);
      expect(valueSet.id).toBe('additional-binding-purpose');
      expect(valueSet.name).toBe('AdditionalBindingPurposeVS');
    });

    test('should fetch valueset by URL alone when version matches', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/binding-style';
      const version = '0.8.0';

      const valueSet = await provider.fetchValueSet(url, version);

      expect(valueSet).toBeDefined();
      expect(valueSet.resourceType).toBe('ValueSet');
      expect(valueSet.url).toBe(url);
      expect(valueSet.id).toBe('binding-style');
      expect(valueSet.name).toBe('VocabBindingStylesVS');
    });

    test('should handle semver major.minor resolution', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/CDSActionType';

      // Try to fetch with a different patch version
      const valueSet = await provider.fetchValueSet(url, '0.8.1');

      expect(valueSet).toBeDefined();
      expect(valueSet.url).toBe(url);
      expect(valueSet.version).toBe('0.8.0'); // Should resolve to existing 0.8.0
    });

    test('should throw error for non-existent valueset', async () => {
      await expect(
        provider.fetchValueSet('http://example.com/non-existent', '1.0.0')
      ).rejects.toThrow('Value set not found');
    });

    test('should validate input parameters', async () => {
      await expect(
        provider.fetchValueSet('', '1.0.0')
      ).rejects.toThrow('URL must be a non-empty string');

      await expect(
        provider.fetchValueSet('http://example.com/test', '')
      ).rejects.toThrow('Version must be a non-empty string');
    });
  });

  describe('searchValueSets', () => {
    test('should search by status', async () => {
      const results = await provider.searchValueSets([
        { name: 'status', value: 'active' }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // All results should have active status
      for (const vs of results) {
        expect(vs.status).toBe('active');
      }

      console.log(`Found ${results.length} active ValueSets`);
    });

    test('should search by publisher', async () => {
      const results = await provider.searchValueSets([
        { name: 'publisher', value: 'HL7' }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // All results should have publisher containing 'HL7'
      for (const vs of results) {
        expect(vs.publisher).toContain('HL7');
      }

      console.log(`Found ${results.length} ValueSets with HL7 publisher`);
    });

    test('should search by name pattern', async () => {
      const results = await provider.searchValueSets([
        { name: 'name', value: 'CDS' }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // All results should have name containing 'CDS'
      for (const vs of results) {
        expect(vs.name).toContain('CDS');
      }

      console.log(`Found ${results.length} ValueSets with 'CDS' in name`);
    });

    test('should search by url', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/primitive-types';
      const results = await provider.searchValueSets([
        { name: 'url', value: url }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].url).toBe(url);
      expect(results[0].name).toBe('PrimitiveTypesVS');
    });

    test('should search with multiple criteria', async () => {
      const results = await provider.searchValueSets([
        { name: 'status', value: 'active' },
        { name: 'publisher', value: 'HL7' }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // All results should match both criteria
      for (const vs of results) {
        expect(vs.status).toBe('active');
        expect(vs.publisher).toContain('HL7');
      }

      console.log(`Found ${results.length} active HL7 ValueSets`);
    });

    test('should search by system in compose', async () => {
      const results = await provider.searchValueSets([
        { name: 'system', value: 'http://hl7.org/fhir/tools/CodeSystem/additional-binding-purpose' }
      ]);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      console.log(`Found ${results.length} ValueSets using the specified system`);
    });

    test('should handle empty search criteria', async () => {
      const results = await provider.searchValueSets([]);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    test('should validate search parameters', async () => {
      await expect(
        provider.searchValueSets('not an array')
      ).rejects.toThrow('Search parameters must be an array');

      await expect(
        provider.searchValueSets([{ name: 123, value: 'test' }])
      ).rejects.toThrow('Search parameter must have string name and value properties');
    });
  });

  describe('Specific ValueSet Content Validation', () => {
    test('should correctly load primitive-types ValueSet', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/primitive-types';
      const version = '0.8.0';

      const valueSet = await provider.fetchValueSet(url, version);

      expect(valueSet.id).toBe('primitive-types');
      expect(valueSet.name).toBe('PrimitiveTypesVS');
      expect(valueSet.title).toBe('Primitive Types ValueSet');
      expect(valueSet.status).toBe('active');
      expect(valueSet.experimental).toBe(false);
      expect(valueSet.compose.include).toHaveLength(1);
      expect(valueSet.compose.include[0].system).toBe('http://hl7.org/fhir/fhir-types');
      expect(valueSet.compose.include[0].concept).toHaveLength(20); // Should have 20 primitive types
    });

    test('should correctly load retired ValueSet', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/select-by-map-filter';
      const version = '0.8.0';

      const valueSet = await provider.fetchValueSet(url, version);

      expect(valueSet.id).toBe('select-by-map-filter');
      expect(valueSet.status).toBe('retired');
      expect(valueSet.compose.include).toHaveLength(2);

      // Check the valueSet include
      expect(valueSet.compose.include[0].valueSet).toContain('http://hl7.org/fhir/ValueSet/concept-map-relationship');

      // Check the system include
      expect(valueSet.compose.include[1].system).toBe('http://hl7.org/fhir/tools/CodeSystem/r4-equivalence');
    });

    test('should handle ValueSets with identifiers', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/additional-binding-purpose';

      const valueSet = await provider.fetchValueSet(url, '0.8.0');

      expect(valueSet.identifier).toHaveLength(1);
      expect(valueSet.identifier[0].system).toBe('urn:ietf:rfc:3986');
      expect(valueSet.identifier[0].value).toBe('urn:oid:2.16.840.1.113883.4.642.40.1.48.5');
    });

    test('should handle ValueSets with jurisdictions', async () => {
      const url = 'http://hl7.org/fhir/tools/ValueSet/binding-style';

      const valueSet = await provider.fetchValueSet(url, '0.8.0');

      expect(valueSet.jurisdiction).toHaveLength(1);
      expect(valueSet.jurisdiction[0].coding).toHaveLength(1);
      expect(valueSet.jurisdiction[0].coding[0].system).toBe('http://unstats.un.org/unsd/methods/m49/m49.htm');
      expect(valueSet.jurisdiction[0].coding[0].code).toBe('001');
    });
  });

  describe('Database Integrity', () => {
    test('should have consistent data between map and database', async () => {
      // Search for all active ValueSets
      const activeValueSets = await provider.searchValueSets([
        { name: 'status', value: 'active' }
      ]);

      // Verify each one can be fetched by URL
      for (const vs of activeValueSets.slice(0, 5)) { // Test first 5 to avoid long runtime
        const fetched = await provider.fetchValueSet(vs.url, vs.version);
        expect(fetched.url).toBe(vs.url);
        expect(fetched.version).toBe(vs.version);
        expect(fetched.status).toBe(vs.status);
      }
    });

    test('should maintain referential integrity', async () => {
      const stats = await provider.getStatistics();
      const mapSize = provider.getMapSize();

      // The map should contain entries for URL-only keys plus versioned keys
      // So map total should be >= database total
      expect(mapSize).toBeGreaterThan(0);
      expect(stats.totalValueSets).toBeGreaterThan(0);
      expect(mapSize).toBeGreaterThanOrEqual(stats.totalValueSets);
    });
  });
});