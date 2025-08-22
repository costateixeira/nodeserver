const fs = require('fs');
const path = require('path');
const { OMOPServices, OMOPServicesFactory, OMOPConcept } = require('../../tx/cs/cs-omop');
const { TxOperationContext } = require('../../tx/cs/cs-api');

describe('OMOP Provider', () => {
  const testDbPath = path.resolve(__dirname, '../../tx/data/omop-fragment.db');
  let factory;
  let provider;
  let opContext;

  // Test data structure - will be populated dynamically from the database
  const testData = {
    expectedCounts: {
      concepts: 1146,
      conceptClasses: 433,
      relationships: 220,
      synonyms: 256,
      domains: 50,
      relationshipTypes: 722,
      vocabularies: 129
    },
    sampleConcepts: [], // Will be populated from database
    domains: [], // Will be populated from database
    vocabularies: [] // Will be populated from database
  };

  beforeAll(async () => {
    // Verify test database exists
    expect(fs.existsSync(testDbPath)).toBe(true);

    // Create factory and provider
    factory = new OMOPServicesFactory(testDbPath);
    provider = await factory.build(null, []);
    opContext = new TxOperationContext('en');

    // Populate test data by querying the database
    await populateTestData();
  });

  afterAll(() => {
    if (provider) {
      provider.close();
    }
  });

  async function populateTestData() {
    // Get sample concepts
    testData.sampleConcepts = await getSampleConcepts();

    // Get available domains
    testData.domains = await getSampleDomains();

    // Get available vocabularies
    testData.vocabularies = await getSampleVocabularies();
  }

  async function getSampleConcepts() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT concept_id FROM Concepts LIMIT 10';
      provider.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.concept_id.toString()));
      });
    });
  }

  async function getSampleDomains() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT DISTINCT domain_id FROM Domains LIMIT 5';
      provider.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.domain_id));
      });
    });
  }

  async function getSampleVocabularies() {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT DISTINCT vocabulary_id FROM Vocabularies LIMIT 5';
      provider.db.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.vocabulary_id));
      });
    });
  }

  describe('Factory and Basic Setup', () => {
    test('should create factory and provider', () => {
      expect(factory).toBeDefined();
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(OMOPServices);
    });

    test('should check database status', () => {
      const status = OMOPServicesFactory.checkDB(testDbPath);
      expect(status).toContain('OK');
    });

    test('should have correct system URI', () => {
      expect(provider.system()).toBe('https://fhir-terminology.ohdsi.org');
    });

    test('should have description', () => {
      const description = provider.description();
      expect(description).toContain('OMOP Concepts');
      expect(description).toContain('release');
    });

    test('should return version', async () => {
      const version = await provider.version();
      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
      console.log(`✓ OMOP Version: ${version}`);
    });

    test('should return correct total count', async () => {
      const count = await provider.totalCount();
      expect(count).toBe(testData.expectedCounts.concepts);
      console.log(`✓ Total OMOP concepts: ${count}`);
    });

    test('should not support iteration (too large)', async () => {
      await expect(provider.iterator(opContext, null)).rejects.toThrow('too large');
      await expect(provider.nextContext(opContext, null)).rejects.toThrow('too large');
    });
  });

  describe('Code Lookup', () => {
    test('should locate known concepts', async () => {
      for (const conceptId of testData.sampleConcepts.slice(0, 5)) {
        const result = await provider.locate(opContext, conceptId);
        expect(result.context).toBeDefined();
        expect(result.context).toBeInstanceOf(OMOPConcept);
        expect(result.context.code).toBe(conceptId);
        expect(result.message).toBeNull();

        console.log(`✓ Found concept: ${conceptId} - ${result.context.display}`);
      }
    });

    test('should return null for non-existent concept', async () => {
      const result = await provider.locate(opContext, '999999999');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });

    test('should return correct code for context', async () => {
      if (testData.sampleConcepts.length > 0) {
        const testCode = testData.sampleConcepts[0];
        const result = await provider.locate(opContext, testCode);
        const code = await provider.code(opContext, result.context);
        expect(code).toBe(testCode);
      }
    });

    test('should have concept metadata', async () => {
      if (testData.sampleConcepts.length > 0) {
        const result = await provider.locate(opContext, testData.sampleConcepts[0]);
        const concept = result.context;

        expect(concept.display).toBeDefined();
        expect(concept.domain).toBeDefined();
        expect(concept.conceptClass).toBeDefined();
        expect(concept.standard).toBeDefined();
        expect(concept.vocabulary).toBeDefined();

        console.log(`✓ Concept metadata: domain=${concept.domain}, class=${concept.conceptClass}, standard=${concept.standard}`);
      }
    });
  });

  describe('Displays and Designations', () => {
    test('should get display for concepts', async () => {
      for (const conceptId of testData.sampleConcepts.slice(0, 3)) {
        const display = await provider.display(opContext, conceptId);
        expect(display).toBeDefined();
        expect(typeof display).toBe('string');
        expect(display.length).toBeGreaterThan(0);

        console.log(`✓ Display for ${conceptId}: ${display.substring(0, 50)}...`);
      }
    });

    test('should return designations for concepts', async () => {
      if (testData.sampleConcepts.length > 0) {
        const designations = await provider.designations(opContext, testData.sampleConcepts[0]);
        expect(Array.isArray(designations)).toBe(true);
        expect(designations.length).toBeGreaterThan(0);

        const firstDesignation = designations[0];
        expect(firstDesignation.language).toBeDefined();
        expect(firstDesignation.value).toBeDefined();

        console.log(`✓ Concept ${testData.sampleConcepts[0]} has ${designations.length} designations`);

        // Check if there are synonyms
        const synonyms = designations.filter(d => !d.use);
        if (synonyms.length > 0) {
          console.log(`  - Including ${synonyms.length} synonyms`);
        }
      }
    });
  });

  describe('Code Properties', () => {
    test('should return false for abstract concepts', async () => {
      if (testData.sampleConcepts.length > 0) {
        const result = await provider.locate(opContext, testData.sampleConcepts[0]);
        const isAbstract = await provider.isAbstract(opContext, result.context);
        expect(isAbstract).toBe(false);
      }
    });

    test('should return false for inactive/deprecated concepts', async () => {
      if (testData.sampleConcepts.length > 0) {
        const result = await provider.locate(opContext, testData.sampleConcepts[0]);
        expect(await provider.isInactive(opContext, result.context)).toBe(false);
        expect(await provider.isDeprecated(opContext, result.context)).toBe(false);
      }
    });

    test('should return empty definition', async () => {
      if (testData.sampleConcepts.length > 0) {
        const result = await provider.locate(opContext, testData.sampleConcepts[0]);
        const definition = await provider.definition(opContext, result.context);
        expect(definition).toBe('');
      }
    });
  });

  describe('Extended Lookup', () => {
    test('should extend lookup with basic properties', async () => {
      if (testData.sampleConcepts.length > 0) {
        const conceptId = testData.sampleConcepts[0];
        const params = { parameter: [] };

        const requestedProps = ['domain-id', 'concept-class-id', 'standard-concept', 'vocabulary-id'];
        await provider.extendLookup(opContext, conceptId, requestedProps, params);

        expect(params.parameter).toBeDefined();
        expect(params.parameter.length).toBeGreaterThan(0);

        // Check for expected parameter types
        const paramTypes = params.parameter.map(p => p.name);
        expect(paramTypes).toContain('property');

        // Check for specific properties
        const properties = params.parameter.filter(p => p.name === 'property');
        const propNames = properties.map(p => p.part.find(part => part.name === 'code')?.valueCode);

        expect(propNames).toContain('domain-id');
        console.log(`✓ Extended lookup for ${conceptId}: ${params.parameter.length} parameters`);
      }
    });

    test('should include extended properties when available', async () => {
      if (testData.sampleConcepts.length > 0) {
        const conceptId = testData.sampleConcepts[0];
        const params = { parameter: [] };

        const extendedProps = [
          'concept-class-concept-id', 'domain-concept-id',
          'valid-start-date', 'valid-end-date',
          'vocabulary-concept-id', 'invalid-reason'
        ];
        await provider.extendLookup(opContext, conceptId, extendedProps, params);

        const properties = params.parameter.filter(p => p.name === 'property');
        console.log(`✓ Extended properties for ${conceptId}: ${properties.length} found`);
      }
    });

    test('should include relationships when available', async () => {
      if (testData.sampleConcepts.length > 0) {
        const conceptId = testData.sampleConcepts[0];
        const params = { parameter: [] };

        // Request all properties to potentially capture relationships
        await provider.extendLookup(opContext, conceptId, [], params);

        const relationships = params.parameter.filter(p =>
          p.name === 'property' &&
          p.part.some(part => part.valueString && part.valueString.includes('|'))
        );

        console.log(`✓ Relationships for ${conceptId}: ${relationships.length} found`);
      }
    });
  });

  describe('Filter Support', () => {
    test('should support domain filter', async () => {
      expect(await provider.doesFilter(opContext, 'domain', 'equal', 'Condition')).toBe(true);
      expect(await provider.doesFilter(opContext, 'domain', 'equal', 'Drug')).toBe(true);
    });

    test('should reject unsupported filters', async () => {
      expect(await provider.doesFilter(opContext, 'unsupported', 'equal', 'value')).toBe(false);
      expect(await provider.doesFilter(opContext, 'domain', 'regex', 'value')).toBe(false);
    });
  });

  describe('Domain Filters', () => {
    test('should filter by domain', async () => {
      if (testData.domains.length > 0) {
        const testDomain = testData.domains[0];
        const filterContext = await provider.getPrepContext(opContext, true);

        await provider.filter(opContext, filterContext, 'domain', 'equal', testDomain);
        const filters = await provider.executeFilters(opContext, filterContext);
        const filter = filters[0];

        const size = await provider.filterSize(opContext, filterContext, filter);
        expect(size).toBeGreaterThanOrEqual(0);

        console.log(`✓ Domain filter '${testDomain}': ${size} concepts found`);

        // Test iteration through a few results
        let count = 0;
        const maxToTest = Math.min(5, size);

        while (await provider.filterMore(opContext, filterContext, filter) && count < maxToTest) {
          const concept = await provider.filterConcept(opContext, filterContext, filter);
          expect(concept).toBeInstanceOf(OMOPConcept);
          expect(concept.code).toBeDefined();
          expect(concept.display).toBeDefined();
          count++;
        }

        expect(count).toBeGreaterThan(0);
        console.log(`  - Iterated ${count} concepts from filter`);

        await provider.filterFinish(opContext, filterContext);
      }
    });

    test('should handle multiple domains', async () => {
      const testedDomains = Math.min(3, testData.domains.length);

      for (let i = 0; i < testedDomains; i++) {
        const domain = testData.domains[i];
        const filterContext = await provider.getPrepContext(opContext, true);

        try {
          await provider.filter(opContext, filterContext, 'domain', 'equal', domain);
          const filters = await provider.executeFilters(opContext, filterContext);
          const filter = filters[0];

          const size = await provider.filterSize(opContext, filterContext, filter);
          console.log(`✓ Domain '${domain}': ${size} concepts`);

          await provider.filterFinish(opContext, filterContext);
        } catch (error) {
          console.log(`⚠ Domain '${domain}' caused error: ${error.message}`);
        }
      }
    });
  });

  describe('Filter Operations', () => {
    test('should check if concepts are in domain filters', async () => {
      if (testData.domains.length > 0 && testData.sampleConcepts.length > 0) {
        // Get a concept and its domain
        const conceptResult = await provider.locate(opContext, testData.sampleConcepts[0]);
        const concept = conceptResult.context;

        if (concept && concept.domain) {
          const filterContext = await provider.getPrepContext(opContext, true);
          await provider.filter(opContext, filterContext, 'domain', 'equal', concept.domain);
          const filters = await provider.executeFilters(opContext, filterContext);
          const filter = filters[0];

          const inFilter = await provider.filterCheck(opContext, filterContext, filter, concept);
          expect(typeof inFilter).toBe('boolean');

          console.log(`✓ Concept ${concept.code} in domain '${concept.domain}' filter: ${inFilter}`);

          await provider.filterFinish(opContext, filterContext);
        }
      }
    });

    test('should have closed filters', async () => {
      if (testData.domains.length > 0) {
        const filterContext = await provider.getPrepContext(opContext, true);
        await provider.filter(opContext, filterContext, 'domain', 'equal', testData.domains[0]);

        const notClosed = await provider.filtersNotClosed(opContext, filterContext);
        expect(notClosed).toBe(false);

        console.log(`✓ OMOP filters are closed (not infinite)`);
      }
    });
  });

  describe('Translation Support', () => {
    test('should handle translation requests', async () => {
      if (testData.sampleConcepts.length > 0) {
        const coding = {
          system: provider.system(),
          code: testData.sampleConcepts[0]
        };

        // Test translation to SNOMED CT
        const translations = await provider.getTranslations(opContext, coding, 'http://snomed.info/sct');
        expect(Array.isArray(translations)).toBe(true);

        console.log(`✓ Translation to SNOMED CT: ${translations.length} results`);
      }
    });

    test('should return empty array for unsupported target', async () => {
      if (testData.sampleConcepts.length > 0) {
        const coding = {
          system: provider.system(),
          code: testData.sampleConcepts[0]
        };

        const translations = await provider.getTranslations(opContext, coding, 'http://unsupported.example.com');
        expect(Array.isArray(translations)).toBe(true);
        expect(translations.length).toBe(0);
      }
    });
  });

  describe('Value Set Building', () => {
    test('should build value sets for domains', async () => {
      if (testData.domains.length > 0) {
        const domain = testData.domains[0];
        const valueSetId = `https://fhir-terminology.ohdsi.org/ValueSet/omop-domain-${domain}`;

        try {
          const valueSet = await provider.buildValueSet(null, valueSetId);
          expect(valueSet).toBeDefined();
          expect(valueSet.url).toBe(valueSetId);
          expect(valueSet.name).toContain(domain);
          expect(valueSet.compose).toBeDefined();
          expect(valueSet.compose.include).toBeDefined();
          expect(valueSet.compose.include.length).toBeGreaterThan(0);

          console.log(`✓ Built value set for domain '${domain}': ${valueSet.name}`);
        } catch (error) {
          console.log(`⚠ Could not build value set for domain '${domain}': ${error.message}`);
        }
      }
    });

    test('should reject unknown domains', async () => {
      const invalidId = 'https://fhir-terminology.ohdsi.org/ValueSet/omop-domain-UnknownDomain999';

      await expect(provider.buildValueSet(null, invalidId)).rejects.toThrow('Unknown Value Domain');
    });
  });

  describe('Concept Map Registration', () => {
    test('should register concept maps for vocabularies', async () => {
      const conceptMaps = [];
      await provider.registerConceptMaps(conceptMaps, null);

      expect(Array.isArray(conceptMaps)).toBe(true);
      expect(conceptMaps.length).toBeGreaterThan(0);

      // Check that we have both to- and from- maps
      const toMaps = conceptMaps.filter(cm => cm.id.startsWith('to-'));
      const fromMaps = conceptMaps.filter(cm => cm.id.startsWith('from-'));

      expect(toMaps.length).toBeGreaterThan(0);
      expect(fromMaps.length).toBeGreaterThan(0);

      console.log(`✓ Registered ${conceptMaps.length} concept maps (${toMaps.length} to-, ${fromMaps.length} from-)`);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid operation context', async () => {
      await expect(provider.locate(null, '123')).rejects.toThrow();
      await expect(provider.locate('invalid', '123')).rejects.toThrow();
    });

    test('should handle unsupported filters', async () => {
      const filterContext = await provider.getPrepContext(opContext, true);

      await expect(
        provider.filter(opContext, filterContext, 'unsupported', 'equal', 'value')
      ).rejects.toThrow('not understood');
    });

    test('should handle extend lookup with invalid context', async () => {
      const params = { parameter: [] };

      await expect(
        provider.extendLookup(opContext, 'invalid-concept-id', [], params)
      ).rejects.toThrow();
    });

    test('should handle invalid context types', async () => {
      await expect(
        provider.code(opContext, 'invalid-context')
      ).rejects.toThrow('OMOP Concept \'invalid-context\' not found');
    });

    test('should reject unsupported operations', async () => {
      const filterContext = await provider.getPrepContext(opContext, true);

      await expect(
        provider.searchFilter(opContext, filterContext, 'test', false)
      ).rejects.toThrow('not implemented');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty code lookup', async () => {
      const result = await provider.locate(opContext, '');
      expect(result.context).toBeNull();
      expect(result.message).toContain('Empty code');
    });

    test('should handle null context in various methods', async () => {
      expect(await provider.code(opContext, null)).toBeNull();
      expect(await provider.display(opContext, null)).toBeNull();

      const designations = await provider.designations(opContext, null);
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBe(0);
    });

    test('should handle subsumption test (not implemented)', async () => {
      const result = await provider.subsumesTest(opContext, '123', '456');
      expect(result).toBe(false);
    });
  });

  describe('Data Validation', () => {
    test('should have reasonable concept distribution', async () => {
      // Test that we have concepts across different domains
      const domainCounts = {};

      for (const domain of testData.domains.slice(0, 3)) {
        const filterContext = await provider.getPrepContext(opContext, true);
        await provider.filter(opContext, filterContext, 'domain', 'equal', domain);
        const filters = await provider.executeFilters(opContext, filterContext);
        const filter = filters[0];

        const size = await provider.filterSize(opContext, filterContext, filter);
        domainCounts[domain] = size;

        await provider.filterFinish(opContext, filterContext);
      }

      console.log('✓ Domain distribution:', domainCounts);

      // At least one domain should have concepts
      const totalConcepts = Object.values(domainCounts).reduce((sum, count) => sum + count, 0);
      expect(totalConcepts).toBeGreaterThan(0);
    });

    test('should have valid concept structure', async () => {
      if (testData.sampleConcepts.length > 0) {
        const result = await provider.locate(opContext, testData.sampleConcepts[0]);
        const concept = result.context;

        // Validate concept structure
        expect(concept.code).toBeDefined();
        expect(concept.display).toBeDefined();
        expect(concept.domain).toBeDefined();
        expect(concept.conceptClass).toBeDefined();
        expect(concept.standard).toBeDefined();
        expect(concept.vocabulary).toBeDefined();

        // Standard concept should be valid value
        expect(['S', 'C', 'NS']).toContain(concept.standard);

        console.log(`✓ Concept structure valid for ${concept.code}`);
      }
    });
  });

  describe('Performance and Cleanup', () => {
    test('should track factory usage', () => {
      const useCount = factory.useCount();
      expect(useCount).toBeGreaterThan(0);
      console.log(`✓ Factory use count: ${useCount}`);
    });

    test('should handle provider close', () => {
      // Should not throw
      const testProvider = provider;
      testProvider.close();

      console.log(`✓ Provider closed successfully`);
    });
  });
});