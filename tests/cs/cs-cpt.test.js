const fs = require('fs');
const path = require('path');
const { CPTServices, CPTServicesFactory, CPTConcept, CPTExpression } = require('../../tx/cs/cs-cpt');
const { OperationContext } = require('../../tx/operation-context');
const {Languages} = require("../../library/languages");

describe('CPT Provider', () => {
  const testDbPath = path.resolve(__dirname, '../../tx/data/cpt-fragment.db');
  let factory;
  let provider;

  // Test data from the fragment database
  const testData = {
    baseCodes: ['0001A', '99202', '99203', '99252'],
    modifierCodes: ['1P', '25', '95', 'F1', 'P1'],
    allCodes: ['0001A', '1P', '25', '95', '99202', '99203', '99252', 'F1', 'P1'],
    expectedVersion: '2023',
    expectedTotalCount: 9,

    // Known designations
    designations: {
      '99202': 'Office or other outpatient visit for the evaluation and management of a new patient, which requires a medically appropriate history and/or examination and straightforward medical decision making. When using time for code selection, 15-29 minutes of total time is spent on the date of the encounter.',
      '25': 'Significant, Separately Identifiable Evaluation and Management Service by the Same Physician or Other Qualified Health Care Professional on the Same Day of the Procedure or Other Service: It may be necessary to indicate that on the day a procedure or service identified by a CPT code was performed, the patient\'s condition required a significant, separately identifiable E/M service above and beyond the other service provided or beyond the usual preoperative and postoperative care associated with the procedure that was performed. A significant, separately identifiable E/M service is defined or substantiated by documentation that satisfies the relevant criteria for the respective E/M service to be reported (see Evaluation and Management Services Guidelines for instructions on determining level of E/M service). The E/M service may be prompted by the symptom or condition for which the procedure and/or service was provided. As such, different diagnoses are not required for reporting of the E/M services on the same date. This circumstance may be reported by adding modifier 25 to the appropriate level of E/M service. Note: This modifier is not used to report an E/M service that resulted in a decision to perform surgery. See modifier 57 For significant, separately identifiable non-E/M services, see modifier 59.',
      'P1': 'A normal healthy patient'
    },

    // Known properties
    properties: {
      '99202': { kind: 'code', telemedicine: 'true' },
      '99203': { kind: 'code', telemedicine: 'true' },
      '99252': { kind: 'code' },
      '0001A': { kind: 'cat-2' },
      '25': { kind: ['general', 'cat-1'] }, // Multiple values
      '95': { kind: 'general' },
      'P1': { kind: 'physical-status' },
      '1P': { kind: 'cat-2' },
      'F1': { kind: 'hcpcs' }
    },

    // Valid expressions for testing
    validExpressions: [
      '99202:25',
      '99203:95',
      '0001A:25', // Cat-2 modifier 25 cannot be used with non-cat-2 codes (but 25 is not cat-2, so this should be valid)
      '0001A:1P' // Cat-2 code with cat-2 modifier
    ],

    // Invalid expressions for validation testing
    invalidExpressions: [
      '99202:50', // Modifier 50 cannot be used with cat-2 codes (but 99202 is not cat-2, so this should be valid)
      // Actually, let's use real validation errors based on the rules
      '99999:25', // Invalid base code
      '99202:99', // Invalid modifier
      '95:99202'  // Modifier as base code
    ]
  };

  beforeAll(async () => {
    // Verify test database exists
    expect(fs.existsSync(testDbPath)).toBe(true);

    // Create factory and provider
    factory = new CPTServicesFactory(testDbPath);
    provider = await factory.build(new OperationContext('en'), []);
  });

  afterAll(() => {
    if (provider) {
      provider.close();
    }
  });

  describe('Factory and Basic Setup', () => {
    test('should create factory and provider', () => {
      expect(factory).toBeDefined();
      expect(provider).toBeDefined();
      expect(provider).toBeInstanceOf(CPTServices);
    });

    test('should check database status', () => {
      const status = CPTServicesFactory.checkDB(testDbPath);
      expect(status).toContain('OK');
      expect(status).toContain('9 Concepts');
    });

    test('should have correct system URI', () => {
      expect(provider.system()).toBe('http://www.ama-assn.org/go/cpt');
    });

    test('should have correct description', () => {
      const description = provider.description();
      expect(description).toContain('CPT');
      expect(description).toContain('American Medical Association');
    });

    test('should return correct version', async () => {
      const version = await provider.version();
      expect(version).toBe(testData.expectedVersion);
    });

    test('should return correct total count', async () => {
      const count = await provider.totalCount();
      expect(count).toBe(testData.expectedTotalCount);
    });

    test('should have expansion limitation', () => {
      expect(provider.expandLimitation()).toBe(1000);
    });

    test('should not have parents (CPT is flat)', () => {
      expect(provider.hasParents()).toBe(false);
    });
  });

  describe('Code Lookup', () => {
    test('should locate all known codes', async () => {
      for (const code of testData.allCodes) {
        const result = await provider.locate(code);
        expect(result.context).toBeDefined();
        expect(result.context).toBeInstanceOf(CPTConcept);
        expect(result.context.code).toBe(code);
        expect(result.message).toBeNull();
        console.log(`✓ Found code: ${code}`);
      }
    });

    test('should return null for non-existent code', async () => {
      const result = await provider.locate('99999');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });

    test('should return correct code for context', async () => {
      const testCode = testData.allCodes[0];
      const result = await provider.locate(testCode);
      const code = await provider.code(result.context);
      expect(code).toBe(testCode);
    });

    test('should distinguish base codes from modifiers', async () => {
      for (const code of testData.baseCodes) {
        const result = await provider.locate(code);
        expect(result.context.modifier).toBe(false);
      }

      for (const code of testData.modifierCodes) {
        const result = await provider.locate(code);
        expect(result.context.modifier).toBe(true);
      }
    });
  });

  describe('Displays and Designations', () => {
    test('should get display for codes', async () => {
      for (const [code, expectedDisplay] of Object.entries(testData.designations)) {
        const display = await provider.display(code);
        expect(display).toBe(expectedDisplay);
        console.log(`✓ Display for ${code}: ${display.substring(0, 50)}...`);
      }
    });

    test('should return designations for codes', async () => {
      for (const code of testData.allCodes) {
        const designations = await provider.designations(code);
        expect(Array.isArray(designations)).toBe(true);
        expect(designations.length).toBeGreaterThan(0);

        const firstDesignation = designations[0];
        expect(firstDesignation.language).toBeDefined();
        expect(firstDesignation.value).toBeDefined();

        console.log(`✓ Code ${code} has ${designations.length} designations`);
      }
    });
  });

  describe('Code Properties', () => {
    test('should return false for abstract concepts', async () => {
      // Regular codes should not be abstract
      for (const code of ['99202', '99203', '25']) {
        const result = await provider.locate(code);
        const isAbstract = await provider.isAbstract(result.context);
        expect(isAbstract).toBe(false);
      }
    });

    test('should return false for inactive/deprecated concepts', async () => {
      for (const code of testData.allCodes) {
        const result = await provider.locate(code);
        expect(await provider.isInactive(result.context)).toBe(false);
        expect(await provider.isDeprecated(result.context)).toBe(false);
      }
    });

    test('should return definition same as display', async () => {
      const testCode = testData.allCodes[0];
      const result = await provider.locate(testCode);
      const display = await provider.display(result.context);
      const definition = await provider.definition(result.context);
      expect(definition).toBe(display);
    });
  });

  describe('Extended Lookup', () => {
    test('should extend lookup with properties and designations', async () => {
      for (const code of testData.allCodes) {
        const params = { parameter: [] };
        await provider.extendLookup(code, [], params);

        expect(params.parameter).toBeDefined();
        expect(params.parameter.length).toBeGreaterThan(0);

        // Should have copyright
        const copyrightParam = params.parameter.find(p =>
          p.name === 'property' &&
          p.part.some(part => part.name === 'code' && part.valueCode === 'copyright')
        );
        expect(copyrightParam).toBeDefined();

        console.log(`✓ Extended lookup for ${code}: ${params.parameter.length} parameters`);
      }
    });

    test('should include concept properties in extended lookup', async () => {
      for (const [code, expectedProps] of Object.entries(testData.properties)) {
        const params = { parameter: [] };
        await provider.extendLookup(code, Object.keys(expectedProps), params);

        // Check for expected properties
        for (const [propName, propValue] of Object.entries(expectedProps)) {
          const values = Array.isArray(propValue) ? propValue : [propValue];

          for (const value of values) {
            const propertyParam = params.parameter.find(p =>
              p.name === 'property' &&
              p.part.some(part => part.name === 'code' && part.valueCode === propName) &&
              p.part.some(part => part.name === 'value' && part.valueString === value)
            );
            expect(propertyParam).toBeDefined();
          }
        }

        console.log(`✓ Properties for ${code} verified`);
      }
    });
  });

  describe('Expression Parsing', () => {
    test('should parse valid expressions', async () => {
      for (const expression of testData.validExpressions) {
        const result = await provider.locate(expression);
        expect(result.context).toBeDefined();
        expect(result.context).toBeInstanceOf(CPTExpression);
        expect(result.message).toBeNull();

        const code = await provider.code(result.context);
        expect(code).toBe(expression);

        console.log(`✓ Parsed expression: ${expression}`);
      }
    });

    test('should reject expressions with invalid codes', async () => {
      for (const expression of testData.invalidExpressions) {
        const result = await provider.locate(expression);
        expect(result.context).toBeNull();
        expect(result.message).toBeDefined();
        console.log(`✓ Rejected invalid expression: ${expression} - ${result.message}`);
      }
    });

    test('should return empty display for expressions', async () => {
      const expression = testData.validExpressions[0];
      const result = await provider.locate(expression);
      const display = await provider.display(result.context);
      expect(display).toBe('');
    });

    test('should extend lookup for expressions', async () => {
      const expression = testData.validExpressions[0];
      const params = { parameter: [] };
      await provider.extendLookup(expression, [], params);

      expect(params.parameter.length).toBeGreaterThan(0);

      // Should have modifier properties
      const modifierParams = params.parameter.filter(p =>
        p.name === 'property' &&
        p.part.some(part => part.name === 'code' && part.valueCode === 'modifier')
      );
      expect(modifierParams.length).toBeGreaterThan(0);

      console.log(`✓ Extended lookup for expression ${expression}: ${params.parameter.length} parameters`);
    });
  });

  describe('Filter Support', () => {
    test('should support modifier filter', async () => {
      expect(await provider.doesFilter('modifier', 'equal', 'true')).toBe(true);
      expect(await provider.doesFilter('modifier', 'equal', 'false')).toBe(true);
    });

    test('should support modified filter', async () => {
      expect(await provider.doesFilter('modified', 'equal', 'true')).toBe(true);
      expect(await provider.doesFilter('modified', 'equal', 'false')).toBe(true);
    });

    test('should support kind filter', async () => {
      expect(await provider.doesFilter('kind', 'equal', 'code')).toBe(true);
      expect(await provider.doesFilter('kind', 'equal', 'cat-2')).toBe(true);
    });

    test('should reject unsupported filters', async () => {
      expect(await provider.doesFilter('unsupported', 'equal', 'value')).toBe(false);
      expect(await provider.doesFilter('modifier', 'regex', 'value')).toBe(false);
    });
  });

  describe('Modifier Filters', () => {
    test('should filter modifier=true', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modifier', 'equal', 'true');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const size = await provider.filterSize(filterContext, filter);
      expect(size).toBe(testData.modifierCodes.length);

      const foundCodes = [];
      while (await provider.filterMore(filterContext, filter)) {
        const concept = await provider.filterConcept(filterContext, filter);
        foundCodes.push(concept.code);
      }

      expect(foundCodes.sort()).toEqual(testData.modifierCodes.sort());
      console.log(`✓ Modifier filter (true): found ${foundCodes.join(', ')}`);
    });

    test('should filter modifier=false', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modifier', 'equal', 'false');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const size = await provider.filterSize(filterContext, filter);
      expect(size).toBe(testData.baseCodes.length);

      const foundCodes = [];
      while (await provider.filterMore(filterContext, filter)) {
        const concept = await provider.filterConcept(filterContext, filter);
        foundCodes.push(concept.code);
      }

      expect(foundCodes.sort()).toEqual(testData.baseCodes.sort());
      console.log(`✓ Modifier filter (false): found ${foundCodes.join(', ')}`);
    });
  });

  describe('Kind Filters', () => {
    test('should filter by kind=code', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'kind', 'equal', 'code');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const foundCodes = [];
      while (await provider.filterMore(filterContext, filter)) {
        const concept = await provider.filterConcept(filterContext, filter);
        foundCodes.push(concept.code);
      }

      // Should find codes with kind=code property
      expect(foundCodes).toContain('99202');
      expect(foundCodes).toContain('99203');
      expect(foundCodes).toContain('99252');
      console.log(`✓ Kind filter (code): found ${foundCodes.join(', ')}`);
    });

    test('should filter by kind=cat-2', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'kind', 'equal', 'cat-2');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const foundCodes = [];
      while (await provider.filterMore(filterContext, filter)) {
        const concept = await provider.filterConcept(filterContext, filter);
        foundCodes.push(concept.code);
      }

      expect(foundCodes).toContain('0001A');
      expect(foundCodes).toContain('1P');
      console.log(`✓ Kind filter (cat-2): found ${foundCodes.join(', ')}`);
    });

    test('should filter by kind=general', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'kind', 'equal', 'general');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const foundCodes = [];
      while (await provider.filterMore(filterContext, filter)) {
        const concept = await provider.filterConcept(filterContext, filter);
        foundCodes.push(concept.code);
      }

      expect(foundCodes).toContain('25');
      expect(foundCodes).toContain('95');
      console.log(`✓ Kind filter (general): found ${foundCodes.join(', ')}`);
    });
  });

  describe('Modified Filter', () => {
    test('should filter modified=false (all codes)', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modified', 'equal', 'false');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const size = await provider.filterSize(filterContext, filter);
      expect(size).toBe(testData.expectedTotalCount);

      console.log(`✓ Modified filter (false): ${size} codes (all)`);
    });

    test('should filter modified=true (empty)', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modified', 'equal', 'true');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const size = await provider.filterSize(filterContext, filter);
      expect(size).toBe(0);

      // Should report not closed since it could have infinite results
      const notClosed = await provider.filtersNotClosed(filterContext);
      expect(notClosed).toBe(true);

      console.log(`✓ Modified filter (true): ${size} codes (empty, not closed)`);
    });
  });

  describe('Filter Operations', () => {
    test('should locate codes within filters', async () => {
      const filterContext = await provider.getPrepContext(false);
      await provider.filter(filterContext, 'modifier', 'equal', 'true');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const testCode = testData.modifierCodes[0];
      const located = await provider.filterLocate(filterContext, filter, testCode);
      expect(located).toBeInstanceOf(CPTConcept);
      expect(located.code).toBe(testCode);

      console.log(`✓ Located code ${testCode} in modifier filter`);
    });

    test('should check if concepts are in filters', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modifier', 'equal', 'false');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      const baseCodeResult = await provider.locate(testData.baseCodes[0]);
      const inFilter = await provider.filterCheck(filterContext, filter, baseCodeResult.context);
      expect(inFilter).toBe(true);

      const modifierCodeResult = await provider.locate(testData.modifierCodes[0]);
      const notInFilter = await provider.filterCheck(filterContext, filter, modifierCodeResult.context);
      expect(notInFilter).toBe(false);

      console.log(`✓ Filter check working correctly`);
    });

    test('should handle expressions in filters', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modified', 'equal', 'true');
      const filters = await provider.executeFilters(filterContext);
      const filter = filters[0];

      // Expressions should be allowed in non-closed filters
      const expressionResult = await provider.locate(testData.validExpressions[0]);
      const inFilter = await provider.filterCheck(filterContext, filter, expressionResult.context);
      expect(inFilter).toBe(true); // Because the filter is not closed

      console.log(`✓ Expressions handled correctly in non-closed filters`);
    });
  });

  describe('Iterator Support', () => {
    test('should iterate all codes', async () => {
      const iterator = await provider.iterator(null);
      expect(iterator).toBeDefined();

      const foundCodes = [];
      while (foundCodes.length < testData.expectedTotalCount) {
        const context = await provider.nextContext(iterator);
        if (!context) break;

        expect(context).toBeInstanceOf(CPTConcept);
        expect(context.code).toBeDefined();
        foundCodes.push(context.code);
      }

      expect(foundCodes.length).toBe(testData.expectedTotalCount);
      expect(foundCodes.sort()).toEqual(testData.allCodes.sort());
      console.log(`✓ Iterated all ${foundCodes.length} codes`);
    });

    test('should return empty iterator for specific context', async () => {
      const codeResult = await provider.locate(testData.allCodes[0]);
      const iterator = await provider.iterator(codeResult.context);

      const context = await provider.nextContext(iterator);
      expect(context).toBeNull();

      console.log(`✓ Empty iterator for specific context`);
    });
  });

  describe('Error Handling', () => {

    test('should handle unsupported filters', async () => {
      const filterContext = await provider.getPrepContext(true);

      await expect(
        provider.filter(filterContext, 'unsupported', 'equal', 'value')
      ).rejects.toThrow('not supported');
    });

    test('should handle extend lookup with invalid context', async () => {
      const params = { parameter: [] };

      await expect(
        provider.extendLookup('invalid-code', [], params)
      ).rejects.toThrow();
    });

    test('should handle invalid context types', async () => {
      await expect(
        provider.code('invalid-context')
      ).rejects.toThrow('Code \'invalid-context\' not found in CPT');
    });
  });

  describe('Expression Validation Rules', () => {
    test('should validate cat-2 modifier rules', async () => {
      // This would require having actual validation data in the test database
      // For now, just test that the parsing mechanism works
      const validExpression = '0001A:1P'; // Cat-2 code with cat-2 modifier
      const result = await provider.locate(validExpression);
      expect(result.context).toBeInstanceOf(CPTExpression);
    });

    test('should validate telemedicine modifier 95', async () => {
      // Test that 95 can be used with telemedicine-enabled codes
      const expression = '99202:95'; // 99202 has telemedicine=true
      const result = await provider.locate(expression);
      expect(result.context).toBeInstanceOf(CPTExpression);
      console.log(`✓ Telemedicine modifier validation works`);
    });

    test('should reject expressions with non-existent modifiers', async () => {
      const result = await provider.locate('99202:XYZ');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });
  });

  describe('Performance and Cleanup', () => {
    test('should handle filter cleanup', async () => {
      const filterContext = await provider.getPrepContext(true);
      await provider.filter(filterContext, 'modifier', 'equal', 'true');
      await provider.executeFilters(filterContext);

      // Should not throw
      await provider.filterFinish(filterContext);
      console.log(`✓ Filter cleanup completed successfully`);
    });

    test('should track factory usage', () => {
      const useCount = factory.useCount();
      expect(useCount).toBeGreaterThan(0);
      console.log(`✓ Factory use count: ${useCount}`);
    });

    test('should handle provider close', () => {
      // Should not throw
      provider.close();

      // Create new provider for remaining tests
      provider = null;
      console.log(`✓ Provider closed successfully`);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty code lookup', async () => {
      // Recreate provider if needed
      if (!provider) {
        provider = await factory.build(new OperationContext(Languages.fromAcceptLanguage('en')), []);
      }

      const result = await provider.locate('');
      expect(result.context).toBeNull();
      expect(result.message).toContain('Empty code');
    });

    test('should handle null context in various methods', async () => {
      expect(await provider.code(null)).toBeNull();
      expect(await provider.display(null)).toBeNull();

      const designations = await provider.designations(null);
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBe(0);
    });

    test('should handle subsumption test (not implemented)', async () => {
      const result = await provider.subsumesTest('99202', '99203');
      expect(result).toBe(false);
    });

    test('should reject search filter (not implemented)', async () => {
      const filterContext = await provider.getPrepContext(true);

      await expect(
        provider.searchFilter(filterContext, 'test', false)
      ).rejects.toThrow('not implemented');
    });
  });
});