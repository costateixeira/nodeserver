const { TxOperationContext } = require('../../tx/cs/cs-api');
const { Iso4217Services, Iso4217FactoryProvider } = require('../../tx/cs/cs-currency');
const { LanguageDefinitions, Languages, Language } = require('../../library/languages');

describe('Iso4217Services', () => {
  let factory;
  let provider;
  let opContext;

  beforeEach(() => {
    factory = new Iso4217FactoryProvider();
    provider = factory.build(null, []);
    opContext = new TxOperationContext(Languages.fromAcceptLanguage('en'));
  });

  describe('Basic Functionality', () => {
    test('should return correct system URI', () => {
      expect(provider.system()).toBe('urn:iso:std:iso:4217');
    });

    test('should return correct description', () => {
      expect(provider.description()).toBe('Currencies');
    });

    test('should return total count greater than 150', () => {
      expect(provider.totalCount()).toBeGreaterThan(150); // Should have many currencies
      expect(provider.totalCount()).toBeLessThan(200); // But not too many
    });

    test('should not have parents', () => {
      expect(provider.hasParents()).toBe(false);
    });

    test('should return null version', () => {
      expect(provider.version()).toBeNull();
    });
  });

  describe('Code Lookup', () => {
    test('should locate valid major currency codes', async () => {
      const majorCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'];

      for (const code of majorCurrencies) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();
        expect(result.message).toBeNull();
        expect((await provider.code(opContext, result.context))).toBe(code);
      }
    });

    test('should return error for invalid codes', async () => {
      const result = await provider.locate(opContext, 'ZZZ');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });

    test('should return error for empty codes', async () => {
      const result = await provider.locate(opContext, '');
      expect(result.context).toBeNull();
      expect(result.message).toBe('Empty code');
    });

    test('should return correct displays', async () => {
      const testCases = [
        ['USD', 'United States dollar'],
        ['EUR', 'Euro'],
        ['GBP', 'Pound sterling'],
        ['JPY', 'Japanese yen'],
        ['CHF', 'Swiss franc']
      ];

      for (const [code, expectedDisplay] of testCases) {
        const result = await provider.locate(opContext, code);
        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
      }
    });

    test('should return trimmed displays', async () => {
      const result = await provider.locate(opContext, 'USD');
      const display = await provider.display(opContext, result.context);
      expect(display).not.toMatch(/^\s|\s$/); // No leading/trailing whitespace
    });

    test('should throw Error for display of invalid code', async () => {
      await expect(provider.display(opContext, 'ZZZ')).rejects.toThrow('Currency Code \'ZZZ\' not found');
    });

    test('should return null definition', async () => {
      const result = await provider.locate(opContext, 'USD');
      const definition = await provider.definition(opContext, result.context);
      expect(definition).toBeNull();
    });

    test('should return false for abstract, inactive, deprecated', async () => {
      const result = await provider.locate(opContext, 'USD');
      expect(await provider.isAbstract(opContext, result.context)).toBe(false);
      expect(await provider.isInactive(opContext, result.context)).toBe(false);
      expect(await provider.isDeprecated(opContext, result.context)).toBe(false);
    });

    test('should return designations with display', async () => {
      const result = await provider.locate(opContext, 'USD');
      const designations = await provider.designations(opContext, result.context);
      expect(designations).toBeTruthy();
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBeGreaterThan(0);

      const displayDesignation = designations.find(d => d.value === 'United States dollar');
      expect(displayDesignation).toBeTruthy();
      expect(displayDesignation.language).toBe('en');
    });

    test('should access currency properties', async () => {
      const result = await provider.locate(opContext, 'USD');
      const concept = result.context;

      expect(concept.code).toBe('USD');
      expect(concept.display).toBe('United States dollar');
      expect(concept.decimals).toBe(2);
      expect(concept.symbol).toBe('$');
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

      expect(concepts.length).toBe(10);
      // Should have different codes
      const codes = await Promise.all(concepts.map(c => provider.code(opContext, c)));
      expect(new Set(codes).size).toBe(codes.length);
    });

    test('should return null when iterator exhausted', async () => {
      const iterator = { index: provider.totalCount(), total: provider.totalCount() };
      const concept = await provider.nextContext(opContext, iterator);
      expect(concept).toBeNull();
    });

    test('should return null iterator for specific concept', async () => {
      const result = await provider.locate(opContext, 'USD');
      const iterator = await provider.iterator(opContext, result.context);
      expect(iterator).toBeNull();
    });

    test('should iterate through all currencies', async () => {
      const iterator = await provider.iterator(opContext, null);
      const allConcepts = [];

      while (iterator.index < iterator.total) {
        const concept = await provider.nextContext(opContext, iterator);
        if (concept) {
          allConcepts.push(concept);
        }
      }

      expect(allConcepts.length).toBe(provider.totalCount());

      // Check for some known currencies
      const codes = await Promise.all(allConcepts.map(c => provider.code(opContext, c)));
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
      expect(codes).toContain('JPY');
      expect(codes).toContain('GBP');
    });
  });

  describe('Filter Support - Decimals', () => {
    test('should support decimals equals filter', async () => {
      expect(await provider.doesFilter(opContext, 'decimals', 'equals', '2')).toBe(true);
      expect(await provider.doesFilter(opContext, 'decimals', 'equals', '0')).toBe(true);
      expect(await provider.doesFilter(opContext, 'decimals', 'equals', '3')).toBe(true);
    });

    test('should not support other filters', async () => {
      expect(await provider.doesFilter(opContext, 'symbol', 'equals', '$')).toBe(false);
      expect(await provider.doesFilter(opContext, 'decimals', 'contains', '2')).toBe(false);
      expect(await provider.doesFilter(opContext, 'display', 'equals', 'Dollar')).toBe(false);
    });

    test('should throw error for search filter', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await expect(
        provider.searchFilter(opContext, ctxt, 'dollar', false)
      ).rejects.toThrow('not implemented');
    });

    test('should throw error for special filter', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await expect(
        provider.specialFilter(opContext, ctxt, 'test', false)
      ).rejects.toThrow('not implemented');
    });

    test('should throw error for unsupported filter', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await expect(
        provider.filter(opContext, ctxt, 'symbol', 'equals', '$')
      ).rejects.toThrow('not supported');
    });
  });

  describe('Filter by Decimals = 2', () => {
    let decimalsFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'decimals', 'equals', '2');
      const filters = await provider.executeFilters(opContext, ctxt);
      decimalsFilter = filters[0];
    });

    test('should create decimals=2 filter', () => {
      expect(decimalsFilter).toBeTruthy();
      expect(decimalsFilter.list).toBeTruthy();
      expect(decimalsFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for decimals=2', async () => {
      const size = await provider.filterSize(opContext, ctxt, decimalsFilter);
      expect(size).toBeGreaterThan(100); // Most currencies have 2 decimals
    });

    test('should iterate through 2-decimal currencies only', async () => {
      const currencies = [];
      decimalsFilter.cursor = -1; // Reset cursor

      // Get first 10 currencies
      for (let i = 0; i < 10; i++) {
        if (await provider.filterMore(opContext, ctxt, decimalsFilter)) {
          const concept = await provider.filterConcept(opContext, ctxt, decimalsFilter);
          expect(concept).toBeTruthy();
          expect(concept.decimals).toBe(2);
          currencies.push(concept);
        }
      }

      expect(currencies.length).toBe(10);

      // Should include major currencies like USD, EUR
      const codes = currencies.map(c => c.code);
      expect(codes).toContain('AUD');
    });

    test('should locate specific 2-decimal currency in filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, decimalsFilter, 'USD');
      expect(result).toBeTruthy();
      expect(typeof result).not.toBe('string'); // Should not be error message
      expect(result.code).toBe('USD');
      expect(result.decimals).toBe(2);
    });

    test('should not locate 0-decimal currency in 2-decimal filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, decimalsFilter, 'JPY');
      expect(typeof result).toBe('string'); // Should be error message
      expect(result).toContain('not found');
    });

    test('should check if concept is in decimals=2 filter', async () => {
      // Find a 2-decimal currency concept
      decimalsFilter.cursor = -1;
      await provider.filterMore(opContext, ctxt, decimalsFilter);
      const currencyConcept = await provider.filterConcept(opContext, ctxt, decimalsFilter);

      const isInFilter = await provider.filterCheck(opContext, ctxt, decimalsFilter, currencyConcept);
      expect(isInFilter).toBe(true);
    });
  });

  describe('Filter by Decimals = 0', () => {
    let decimalsFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'decimals', 'equals', '0');
      const filters = await provider.executeFilters(opContext, ctxt);
      decimalsFilter = filters[0];
    });

    test('should create decimals=0 filter', () => {
      expect(decimalsFilter).toBeTruthy();
      expect(decimalsFilter.list).toBeTruthy();
      expect(decimalsFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for decimals=0', async () => {
      const size = await provider.filterSize(opContext, ctxt, decimalsFilter);
      expect(size).toBeGreaterThan(10); // Several currencies have 0 decimals
      expect(size).toBeLessThan(30); // But not too many
    });

    test('should iterate through 0-decimal currencies only', async () => {
      const currencies = [];
      decimalsFilter.cursor = -1; // Reset cursor

      // Get all 0-decimal currencies
      while (await provider.filterMore(opContext, ctxt, decimalsFilter)) {
        const concept = await provider.filterConcept(opContext, ctxt, decimalsFilter);
        expect(concept).toBeTruthy();
        expect(concept.decimals).toBe(0);
        currencies.push(concept);
      }

      expect(currencies.length).toBeGreaterThan(10);

      // Check for known 0-decimal currencies
      const codes = currencies.map(c => c.code);
      expect(codes).toContain('JPY'); // Japanese Yen
      expect(codes).toContain('KRW'); // South Korean Won
      expect(codes).toContain('CLP'); // Chilean Peso
    });

    test('should locate specific 0-decimal currency in filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, decimalsFilter, 'JPY');
      expect(result).toBeTruthy();
      expect(typeof result).not.toBe('string'); // Should not be error message
      expect(result.code).toBe('JPY');
      expect(result.decimals).toBe(0);
    });

    test('should not locate 2-decimal currency in 0-decimal filter', async () => {
      const result = await provider.filterLocate(opContext, ctxt, decimalsFilter, 'USD');
      expect(typeof result).toBe('string'); // Should be error message
      expect(result).toContain('not found');
    });
  });

  describe('Filter by Decimals = 3', () => {
    let decimalsFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'decimals', 'equals', '3');
      const filters = await provider.executeFilters(opContext, ctxt);
      decimalsFilter = filters[0];
    });

    test('should create decimals=3 filter', () => {
      expect(decimalsFilter).toBeTruthy();
      expect(decimalsFilter.list).toBeTruthy();
      expect(decimalsFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for decimals=3', async () => {
      const size = await provider.filterSize(opContext, ctxt, decimalsFilter);
      expect(size).toBeGreaterThan(3); // Several Middle Eastern currencies
      expect(size).toBeLessThan(10); // But not many
    });

    test('should iterate through 3-decimal currencies only', async () => {
      const currencies = [];
      decimalsFilter.cursor = -1; // Reset cursor

      // Get all 3-decimal currencies
      while (await provider.filterMore(opContext, ctxt, decimalsFilter)) {
        const concept = await provider.filterConcept(opContext, ctxt, decimalsFilter);
        expect(concept).toBeTruthy();
        expect(concept.decimals).toBe(3);
        currencies.push(concept);
      }

      expect(currencies.length).toBeGreaterThan(3);

      // Check for known 3-decimal currencies
      const codes = currencies.map(c => c.code);
      expect(codes).toContain('BHD'); // Bahraini Dinar
      expect(codes).toContain('KWD'); // Kuwaiti Dinar
      expect(codes).toContain('JOD'); // Jordanian Dinar
    });
  });

  describe('Filter by Decimals = -1', () => {
    let decimalsFilter;
    let ctxt;

    beforeEach(async () => {
      ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'decimals', 'equals', '-1');
      const filters = await provider.executeFilters(opContext, ctxt);
      decimalsFilter = filters[0];
    });

    test('should create decimals=-1 filter', () => {
      expect(decimalsFilter).toBeTruthy();
      expect(decimalsFilter.list).toBeTruthy();
      expect(decimalsFilter.cursor).toBe(-1);
    });

    test('should return correct filter size for decimals=-1', async () => {
      const size = await provider.filterSize(opContext, ctxt, decimalsFilter);
      expect(size).toBeGreaterThan(5); // Special currencies and commodities
      expect(size).toBeLessThan(15); // But not many
    });

    test('should iterate through -1-decimal currencies only', async () => {
      const currencies = [];
      decimalsFilter.cursor = -1; // Reset cursor

      // Get all -1-decimal currencies
      while (await provider.filterMore(opContext, ctxt, decimalsFilter)) {
        const concept = await provider.filterConcept(opContext, ctxt, decimalsFilter);
        expect(concept).toBeTruthy();
        expect(concept.decimals).toBe(-1);
        currencies.push(concept);
      }

      expect(currencies.length).toBeGreaterThan(5);

      // Check for known special currencies
      const codes = currencies.map(c => c.code);
      expect(codes).toContain('XAU'); // Gold
      expect(codes).toContain('XAG'); // Silver
      expect(codes).toContain('XXX'); // No currency
    });
  });

  describe('Execute Filters', () => {
    test('should execute single filter', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await provider.filter(opContext, ctxt, 'decimals', 'equals', '2');
      const results = await provider.executeFilters(opContext, ctxt);

      expect(results).toBeTruthy();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
    });

    test('should return empty array for no filters', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      const results = await provider.executeFilters(opContext, ctxt);
      expect(results).toEqual([]);
    });

    test('should indicate filters are closed', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      expect(await provider.filtersNotClosed(opContext, ctxt)).toBe(false);
    });
  });

  describe('Subsumption - Not Supported', () => {
    test('should not support subsumption', async () => {
      expect(await provider.subsumesTest(opContext, 'USD', 'EUR')).toBe(false);
      expect(await provider.subsumesTest(opContext, 'GBP', 'JPY')).toBe(false);
    });

    test('should return error for locateIsA', async () => {
      const result = await provider.locateIsA(opContext, 'USD', 'EUR');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not supported');
    });
  });

  describe('Factory Functionality', () => {
    test('should track usage count', () => {
      const factory = new Iso4217FactoryProvider();
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

    test('should increment uses on recordUse', () => {
      const factory = new Iso4217FactoryProvider();
      expect(factory.useCount()).toBe(0);

      factory.recordUse();
      expect(factory.useCount()).toBe(1);

      factory.recordUse();
      expect(factory.useCount()).toBe(2);
    });
  });

  describe('Specific Currency Categories', () => {
    test('should find major world currencies', async () => {
      const majorCurrencies = [
        ['USD', 'United States dollar', 2, '$'],
        ['EUR', 'Euro', 2, '€'],
        ['GBP', 'Pound sterling', 2, '£'],
        ['JPY', 'Japanese yen', 0, '¥'],
        ['CHF', 'Swiss franc', 2, 'CHF'],
        ['CAD', 'Canadian dollar', 2, '$'],
        ['AUD', 'Australian dollar', 2, '$']
      ];

      for (const [code, expectedDisplay, expectedDecimals, expectedSymbol] of majorCurrencies) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.decimals).toBe(expectedDecimals);
        expect(result.context.symbol).toBe(expectedSymbol);
      }
    });

    test('should find commodity currencies', async () => {
      const commodities = [
        ['XAU', 'Gold (one troy ounce)', -1],
        ['XAG', 'Silver (one troy ounce)', -1],
        ['XPT', 'Platinum (one troy ounce)', -1],
        ['XPD', 'Palladium (one troy ounce)', -1]
      ];

      for (const [code, expectedDisplay, expectedDecimals] of commodities) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.decimals).toBe(expectedDecimals);
      }
    });

    test('should find high-precision currencies', async () => {
      const highPrecision = [
        ['BHD', 'Bahraini dinar', 3],
        ['JOD', 'Jordanian dinar', 3],
        ['KWD', 'Kuwaiti dinar', 3],
        ['OMR', 'Omani rial', 3],
        ['TND', 'Tunisian dinar', 3]
      ];

      for (const [code, expectedDisplay, expectedDecimals] of highPrecision) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.decimals).toBe(expectedDecimals);
      }
    });

    test('should find no-decimal currencies', async () => {
      const noDecimalCurrencies = [
        ['JPY', 'Japanese yen', 0],
        ['KRW', 'South Korean won', 0],
        ['VND', 'Vietnamese đồng', 0],
        ['CLP', 'Chilean peso', 0],
        ['ISK', 'Icelandic króna', 0]
      ];

      for (const [code, expectedDisplay, expectedDecimals] of noDecimalCurrencies) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.decimals).toBe(expectedDecimals);
      }
    });

    test('should find special currencies', async () => {
      const specialCurrencies = [
        ['XXX', 'No currency', -1],
        ['XTS', 'Code reserved for testing purposes', -1],
        ['XDR', 'Special drawing rights', -1]
      ];

      for (const [code, expectedDisplay, expectedDecimals] of specialCurrencies) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
        expect(result.context.decimals).toBe(expectedDecimals);
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle null operation context', () => {
      expect(() => provider._ensureOpContext(null)).toThrow();
    });

    test('should handle invalid operation context', () => {
      expect(() => provider._ensureOpContext({})).toThrow();
    });

    test('should return null for null code input', async () => {
      const result = await provider.locate(opContext, null);
      expect(result.context).toBeNull();
    });

    test('should handle case sensitivity', async () => {
      // Should not find lowercase codes
      const result = await provider.locate(opContext, 'usd');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });
  });

  describe('Edge Cases', () => {
    test('should handle repeated lookups correctly', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await provider.locate(opContext, 'EUR');
        expect(result.context).toBeTruthy();
        expect(result.message).toBeNull();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe('Euro');
      }
    });

    test('should handle context passing through ensureContext', async () => {
      const result = await provider.locate(opContext, 'GBP');
      const concept = result.context;

      // Pass concept through ensureContext
      const code1 = await provider.code(opContext, concept);
      const display1 = await provider.display(opContext, concept);

      expect(code1).toBe('GBP');
      expect(display1).toBe('Pound sterling');
    });

    test('should handle string codes through ensureContext', async () => {
      const code = await provider.code(opContext, 'JPY');
      const display = await provider.display(opContext, 'JPY');

      expect(code).toBe('JPY');
      expect(display).toBe('Japanese yen');
    });

    test('should handle all decimal categories', async () => {
      // Test that we have currencies in all decimal categories
      const allCurrencies = [];
      const iterator = await provider.iterator(opContext, null);

      while (iterator.index < iterator.total) {
        const concept = await provider.nextContext(opContext, iterator);
        if (concept) {
          allCurrencies.push(concept);
        }
      }

      const decimalCounts = {};
      for (const currency of allCurrencies) {
        const decimals = currency.decimals;
        decimalCounts[decimals] = (decimalCounts[decimals] || 0) + 1;
      }

      // Should have currencies with different decimal places
      expect(decimalCounts[0]).toBeGreaterThan(0); // 0 decimals
      expect(decimalCounts[1]).toBeGreaterThan(0); // 1 decimal
      expect(decimalCounts[2]).toBeGreaterThan(0); // 2 decimals
      expect(decimalCounts[3]).toBeGreaterThan(0); // 3 decimals
      expect(decimalCounts[-1]).toBeGreaterThan(0); // -1 decimals
    });
  });

  describe('Filter Cleanup', () => {
    test('should not throw on filter finish', async () => {
      const ctxt = await provider.getPrepContext(opContext, false);
      await expect(provider.filterFinish(opContext, ctxt)).resolves.not.toThrow();
    });
  });
});