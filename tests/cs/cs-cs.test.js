const fs = require('fs');
const path = require('path');

const { CodeSystem } = require('../../tx/library/codesystem');
const { FhirCodeSystemFactory, FhirCodeSystemProvider } = require('../../tx/cs/cs-cs');
const { TxOperationContext } = require('../../tx/cs/cs-api');
const { Languages, Language } = require('../../library/languages');

describe('FHIR CodeSystem Provider', () => {
  let factory;
  let simpleCS, deCS, extensionsCS, supplementCS;
  let opContextEn, opContextDe, opContextMulti;

  beforeEach(() => {
    // Initialize factory
    factory = new FhirCodeSystemFactory();

    // Load test CodeSystems
    const simpleData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tx/data/cs-simple.json'), 'utf8'));
    const deData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tx/data/cs-de.json'), 'utf8'));
    const extensionsData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tx/data/cs-extensions.json'), 'utf8'));
    const supplementData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../tx/data/cs-supplement.json'), 'utf8'));

    simpleCS = new CodeSystem(simpleData);
    deCS = new CodeSystem(deData);
    extensionsCS = new CodeSystem(extensionsData);
    supplementCS = new CodeSystem(supplementData);

    // Create operation contexts for different languages
    opContextEn = new TxOperationContext('en-US');
    opContextDe = new TxOperationContext('de-DE');
    opContextMulti = new TxOperationContext('en-US,de;q=0.8,es;q=0.6');
  });

  describe('Factory', () => {
    test('should have correct default version', () => {
      expect(factory.defaultVersion()).toBe('unknown');
    });

    test('should increment use count', () => {
      const initialCount = factory.useCount();
      factory.build(opContextEn, simpleCS, []);
      expect(factory.useCount()).toBe(initialCount + 1);
    });

    test('should validate CodeSystem parameter', () => {
      expect(() => {
        factory.build(opContextEn, null, []);
      }).toThrow('codeSystem parameter is required');

      expect(() => {
        factory.build(opContextEn, { resourceType: 'ValueSet' }, []);
      }).toThrow('codeSystem must be a FHIR CodeSystem resource');
    });

    test('should validate supplements parameter', () => {
      expect(() => {
        factory.build(opContextEn, simpleCS, 'not-an-array');
      }).toThrow('supplements must be an array');

      expect(() => {
        factory.build(opContextEn, simpleCS, [{ resourceType: 'ValueSet' }]);
      }).toThrow('Supplement 0 must be a FHIR CodeSystem resource');
    });

    test('should build provider with supplements', () => {
      const provider = factory.build(opContextEn, extensionsCS, [supplementCS]);
      expect(provider).toBeInstanceOf(FhirCodeSystemProvider);
      expect(provider.supplements).toHaveLength(1);
    });
  });

  describe('Metadata Methods', () => {
    let simpleProvider, deProvider, extensionsProvider;

    beforeEach(() => {
      simpleProvider = factory.build(opContextEn, simpleCS, []);
      deProvider = factory.build(opContextDe, deCS, []);
      extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
    });

    describe('name()', () => {
      test('should return name for simple CodeSystem', () => {
        expect(simpleProvider.name()).toBe('SimpleTestCodeSystem');
      });

    });

    describe('system()', () => {
      test('should return correct system URI', () => {
        expect(simpleProvider.system()).toBe('http://hl7.org/fhir/test/CodeSystem/simple');
        expect(deProvider.system()).toBe('http://hl7.org/fhir/test/CodeSystem/de-multi');
        expect(extensionsProvider.system()).toBe('http://hl7.org/fhir/test/CodeSystem/extensions');
      });
    });

    describe('version()', () => {
      test('should return version when present', () => {
        expect(simpleProvider.version()).toBe('0.1.0');
      });

      test('should return null when version is missing', () => {
        expect(deProvider.version()).toBeNull();
      });
    });

    describe('defLang()', () => {
      test('should return English for English CodeSystem', () => {
        expect(simpleProvider.defLang()).toBe('en');
      });

      test('should return German for German CodeSystem', () => {
        expect(deProvider.defLang()).toBe('de');
      });

      test('should default to en when no language specified', () => {
        const noLangData = { ...simpleCS.jsonObj };
        delete noLangData.language;
        const noLangCS = new CodeSystem(noLangData);
        const noLangProvider = factory.build(opContextEn, noLangCS, []);
        expect(noLangProvider.defLang()).toBe('en');
      });
    });

    describe('contentMode()', () => {
      test('should return complete for complete CodeSystem', () => {
        expect(simpleProvider.contentMode()).toBe('complete');
      });

      test('should return supplement for supplement CodeSystem', () => {
        const supplementProvider = factory.build(opContextEn, supplementCS, []);
        expect(supplementProvider.contentMode()).toBe('supplement');
      });
    });

    describe('description()', () => {
      test('should return title when description missing', () => {
        expect(simpleProvider.description()).toBe('Simple Test Code System');
        expect(deProvider.description()).toBe('Testcodesystem mit mehreren Sprachen');
      });
    });

    describe('sourcePackage()', () => {
      test('should return null for FHIR CodeSystems', () => {
        expect(simpleProvider.sourcePackage()).toBeNull();
      });
    });

    describe('totalCount()', () => {
      test('should return correct concept count', () => {
        expect(simpleProvider.totalCount()).toBe(7);
        expect(deProvider.totalCount()).toBe(7);
        expect(extensionsProvider.totalCount()).toBe(6);
      });
    });

    describe('propertyDefinitions()', () => {
      test('should return null when no properties defined', () => {
        expect(deProvider.propertyDefinitions()).toBeNull();
      });

      test('should return property definitions when present', () => {
        const simpleProps = simpleProvider.propertyDefinitions();
        expect(simpleProps).toBeInstanceOf(Array);
        expect(simpleProps).toHaveLength(3);

        const propCodes = simpleProps.map(p => p.code);
        expect(propCodes).toContain('prop');
        expect(propCodes).toContain('status');
        expect(propCodes).toContain('notSelectable');
      });

      test('should return property definitions for extensions CodeSystem', () => {
        const extensionsProps = extensionsProvider.propertyDefinitions();
        expect(extensionsProps).toBeInstanceOf(Array);
        expect(extensionsProps).toHaveLength(2);

        const propCodes = extensionsProps.map(p => p.code);
        expect(propCodes).toContain('prop');
        expect(propCodes).toContain('alternateCode');
      });
    });

    describe('hasAnyDisplays()', () => {
      test('should return true for English when language is English', () => {
        const langs = Languages.fromAcceptLanguage('en-US');
        expect(simpleProvider.hasAnyDisplays(langs)).toBe(true);
      });

      test('should return true for German when CodeSystem has German displays', () => {
        const langs = Languages.fromAcceptLanguage('de');
        expect(deProvider.hasAnyDisplays(langs)).toBe(true);
      });

      test('should return true for Swiss-German when CodeSystem has German displays', () => {
        const langs = Languages.fromAcceptLanguage('de-CH');
        expect(deProvider.hasAnyDisplays(langs)).toBe(true);
      });

      test('should return true for German-German when CodeSystem has German displays', () => {
        const langs = Languages.fromAcceptLanguage('de-DE');
        expect(deProvider.hasAnyDisplays(langs)).toBe(false);
      });

      test('should return true when CodeSystem has designations in requested language', () => {
        const langs = Languages.fromAcceptLanguage('es');
        expect(deProvider.hasAnyDisplays(langs)).toBe(true);
      });

      test('should return false when no matching language found', () => {
        const langs = Languages.fromAcceptLanguage('zh-CN');
        expect(simpleProvider.hasAnyDisplays(langs)).toBe(false);
      });

      test('should return true when supplements have matching displays', () => {
        const langs = Languages.fromAcceptLanguage('nl');
        expect(extensionsProvider.hasAnyDisplays(langs)).toBe(true);
      });
    });

    describe('hasParents()', () => {
      test('should return true for CodeSystem with hierarchy', () => {
        expect(simpleProvider.hasParents()).toBe(true);
        expect(deProvider.hasParents()).toBe(true);
      });

      test('should return false for CodeSystem without hierarchy', () => {
        expect(extensionsProvider.hasParents()).toBe(false);
      });
    });

    describe('versionIsMoreDetailed()', () => {
      test('should return false for null/empty versions', () => {
        expect(simpleProvider.versionIsMoreDetailed(null, '1.0')).toBe(false);
        expect(simpleProvider.versionIsMoreDetailed('1.0', null)).toBe(false);
      });
    });
  });

  describe('Language and Display Features', () => {
    let deProvider;

    beforeEach(() => {
      deProvider = factory.build(opContextDe, deCS, []);
    });

    test('should correctly parse German language', () => {
      const lang = deCS.language();
      expect(lang).toBeInstanceOf(Language);
      expect(lang.language).toBe('de');
    });

    test('should detect hierarchy in nested concepts', () => {
      expect(deProvider.hasParents()).toBe(true);

      const children = deCS.getChildren('code2');
      expect(children).toContain('code2a');
      expect(children).toContain('code2b');

      const grandchildren = deCS.getChildren('code2a');
      expect(grandchildren).toContain('code2aI');
      expect(grandchildren).toContain('code2aII');
    });

    test('should handle multilingual designations correctly', () => {
      const langs = Languages.fromAcceptLanguage('es,en;q=0.8');
      expect(deProvider.hasAnyDisplays(langs)).toBe(true);
    });
  });

  describe('Supplement Integration', () => {
    let extensionsProvider;

    beforeEach(() => {
      extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
    });

    test('should include supplement in provider', () => {
      expect(extensionsProvider.supplements).toHaveLength(1);
      expect(extensionsProvider.supplements[0]).toBe(supplementCS);
    });

    test('should detect supplement displays', () => {
      const langs = Languages.fromAcceptLanguage('nl');
      expect(extensionsProvider.hasAnyDisplays(langs)).toBe(true);
    });

    test('should handle supplement URL matching', () => {
      expect(extensionsProvider.hasSupplement('http://hl7.org/fhir/test/CodeSystem/supplement')).toBe(true);
      expect(extensionsProvider.hasSupplement('http://example.com/unknown')).toBe(false);
    });

    test('should list supplements correctly', () => {
      const supplements = extensionsProvider.listSupplements();
      expect(supplements).toHaveLength(1);
      expect(supplements[0]).toBe('http://hl7.org/fhir/test/CodeSystem/supplement');
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid CodeSystem gracefully', () => {
      const invalidData = {
        resourceType: 'CodeSystem'
        // Missing required fields
      };

      expect(() => {
        new CodeSystem(invalidData);
      }).toThrow('Invalid CodeSystem');
    });

    test('should validate concept structure', () => {
      const invalidConcepts = {
        resourceType: 'CodeSystem',
        url: 'http://example.com/test',
        name: 'Test',
        status: 'active',
        content: 'complete',
        concept: [
          {
            // Missing required code field
            display: 'Test Display'
          }
        ]
      };

      expect(() => {
        new CodeSystem(invalidConcepts);
      }).toThrow('code is required');
    });
  });

  describe('CodeSystem Class Extensions', () => {
    test('should correctly implement language() method', () => {
      const lang = simpleCS.language();
      expect(lang).toBeInstanceOf(Language);
      expect(lang.language).toBe('en');
    });

    test('should correctly implement contentMode() method', () => {
      expect(simpleCS.contentMode()).toBe('complete');
      expect(supplementCS.contentMode()).toBe('supplement');
    });

    test('should correctly implement hasHierarchy() method', () => {
      expect(simpleCS.hasHierarchy()).toBe(true);
      expect(extensionsCS.hasHierarchy()).toBe(false);
    });

    test('should handle missing language gracefully', () => {
      const noLangData = { ...simpleCS.jsonObj };
      delete noLangData.language;
      const noLangCS = new CodeSystem(noLangData);
      expect(noLangCS.language()).toBeNull();
    });
  });

  describe('Real World Scenarios', () => {
    test('should handle complex multilingual CodeSystem', () => {
      const provider = factory.build(opContextMulti, deCS, []);

      const langs = Languages.fromAcceptLanguage('en-US,de;q=0.8,es;q=0.6');
      expect(provider.hasAnyDisplays(langs)).toBe(true);
      expect(provider.hasParents()).toBe(true);
      expect(provider.totalCount()).toBe(7);
    });

    test('should handle extension-based CodeSystem with supplements', () => {
      const provider = factory.build(opContextEn, extensionsCS, [supplementCS]);

      expect(provider.system()).toBe('http://hl7.org/fhir/test/CodeSystem/extensions');
      expect(provider.supplements).toHaveLength(1);

      const props = provider.propertyDefinitions();
      expect(props).toHaveLength(2);

      const nlLangs = Languages.fromAcceptLanguage('nl');
      expect(provider.hasAnyDisplays(nlLangs)).toBe(true);
    });
  });
});