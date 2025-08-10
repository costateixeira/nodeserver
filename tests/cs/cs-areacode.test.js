const { TxOperationContext } = require('../../tx/cs/cs-api');
const { AreaCodeServices, AreaCodeFactoryProvider } = require('../../tx/cs/cs-areacode');
const { LanguageDefinitions, Languages, Language } = require('../../tx/library/languages');

describe('AreaCodeServices', () => {
  let factory;
  let provider;
  let opContext;

  beforeEach(() => {
    factory = new AreaCodeFactoryProvider();
    provider = factory.build(null, []);
    opContext = new TxOperationContext(Languages.fromAcceptLanguage('en'));
  });

  describe('Basic Functionality', () => {
    test('should return correct system URI', () => {
      expect(provider.system()).toBe('http://unstats.un.org/unsd/methods/m49/m49.htm');
    });

    test('should return correct description', () => {
      expect(provider.description()).toBe('International area/region Codes');
    });

    test('should return total count greater than 0', () => {
      expect(provider.totalCount()).toBeGreaterThan(0);
      expect(provider.totalCount()).toBeGreaterThan(200); // Should have many countries + regions
    });

    test('should not have parents', () => {
      expect(provider.hasParents()).toBe(false);
    });
  });

  describe('Code Lookup', () => {
    test('should locate valid country codes', async () => {
      const result = await provider.locate(opContext, '840'); // USA
      expect(result.context).toBeTruthy();
      expect(result.message).toBeNull();
      expect((await provider.code(opContext, result.context))).toBe('840');
    });

    test('should locate valid region codes', async () => {
      const result = await provider.locate(opContext, '150'); // Europe
      expect(result.context).toBeTruthy();
      expect(result.message).toBeNull();
      expect((await provider.code(opContext, result.context))).toBe('150');
    });

    test('should return error for invalid codes', async () => {
      const result = await provider.locate(opContext, '999');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });

    test('should return correct displays', async () => {
      const usaResult = await provider.locate(opContext, '840');
      const display = await provider.display(opContext, usaResult.context);
      expect(display).toBe('United States of America (USA)');

      const europeResult = await provider.locate(opContext, '150');
      const europeDisplay = await provider.display(opContext, europeResult.context);
      expect(europeDisplay).toBe('Europe');
    });

    test('should return empty definition', async () => {
      const result = await provider.locate(opContext, '840');
      const definition = await provider.definition(opContext, result.context);
      expect(definition).toBe(null);
    });

    test('should return false for abstract, inactive, deprecated', async () => {
      const result = await provider.locate(opContext, '840');
      expect(await provider.isAbstract(opContext, result.context)).toBe(false);
      expect(await provider.isInactive(opContext, result.context)).toBe(false);
      expect(await provider.isDeprecated(opContext, result.context)).toBe(false);
    });
  });

  describe('Iterator Functionality', () => {
    test('should create iterator for all concepts', async () => {
      const iterator = await provider.iterator(opContext, null);
      expect(iterator).toBeTruthy();
      expect(iterator.index).toBe(0);
      expect(iterator.total).toBe(provider.totalCount());
    });

    test('should iterate through concepts', async () => {
      const iterator = await provider.iterator(opContext, null);
      const concepts = [];

      for (let i = 0; i < 10 && i < iterator.total; i++) {
        const concept = await provider.nextContext(opContext, iterator);
        expect(concept).toBeTruthy();
        concepts.push(concept);
      }

      expect(concepts.length).toBe(Math.min(10, iterator.total));
      // Should have different codes
      const codes = concepts.map(c => provider.code(opContext, c));
      expect(new Set(codes).size).toBe(codes.length);
    });

    test('should return null when iterator exhausted', async () => {
      const iterator = { index: provider.totalCount(), total: provider.totalCount() };
      const concept = await provider.nextContext(opContext, iterator);
      expect(concept).toBeNull();
    });
  });

  describe('Filter Support',  () => {
    test('should support class/type equals filters', async () => {
      expect(await provider.doesFilter(opContext, 'class', 'equals', 'country')).toBe(true);
      expect(await provider.doesFilter(opContext, 'type', 'equals', 'region')).toBe(true);
    });

    test('should not support other filters', async () => {
      expect(await provider.doesFilter(opContext, 'display', 'equals', 'test')).toBe(false);
      expect(await provider.doesFilter(opContext, 'class', 'contains', 'country')).toBe(false);
      expect(await provider.doesFilter(opContext, 'class', 'in', 'country,region')).toBe(false);
    });

  });

  describe('Filter by Country', () => {
    let countryFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'class', 'equals', 'country');
      const filters = await provider.executeFilters(opContext, ctxt);
      countryFilter = filters[0];
    });

    test('should create country filter', () => {
      expect(countryFilter).toBeTruthy();
      expect(countryFilter.list).toBeTruthy();
      expect(countryFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for countries', async () => {
      const size = await provider.filterSize(opContext, ctxt, countryFilter);
      expect(size).toBeGreaterThan(190); // Should have many countries
      expect(size).toBeLessThan(300); // But not too many
    });

    test('should iterate through countries only', async () => {
      const countries = [];
      countryFilter.cursor = -1; // Reset cursor

      // Get first 10 countries
      for (let i = 0; i < 10; i++) {
        if (await provider.filterMore(opContext, ctxt, countryFilter)) {
          const concept = await provider.filterConcept(opContext, ctxt, countryFilter);
          expect(concept).toBeTruthy();
          expect(concept.class_).toBe('country');
          countries.push(concept);
        }
      }

      expect(countries.length).toBe(10);
    });

    test('should locate specific country in filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, countryFilter, '840'); // USA
      expect(result).toBeTruthy();
      expect(typeof result).not.toBe('string'); // Should not be error message
      expect(result.code).toBe('840');
      expect(result.class_).toBe('country');
    });

    test('should not locate region in country filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, countryFilter, '150'); // Europe
      expect(typeof result).toBe('string'); // Should be error message
      expect(result).toContain('not found');
    });

    test('should check if concept is in country filter', async () => {
      // Find a country concept
      countryFilter.cursor = -1;
      await provider.filterMore(opContext, ctxt, countryFilter);
      const countryConcept = await provider.filterConcept(opContext, ctxt, countryFilter);

      const isInFilter = await provider.filterCheck(opContext, ctxt, countryFilter, countryConcept);
      expect(isInFilter).toBe(true);
    });
  });

  describe('Filter by Region', () => {
    let regionFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'type', 'equals', 'region');
      const filters = await provider.executeFilters(opContext, ctxt);
      regionFilter = filters[0];
    });

    test('should create region filter', () => {
      expect(regionFilter).toBeTruthy();
      expect(regionFilter.list).toBeTruthy();
      expect(regionFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for regions', async () => {
      const size = await provider.filterSize(opContext, ctxt, regionFilter);
      expect(size).toBeGreaterThan(20); // Should have geographic regions
      expect(size).toBeLessThan(50); // But not too many
    });

    test('should iterate through regions only', async () => {
      const regions = [];
      regionFilter.cursor = -1; // Reset cursor

      // Get all regions
      while (await provider.filterMore(opContext, ctxt, regionFilter)) {
        const concept = await provider.filterConcept(opContext, ctxt, regionFilter);
        expect(concept).toBeTruthy();
        expect(concept.class_).toBe('region');
        regions.push(concept);
      }

      expect(regions.length).toBeGreaterThan(20);

      // Check for known regions
      const codes = regions.map(r => r.code);
      expect(codes).toContain('150'); // Europe
      expect(codes).toContain('002'); // Africa
      expect(codes).toContain('019'); // Americas
      expect(codes).toContain('142'); // Asia
      expect(codes).toContain('009'); // Oceania
    });

    test('should locate specific region in filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, regionFilter, '150'); // Europe
      expect(result).toBeTruthy();
      expect(typeof result).not.toBe('string'); // Should not be error message
      expect(result.code).toBe('150');
      expect(result.class_).toBe('region');
    });

    test('should not locate country in region filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, regionFilter, '840'); // USA
      expect(typeof result).toBe('string'); // Should be error message
      expect(result).toContain('not found');
    });
  });

  describe('Filter Error Cases', () => {
    test('should throw error for unsupported property', async () => {
      await expect(
        provider.filter(opContext, await provider.getPrepContext(opContext, false), 'display', 'equals', 'test')
      ).rejects.toThrow('not supported');
    });

    test('should throw error for unsupported operator', async () => {
      await expect(
        provider.filter(opContext, await provider.getPrepContext(opContext, false), 'class', 'contains', 'country')
      ).rejects.toThrow('not supported');
    });

    test('should throw error for search filter', async () => {
      await expect(
        provider.searchFilter(opContext, await provider.getPrepContext(opContext, false), 'test', false)
      ).rejects.toThrow('not implemented');
    });

    test('should throw error for special filter', async () => {
      await expect(
        provider.specialFilter(opContext, await provider.getPrepContext(opContext, false), 'test', false)
      ).rejects.toThrow('not implemented');
    });
  });

  describe('Execute Filters', () => {
    test('should execute single filter', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'class', 'equals', 'country');
      const results = await provider.executeFilters(opContext, ctxt);
      const countryFilter = results[0];

      expect(results).toBeTruthy();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0]).toBe(countryFilter);
    });

    test('should return empty array for null filter', async () => {
      const results = await provider.executeFilters(opContext, await provider.getPrepContext(opContext, false));
      expect(results).toEqual([]);
    });

    test('should indicate filters are closed', async () => {
      expect(await provider.filtersNotClosed(opContext, await provider.getPrepContext(opContext, false))).toBe(false);
    });
  });

  describe('Subsumption', () => {
    test('should not support subsumption', async () => {
      expect(await provider.subsumesTest(opContext, '840', '150')).toBe(false);
      expect(await provider.subsumesTest(opContext, '150', '840')).toBe(false);
    });

    test('should return error for locateIsA', async () => {
      const result = await provider.locateIsA(opContext, '840', '150');
      expect(result.context).toBeNull();
      expect(result.message).toContain('does not have parents');
    });
  });

  describe('Factory Functionality', () => {
    test('should track usage count', () => {
      const factory = new AreaCodeFactoryProvider();
      expect(factory.useCount()).toBe(0);

      factory.build(opContext, []);
      expect(factory.useCount()).toBe(1);

      factory.build(opContext, []);
      expect(factory.useCount()).toBe(2);
    });

    test('should return null for default version', () => {
      expect(factory.defaultVersion()).toBeNull();
    });

    test('should build working providers', () => {
      const provider1 = factory.build(opContext, []);
      const provider2 = factory.build(opContext, []);

      expect(provider1).toBeTruthy();
      expect(provider2).toBeTruthy();
      expect(provider1.totalCount()).toBe(provider2.totalCount());
    });
  });

  describe('Specific Country/Region Tests', () => {
    test('should find major countries', async () => {
      const testCodes = [
        ['840', 'United States of America (USA)'],
        ['124', 'Canada (CAN)'],
        ['276', 'Germany (DEU)'],
        ['392', 'Japan (JPN)'],
        ['156', 'China (CHN)'],
        ['076', 'Brazil (BRA)']
      ];

      for (const [code, expectedDisplay] of testCodes) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.class_).toBe('country');
      }
    });

    test('should find major regions', async () => {
      const testCodes = [
        ['001', 'World'],
        ['002', 'Africa'],
        ['019', 'Americas'],
        ['142', 'Asia'],
        ['150', 'Europe'],
        ['009', 'Oceania']
      ];

      for (const [code, expectedDisplay] of testCodes) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.class_).toBe('region');
      }
    });
  });

  describe('Filter Cleanup', () => {
    test('should not throw on filter finish', () => {
      expect(() => {
        provider.filterFinish(opContext, null);
      }).not.toThrow();
    });
  });
});