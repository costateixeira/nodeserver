const { TxOperationContext } = require('../../tx/cs/cs-api');
const { USStateServices, USStateFactoryProvider } = require('../../tx/cs/cs-usstates');
const { LanguageDefinitions, Languages, Language } = require('../../tx/library/languages');

describe('USStateServices', () => {
  let factory;
  let provider;
  let opContext;

  beforeEach(() => {
    factory = new USStateFactoryProvider();
    provider = factory.build(null, []);
    opContext = new TxOperationContext(Languages.fromAcceptLanguage('en'));
  });

  describe('Basic Functionality', () => {
    test('should return correct system URI', () => {
      expect(provider.system()).toBe('https://www.usps.com/');
    });

    test('should return correct description', () => {
      expect(provider.description()).toBe('US State Codes');
    });

    test('should return total count of 60', () => {
      expect(provider.totalCount()).toBe(62); // 50 states + territories + military
    });

    test('should not have parents', () => {
      expect(provider.hasParents()).toBe(false);
    });

    test('should return null version', () => {
      expect(provider.version()).toBeNull();
    });
  });

  describe('Code Lookup', () => {
    test('should locate valid state codes', async () => {
      const result = await provider.locate(opContext, 'CA'); // California
      expect(result.context).toBeTruthy();
      expect(result.message).toBeNull();
      expect((await provider.code(opContext, result.context))).toBe('CA');
    });

    test('should locate valid territory codes', async () => {
      const result = await provider.locate(opContext, 'PR'); // Puerto Rico
      expect(result.context).toBeTruthy();
      expect(result.message).toBeNull();
      expect((await provider.code(opContext, result.context))).toBe('PR');
    });

    test('should locate valid military codes', async () => {
      const result = await provider.locate(opContext, 'AE'); // Armed Forces Europe
      expect(result.context).toBeTruthy();
      expect(result.message).toBeNull();
      expect((await provider.code(opContext, result.context))).toBe('AE');
    });

    test('should return error for invalid codes', async () => {
      const result = await provider.locate(opContext, 'ZZ');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });

    test('should return error for empty codes', async () => {
      const result = await provider.locate(opContext, '');
      expect(result.context).toBeNull();
      expect(result.message).toBe('Empty code');
    });

    test('should return correct displays', async () => {
      const caResult = await provider.locate(opContext, 'CA');
      const display = await provider.display(opContext, caResult.context);
      expect(display).toBe('California');

      const nyResult = await provider.locate(opContext, 'NY');
      const nyDisplay = await provider.display(opContext, nyResult.context);
      expect(nyDisplay).toBe('New York');
    });

    test('should return trimmed displays', async () => {
      const result = await provider.locate(opContext, 'TX');
      const display = await provider.display(opContext, result.context);
      expect(display).toBe('Texas');
      expect(display).not.toMatch(/^\s|\s$/); // No leading/trailing whitespace
    });

    test('should throw error for display of invalid code', async () => {
      await expect(provider.display(opContext, 'ZZ')).rejects.toThrow("US State Code 'ZZ' not found");
    });

    test('should return null definition', async () => {
      const result = await provider.locate(opContext, 'CA');
      const definition = await provider.definition(opContext, result.context);
      expect(definition).toBeNull();
    });

    test('should return false for abstract, inactive, deprecated', async () => {
      const result = await provider.locate(opContext, 'CA');
      expect(await provider.isAbstract(opContext, result.context)).toBe(false);
      expect(await provider.isInactive(opContext, result.context)).toBe(false);
      expect(await provider.isDeprecated(opContext, result.context)).toBe(false);
    });

    test('should return designations with display', async () => {
      const result = await provider.locate(opContext, 'CA');
      const designations = await provider.designations(opContext, result.context);
      expect(designations).toBeTruthy();
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBeGreaterThan(0);

      const displayDesignation = designations.find(d => d.value === 'California');
      expect(displayDesignation).toBeTruthy();
      expect(displayDesignation.language).toBe('en');
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
      const result = await provider.locate(opContext, 'CA');
      const iterator = await provider.iterator(opContext, result.context);
      expect(iterator).toBeNull();
    });

    test('should iterate through all states', async () => {
      const iterator = await provider.iterator(opContext, null);
      const allConcepts = [];

      while (iterator.index < iterator.total) {
        const concept = await provider.nextContext(opContext, iterator);
        if (concept) {
          allConcepts.push(concept);
        }
      }

      expect(allConcepts.length).toBe(provider.totalCount());

      // Check for some known states
      const codes = await Promise.all(allConcepts.map(c => provider.code(opContext, c)));
      expect(codes).toContain('CA');
      expect(codes).toContain('NY');
      expect(codes).toContain('TX');
      expect(codes).toContain('FL');
    });
  });

  describe('Subsumption', () => {
    test('should not support subsumption', async () => {
      expect(await provider.subsumesTest(opContext, 'CA', 'NY')).toBe(false);
      expect(await provider.subsumesTest(opContext, 'TX', 'FL')).toBe(false);
    });
  });

  describe('Factory Functionality', () => {
    test('should track usage count', () => {
      const factory = new USStateFactoryProvider();
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
      const factory = new USStateFactoryProvider();
      expect(factory.useCount()).toBe(0);

      factory.recordUse();
      expect(factory.useCount()).toBe(1);

      factory.recordUse();
      expect(factory.useCount()).toBe(2);
    });
  });

  describe('Specific State Tests', () => {
    test('should find all 50 US states', async () => {
      const states = [
        ['AL', 'Alabama'],
        ['AK', 'Alaska'],
        ['AZ', 'Arizona'],
        ['AR', 'Arkansas'],
        ['CA', 'California'],
        ['CO', 'Colorado'],
        ['CT', 'Connecticut'],
        ['DE', 'Delaware'],
        ['FL', 'Florida'],
        ['GA', 'Georgia'],
        ['HI', 'Hawaii'],
        ['ID', 'Idaho'],
        ['IL', 'Illinois'],
        ['IN', 'Indiana'],
        ['IA', 'Iowa'],
        ['KS', 'Kansas'],
        ['KY', 'Kentucky'],
        ['LA', 'Louisiana'],
        ['ME', 'Maine'],
        ['MD', 'Maryland'],
        ['MA', 'Massachusetts'],
        ['MI', 'Michigan'],
        ['MN', 'Minnesota'],
        ['MS', 'Mississippi'],
        ['MO', 'Missouri'],
        ['MT', 'Montana'],
        ['NE', 'Nebraska'],
        ['NV', 'Nevada'],
        ['NH', 'New Hampshire'],
        ['NJ', 'New Jersey'],
        ['NM', 'New Mexico'],
        ['NY', 'New York'],
        ['NC', 'North Carolina'],
        ['ND', 'North Dakota'],
        ['OH', 'Ohio'],
        ['OK', 'Oklahoma'],
        ['OR', 'Oregon'],
        ['PA', 'Pennsylvania'],
        ['RI', 'Rhode Island'],
        ['SC', 'South Carolina'],
        ['SD', 'South Dakota'],
        ['TN', 'Tennessee'],
        ['TX', 'Texas'],
        ['UT', 'Utah'],
        ['VT', 'Vermont'],
        ['VA', 'Virginia'],
        ['WA', 'Washington'],
        ['WV', 'West Virginia'],
        ['WI', 'Wisconsin'],
        ['WY', 'Wyoming']
      ];

      for (const [code, expectedDisplay] of states) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
      }
    });

    test('should find US territories', async () => {
      const territories = [
        ['AS', 'American Samoa'],
        ['DC', 'District of Columbia'],
        ['FM', 'Federated States of Micronesia'],
        ['GU', 'Guam'],
        ['MH', 'Marshall Islands'],
        ['MP', 'Northern Mariana Islands'],
        ['PW', 'Palau'],
        ['PR', 'Puerto Rico'],
        ['VI', 'Virgin Islands']
      ];

      for (const [code, expectedDisplay] of territories) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
      }
    });

    test('should find military addresses', async () => {
      const military = [
        ['AE', 'Armed Forces Europe, the Middle East, and Canada'],
        ['AP', 'Armed Forces Pacific'],
        ['AA', 'Armed Forces Americas (except Canada)']
      ];

      for (const [code, expectedDisplay] of military) {
        const result = await provider.locate(opContext, code);
        expect(result.context).toBeTruthy();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe(expectedDisplay);
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
      const result = await provider.locate(opContext, 'ca');
      expect(result.context).toBeNull();
      expect(result.message).toContain('not found');
    });
  });

  describe('Edge Cases', () => {
    test('should handle repeated lookups correctly', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await provider.locate(opContext, 'CA');
        expect(result.context).toBeTruthy();
        expect(result.message).toBeNull();

        const display = await provider.display(opContext, result.context);
        expect(display).toBe('California');
      }
    });

    test('should handle context passing through ensureContext', async () => {
      const result = await provider.locate(opContext, 'TX');
      const concept = result.context;

      // Pass concept through ensureContext
      const code1 = await provider.code(opContext, concept);
      const display1 = await provider.display(opContext, concept);

      expect(code1).toBe('TX');
      expect(display1).toBe('Texas');
    });

    test('should handle string codes through ensureContext', async () => {
      const code = await provider.code(opContext, 'NY');
      const display = await provider.display(opContext, 'NY');

      expect(code).toBe('NY');
      expect(display).toBe('New York');
    });
  });

});