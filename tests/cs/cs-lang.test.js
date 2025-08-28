const path = require('path');
const { 
  IETFLanguageCodeProvider, 
  IETFLanguageCodeFactory, 
  IETFLanguageCodeFilter,
  LanguageComponent 
} = require('../../tx/cs/cs-lang');
const { LanguageDefinitions, Languages, Language } = require('../../library/languages');
const { TxOperationContext, FilterExecutionContext} = require('../../tx/cs/cs-api');
const { CodeSystem } = require('../../tx/library/codesystem');

describe('IETF Language CodeSystem Provider', () => {
  let languageDefinitions;
  let provider;

  beforeAll(async () => {
    // Load language definitions from data file
    const dataPath = path.join(__dirname, '../../tx/data/lang.dat');
    languageDefinitions = await LanguageDefinitions.fromFile(dataPath);
    
    // Create provider instance
    provider = new IETFLanguageCodeProvider(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), [], languageDefinitions);
  });

  describe('Metadata', () => {
    test('should return correct system URI', () => {
      expect(provider.system()).toBe('urn:ietf:bcp:47');
    });

    test('should return empty version', () => {
      expect(provider.version()).toBeNull();
    });

    test('should return correct description', () => {
      expect(provider.description()).toBe('IETF language codes (BCP 47)');
    });

    test('should return -1 for total count (unbounded)', () => {
      expect(provider.totalCount()).toBe(-1);
    });

    test('should not have parents', () => {
      expect(provider.hasParents()).toBe(false);
    });

    test('should have complete content mode', () => {
      expect(provider.contentMode()).toBe('complete');
    });

    test('should have displays for English', () => {
      const langs = Languages.fromAcceptLanguage('en-US');
      expect(provider.hasAnyDisplays(langs)).toBe(true);
    });

    test('should not have displays for non-English without supplements', () => {
      const langs = Languages.fromAcceptLanguage('fr-FR');
      expect(provider.hasAnyDisplays(langs)).toBe(false);
    });
  });

  describe('Code validation and lookup', () => {
    test('should validate simple language codes', async () => {
      const result = await provider.locate('en');
      expect(result.context).toBeTruthy();
      expect(result.message).toBe(null);
      expect(result.context.language).toBe('en');
    });

    test('should validate language-region codes', async () => {
      const result = await provider.locate('en-US');
      expect(result.context).toBeTruthy();
      expect(result.message).toBe(null);
      expect(result.context.language).toBe('en');
      expect(result.context.region).toBe('US');
    });

    test('should validate language-script-region codes', async () => {
      const result = await provider.locate('zh-Hans-CN');
      expect(result.context).toBeTruthy();
      expect(result.message).toBe(null);
      expect(result.context.language).toBe('zh');
      expect(result.context.script).toBe('Hans');
      expect(result.context.region).toBe('CN');
    });

    test('should reject invalid language codes', async () => {
      const result = await provider.locate('invalid-code');
      expect(result.context).toBe(null);
      expect(result.message).toContain('Invalid language code');
    });

    test('should handle empty codes', async () => {
      const result = await provider.locate('');
      expect(result.context).toBe(null);
      expect(result.message).toBe('Empty code');
    });

    test('should extract code from string context',  async () => {
      const code = await provider.code('en-US');
      expect(code).toBe('en-US');
    });

    test('should extract code from Language context', async () => {
      const lang = new Language('fr-CA');
      const code = await provider.code(lang);
      expect(code).toBe('fr-CA');
    });
  });

  describe('Display names', () => {
    test('should return display for simple language', async () => {
      const display = await provider.display('en');
      expect(display).toBeTruthy();
      expect(display).not.toBe('??');
    });

    test('should return display for language-region', async () => {
      const display = await provider.display('en-US');
      expect(display).toBeTruthy();
      expect(display).not.toBe('??');
    });

    test('should throw an error for invalid codes', async () => {
      await expect(provider.display('invalid')).rejects.toThrow("Invalid language code: invalid");
    });

    test('should return null for empty codes', async () => {
      await expect(provider.display('')).rejects.toThrow('Empty code');
    });
  });

  describe('Designations', () => {
    test('should return designations for valid language', async () => {
      const designations = await provider.designations('en');
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBeGreaterThan(0);
      
      // Should have at least one primary designation
      const primary = designations.find(d => d.language === 'en');
      expect(primary).toBeTruthy();
      expect(primary.value).toBeTruthy();
    });

    test('should return multiple designations for language-region codes', async () => {
      const designations = await provider.designations('en-US');
      expect(Array.isArray(designations)).toBe(true);
      expect(designations.length).toBeGreaterThan(1);
      
      // Should have region variant designations
      const regionVariant = designations.find(d => d.value.includes('('));
      expect(regionVariant).toBeTruthy();
    });

    test('should return empty array for invalid codes', async () => {
      await expect(provider.designations('invalid')).rejects.toThrow('Invalid language code: invalid');
    });
  });

  describe('Filtering',  () => {
    test('should support exists filters for language components', async () => {
      expect(await provider.doesFilter('language', 'exists', 'true')).toBe(true);
      expect(await provider.doesFilter('script', 'exists', 'false')).toBe(true);
      expect(await provider.doesFilter('region', 'exists', 'true')).toBe(true);
      expect(await provider.doesFilter('invalid', 'exists', 'true')).toBe(false);
      expect(await provider.doesFilter('language', 'equals', 'en')).toBe(false);
    });

    test('should create language component filters', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'language', 'exists', 'true');
      const filters = await provider.executeFilters(prep);
      expect(filters[0]).toBeInstanceOf(IETFLanguageCodeFilter);
      expect(filters[0].component).toBe(LanguageComponent.LANG);
      expect(filters[0].status).toBe(true);
    });

    test('should reject unsupported filter operators', async () => {
      const prep = await provider.getPrepContext(false);
      
      await expect(
        provider.filter(prep, 'language', 'equals', 'en')
      ).rejects.toThrow('Unsupported filter operator');
    });

    test('should reject invalid exists values', async () => {
      const prep = await provider.getPrepContext(false);
      
      await expect(
        provider.filter(prep, 'language', 'exists', 'maybe')
      ).rejects.toThrow('Invalid exists value');
    });

    test('should reject unsupported properties', async () => {
      const prep = await provider.getPrepContext(false);
      
      await expect(
        provider.filter(prep, 'invalid-prop', 'exists', 'true')
      ).rejects.toThrow('Unsupported filter property');
    });
  });

  describe('Filter location', () => {
    test('should locate code with required language component', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'language', 'exists', 'true');
      const filters = await provider.executeFilters(prep);
      const result = await provider.filterLocate(prep, filters[0], 'en-US');
      expect(result).toBeInstanceOf(Language);
      expect(result.code).toBe('en-US');
    });

    test('should locate code with required region component', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'region', 'exists', 'true');
      const filters = await provider.executeFilters(prep);
      const filter = filters[0];
      
      const result = await provider.filterLocate(prep, filter, 'en-US');
      expect(result).toBeInstanceOf(Language);
      expect(result.region).toBe('US');
    });

    test('should reject code missing required component', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'region', 'exists', 'true');
      const filters = await provider.executeFilters(prep);
      const filter = filters[0];

      const result = await provider.filterLocate(prep, filter, 'en');
      expect(typeof result).toBe('string');
      expect(result).toContain('does not contain');
    });

    test('should reject code with forbidden component', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'region', 'exists', 'false');
      const filters = await provider.executeFilters(prep);
      const filter = filters[0];

      const result = await provider.filterLocate(prep, filter, 'en-US');
      expect(typeof result).toBe('string');
      expect(result).toContain('contains');
      expect(result).toContain('not allowed');
    });

    test('should reject invalid language codes in filter', async () => {
      const prep = await provider.getPrepContext(false);
      await provider.filter(prep, 'language', 'exists', 'true');
      const filters = await provider.executeFilters(prep);
      const filter = filters[0];

      const result = await provider.filterLocate(prep, filter, 'invalid-code');
      expect(typeof result).toBe('string');
      expect(result).toContain('Invalid language code');
    });
  });

  describe('Filter checking', () => {
    test('should check if concept matches filter', async () => {
      const filter = new IETFLanguageCodeFilter(LanguageComponent.REGION, true);
      const concept = new Language('en-US');
      
      const result = await provider.filterCheck(await provider.getPrepContext(false), filter, concept);
      expect(result).toBe(true);
    });

    test('should check if concept fails filter', async () => {
      const filter = new IETFLanguageCodeFilter(LanguageComponent.REGION, true);
      const concept = new Language('en');
      
      const result = await provider.filterCheck(await provider.getPrepContext(false), filter, concept);
      expect(result).toBe(false);
    });

    test('should validate filter type in filterCheck', async () => {
      const concept = new Language('en');
      
      expect(async () => {
        await provider.filterCheck(new FilterExecutionContext(), 'invalid', concept);
      }).rejects.toThrow('set must be a IETFLanguageCodeFilter');
    });

    test('should validate concept type in filterCheck', async () => {
      const filter = new IETFLanguageCodeFilter(LanguageComponent.REGION, true);
      
      expect(async () => {
        await provider.filterCheck(new FilterExecutionContext(), filter, 'invalid');
      }).rejects.toThrow('Invalid language code: invalid');
    });
  });

  describe('Supplements', () => {
    test('should report no supplements by default', () => {
      expect(provider.hasSupplement('http://example.com/supplement')).toBe(false);
      expect(provider.listSupplements()).toEqual([]);
    });

    test('should validate supplement types', () => {
      expect(() => {
        new IETFLanguageCodeProvider(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), ['invalid'], languageDefinitions);
      }).toThrow('must be a CodeSystem instance');
    });

    test('should validate supplement array type', () => {
      expect(() => {
        new IETFLanguageCodeProvider(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), 'invalid', languageDefinitions);
      }).toThrow('Supplements must be an array');
    });
  });

  describe('Unsupported operations', () => {
    test('should not support subsumption', async () => {
      const result = await provider.locateIsA('en-US', 'en');
      expect(result.context).toBe(null);
      expect(result.message).toContain('parents');
    });

    test('should not support iteration', async () => {
      expect(await provider.iterator(null)).toBe(null);
      expect(await provider.nextContext(null)).toBe(null);
    });

    test('should not support expansion', async () => {
      const filterContext = new FilterExecutionContext();
      const filter = new IETFLanguageCodeFilter(LanguageComponent.LANG, true);
      
      expect(async () => {
        await provider.filterSize(filterContext, filter);
      }).rejects.toThrow('cannot be expanded');

      expect(async () => {
        await provider.filterMore(filterContext, filter);
      }).rejects.toThrow('cannot be expanded');
      
      expect(async () => {
        await provider.filterConcept(filterContext, filter);
      }).rejects.toThrow('cannot be expanded');
    });

    test('should not support text search', async () => {
      await expect(
        provider.searchFilter(new FilterExecutionContext(), 'english', false)
      ).rejects.toThrow('Text search not supported');
    });

    test('should indicate filters are not closed', async () => {
      expect(await provider.filtersNotClosed(await provider.getPrepContext(false))).toBe(true);
    });
  });

  describe('Utility methods',  () => {
    test('should compare concepts correctly', async () => {
      const lang1 = new Language('en-US');
      const lang2 = new Language('en-US');
      const lang3 = new Language('fr-CA');
      
      expect(await provider.sameConcept(lang1, lang2)).toBe(true);
      expect(await provider.sameConcept(lang1, lang3)).toBe(false);
      expect(await provider.sameConcept('en-US', 'en-US')).toBe(true);
    });

    test('should not support subsumption testing', async () => {
      expect(await provider.subsumesTest('en', 'en-US')).toBe(false);
    });

    test('should return empty definitions', async () => {
      const definition = await provider.definition('en');
      expect(definition).toBe(null);
    });

    test('should report codes as not abstract', async () => {
      expect(await provider.isAbstract('en')).toBe(false);
    });

    test('should report codes as not inactive', async () => {
      expect(await provider.isInactive('en')).toBe(false);
    });

    test('should report codes as not deprecated', async () => {
      expect(await provider.isDeprecated('en')).toBe(false);
    });

    test('should return null status', async () => {
      expect(await provider.getStatus('en')).toBe(null);
    });
  });

  describe('Factory', () => {
    let factory;

    beforeEach(() => {
      factory = new IETFLanguageCodeFactory(languageDefinitions);
    });

    test('should create factory correctly', () => {
      expect(factory.languageDefinitions).toBe(languageDefinitions);
      expect(factory.useCount()).toBe(0);
    });

    test('should return empty default version', () => {
      expect(factory.defaultVersion()).toBe('');
    });

    test('should build providers and track usage', () => {
      const provider1 = factory.build(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), null);
      expect(provider1).toBeInstanceOf(IETFLanguageCodeProvider);
      expect(factory.useCount()).toBe(1);

      const provider2 = factory.build(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), []);
      expect(provider2).toBeInstanceOf(IETFLanguageCodeProvider);
      expect(factory.useCount()).toBe(2);
    });

    test('should pass supplements to built providers', () => {
      const supplements = [];
      const provider = factory.build(new TxOperationContext(Languages.fromAcceptLanguage('en-US')), supplements);
      expect(provider.supplements).toBe(supplements);
    });
  });
});
