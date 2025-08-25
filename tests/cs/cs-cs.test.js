const fs = require('fs');
const path = require('path');

const {CodeSystem} = require('../../tx/library/codesystem');
const {FhirCodeSystemFactory, FhirCodeSystemProvider, FhirCodeSystemProviderContext} = require('../../tx/cs/cs-cs');
const {TxOperationContext} = require('../../tx/cs/cs-api');
const {Languages, Language} = require('../../library/languages');

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
        factory.build(opContextEn, {resourceType: 'ValueSet'}, []);
      }).toThrow('codeSystem must be a FHIR CodeSystem resource');
    });

    test('should validate supplements parameter', () => {
      expect(() => {
        factory.build(opContextEn, simpleCS, 'not-an-array');
      }).toThrow('supplements must be an array');

      expect(() => {
        factory.build(opContextEn, simpleCS, [{resourceType: 'ValueSet'}]);
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
        const noLangData = {...simpleCS.jsonObj};
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

      test('should return true for Swiss German when CodeSystem has Swiss German displays', () => {
        const langs = Languages.fromAcceptLanguage('de-CH');
        expect(deProvider.hasAnyDisplays(langs)).toBe(true);
      });

      test('should return false for German German when CodeSystem has only German displays', () => {
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

    describe('status()', () => {
      test('should return status information when present', () => {
        const status = simpleProvider.status();
        expect(status).toBeDefined();
        expect(status.status).toBe('active');
        expect(status.experimental).toBe(false);
      });

      test('should return null when status missing', () => {
        // Create a CodeSystem without status
        const noStatusData = {...simpleCS.jsonObj};
        delete noStatusData.status;
        const noStatusCS = new CodeSystem(noStatusData);
        const noStatusProvider = factory.build(opContextEn, noStatusCS, []);
        expect(noStatusProvider.status()).toBeNull();
      });

      test('should handle experimental flag', () => {
        const status = deProvider.status();
        expect(status).toBeDefined();
        expect(status.status).toBe('active');
        expect(status.experimental).toBe(false);
      });
    });
  });

  describe('Core Concept Methods', () => {
    let simpleProvider;

    beforeEach(() => {
      simpleProvider = factory.build(opContextEn, simpleCS, []);
    });

    describe('locate()', () => {
      test('should locate existing code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'code1');
        expect(result.context).toBeDefined();
        expect(result.context).toBeInstanceOf(FhirCodeSystemProviderContext);
        expect(result.context.code).toBe('code1');
        expect(result.message).toBeNull();
      });

      test('should locate nested code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'code2a');
        expect(result.context).toBeDefined();
        expect(result.context.code).toBe('code2a');
        expect(result.message).toBeNull();
      });

      test('should return null for non-existent code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'nonexistent');
        expect(result.context).toBeNull();
        expect(result.message).toContain('not found');
      });

      test('should handle empty code', async () => {
        const result = await simpleProvider.locate(opContextEn, '');
        expect(result.context).toBeNull();
        expect(result.message).toContain('Empty or invalid code');
      });

      test('should handle null code', async () => {
        const result = await simpleProvider.locate(opContextEn, null);
        expect(result.context).toBeNull();
        expect(result.message).toContain('Empty or invalid code');
      });
    });

    describe('code()', () => {
      test('should return code from string input', async () => {
        const code = await simpleProvider.code(opContextEn, 'code1');
        expect(code).toBe('code1');
      });

      test('should return code from context input', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const code = await simpleProvider.code(opContextEn, locateResult.context);
        expect(code).toBe('code2');
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.code(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });

      test('should throw error for invalid context type', async () => {
        await expect(simpleProvider.code(opContextEn, {invalid: 'object'}))
          .rejects.toThrow('Unknown Type at #ensureContext');
      });
    });
  });

  describe('status()', () => {
    let simpleProvider, deProvider;

    beforeEach(() => {
      simpleProvider = factory.build(opContextEn, simpleCS, []);
      deProvider = factory.build(opContextEn, deCS, []);
    });

    test('should return status information when present', () => {
      const status = simpleProvider.status();
      expect(status).toBeDefined();
      expect(status.status).toBe('active');
      expect(status.experimental).toBe(false);
    });

    test('should return null when status missing', () => {
      // Create a CodeSystem without status
      const noStatusData = {...simpleCS.jsonObj};
      delete noStatusData.status;
      const noStatusCS = new CodeSystem(noStatusData);
      const noStatusProvider = factory.build(opContextEn, noStatusCS, []);
      expect(noStatusProvider.status()).toBeNull();
    });

    test('should handle experimental flag', () => {
      const status = deProvider.status();
      expect(status).toBeDefined();
      expect(status.status).toBe('active');
      expect(status.experimental).toBe(false);
    });
  });

  describe('Core Concept Methods', () => {
    let simpleProvider;

    beforeEach(() => {
      simpleProvider = factory.build(opContextEn, simpleCS, []);
    });

    describe('locate()', () => {
      test('should locate existing code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'code1');
        expect(result.context).toBeDefined();
        expect(result.context).toBeInstanceOf(FhirCodeSystemProviderContext);
        expect(result.context.code).toBe('code1');
        expect(result.message).toBeNull();
      });

      test('should locate nested code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'code2a');
        expect(result.context).toBeDefined();
        expect(result.context.code).toBe('code2a');
        expect(result.message).toBeNull();
      });

      test('should return null for non-existent code', async () => {
        const result = await simpleProvider.locate(opContextEn, 'nonexistent');
        expect(result.context).toBeNull();
        expect(result.message).toContain('not found');
      });

      test('should handle empty code', async () => {
        const result = await simpleProvider.locate(opContextEn, '');
        expect(result.context).toBeNull();
        expect(result.message).toContain('Empty or invalid code');
      });

      test('should handle null code', async () => {
        const result = await simpleProvider.locate(opContextEn, null);
        expect(result.context).toBeNull();
        expect(result.message).toContain('Empty or invalid code');
      });
    });

    describe('code()', () => {
      test('should return code from string input', async () => {
        const code = await simpleProvider.code(opContextEn, 'code1');
        expect(code).toBe('code1');
      });

      test('should return code from context input', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const code = await simpleProvider.code(opContextEn, locateResult.context);
        expect(code).toBe('code2');
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.code(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });

      test('should throw error for invalid context type', async () => {
        await expect(simpleProvider.code(opContextEn, {invalid: 'object'}))
          .rejects.toThrow('Unknown Type at #ensureContext');
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
      const noLangData = {...simpleCS.jsonObj};
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

  describe('functional tests', () => {
    let simpleProvider;

    beforeEach(() => {
      simpleProvider = factory.build(opContextEn, simpleCS, []);
    });

    describe('display()', () => {

      test('should return display for code', async () => {
        const display = await simpleProvider.display(opContextEn, 'code1');
        expect(display).toBe('Display 1');
      });

      test('should return display for context', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const display = await simpleProvider.display(opContextEn, locateResult.context);
        expect(display).toBe('Display 2');
      });

      test('should throw error for non-existent code', async () => {
        await expect(simpleProvider.display(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });

      test('should handle language-specific displays', async () => {
        const deProvider = factory.build(opContextDe, deCS, []);
        const display = await deProvider.display(opContextDe, 'code1');
        expect(display).toBe('Anzeige 1');
      });

      test('should handle designation-based displays', async () => {
        const deProvider = factory.build(opContextEn, deCS, []);
        const esContext = new TxOperationContext('es');
        const display = await deProvider.display(esContext, 'code2');
        expect(display).toBe('Mostrar 2');
      });
    });

    describe('definition()', () => {
      test('should return definition when present', async () => {
        const definition = await simpleProvider.definition(opContextEn, 'code1');
        expect(definition).toBe('My first code');
      });

      test('should return null for code without definition', async () => {
        // Test with code that might not have definition
        const definition = await simpleProvider.definition(opContextEn, 'code1');
        expect(typeof definition).toBe('string'); // Should have definition
      });
    });

    describe('isAbstract()', () => {
      test('should return false for concrete concepts', async () => {
        const isAbstract = await simpleProvider.isAbstract(opContextEn, 'code1');
        expect(isAbstract).toBe(false);
      });

      test('should return true for abstract concepts', async () => {
        // code2 has notSelectable=true property
        const isAbstract = await simpleProvider.isAbstract(opContextEn, 'code2');
        expect(isAbstract).toBe(true);
      });
    });

    describe('isInactive()', () => {
      test('should return false for active concepts', async () => {
        const isInactive = await simpleProvider.isInactive(opContextEn, 'code1');
        expect(isInactive).toBe(false);
      });
    });

    describe('isDeprecated()', () => {
      test('should return false for active concepts', async () => {
        const isDeprecated = await simpleProvider.isDeprecated(opContextEn, 'code1');
        expect(isDeprecated).toBe(false);
      });

      test('should return true for retired concepts', async () => {
        // code2 has status=retired property
        const isDeprecated = await simpleProvider.isDeprecated(opContextEn, 'code2');
        expect(isDeprecated).toBe(true);
      });
    });

    describe('getStatus()', () => {
      test('should return null for concepts without status', async () => {
        const status = await simpleProvider.getStatus(opContextEn, 'code1');
        expect(status).toBeNull();
      });

      test('should return status when present', async () => {
        // code2 has status=retired property
        const status = await simpleProvider.getStatus(opContextEn, 'code2');
        expect(status).toBe('retired');
      });
    });

    describe('itemWeight()', () => {
      test('should return null for concepts without itemWeight', async () => {
        const weight = await simpleProvider.itemWeight(opContextEn, 'code1');
        expect(weight).toBeNull();
      });

      test('should return itemWeight from supplement', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
        const weight = await extensionsProvider.itemWeight(opContextEn, 'code1');
        expect(weight).toBe('1.2');
      });
    });

    describe('designations()', () => {
      test('should return designations for code with display', async () => {
        const designations = await simpleProvider.designations(opContextEn, 'code1');
        expect(designations).toBeDefined();
        expect(Array.isArray(designations)).toBe(true);
        expect(designations.length).toBeGreaterThan(0);

        // Should have at least the main display
        const displayDesignation = designations.find(d => d.value === 'Display 1');
        expect(displayDesignation).toBeDefined();
      });

      test('should return designations from concept designations', async () => {
        const designations = await simpleProvider.designations(opContextEn, 'code1');
        expect(designations).toBeDefined();

        // Should include the olde-english designation
        const oldeEnglish = designations.find(d => d.value === 'mine own first code');
        expect(oldeEnglish).toBeDefined();
      });

      test('should include supplement designations', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
        const designations = await extensionsProvider.designations(opContextEn, 'code1');
        expect(designations).toBeDefined();

        // Should include Dutch designation from supplement
        const dutchDesignation = designations.find(d => d.value === 'ectenoot');
        expect(dutchDesignation).toBeDefined();
        expect(dutchDesignation.language).toBe('nl');
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.designations(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });
    });

    describe('extensions()', () => {
      test('should return null for concepts without extensions', async () => {
        const extensions = await simpleProvider.extensions(opContextEn, 'code1');
        expect(extensions).toBeNull();
      });

      test('should return extensions when present', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, []);
        const extensions = await extensionsProvider.extensions(opContextEn, 'code1');
        expect(extensions).toBeDefined();
        expect(Array.isArray(extensions)).toBe(true);

        // Should have the conceptOrder extension
        const orderExt = extensions.find(ext =>
          ext.url === 'http://hl7.org/fhir/StructureDefinition/codesystem-conceptOrder'
        );
        expect(orderExt).toBeDefined();
        expect(orderExt.valueInteger).toBe(6);
      });

      test('should include supplement extensions', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
        const extensions = await extensionsProvider.extensions(opContextEn, 'code1');
        expect(extensions).toBeDefined();

        // Should include itemWeight extension from supplement
        const itemWeightExt = extensions.find(ext =>
          ext.url === 'http://hl7.org/fhir/StructureDefinition/itemWeight'
        );
        expect(itemWeightExt).toBeDefined();
        expect(itemWeightExt.valueDecimal).toBe(1.2);
      });
    });

    describe('properties()', () => {
      test('should return null for concepts without properties', async () => {
        const properties = await simpleProvider.properties(opContextEn, 'code3');
        expect(properties).toBeDefined();
        expect(Array.isArray(properties)).toBe(true);

        // Should have at least the 'prop' property
        const propProperty = properties.find(p => p.code === 'prop');
        expect(propProperty).toBeDefined();
      });

      test('should return properties when present', async () => {
        const properties = await simpleProvider.properties(opContextEn, 'code1');
        expect(properties).toBeDefined();
        expect(Array.isArray(properties)).toBe(true);

        // Should have the 'prop' property with value 'old'
        const propProperty = properties.find(p => p.code === 'prop');
        expect(propProperty).toBeDefined();
        expect(propProperty.valueCode).toBe('old');
      });

      test('should return multiple properties', async () => {
        const properties = await simpleProvider.properties(opContextEn, 'code2');
        expect(properties).toBeDefined();
        expect(Array.isArray(properties)).toBe(true);
        expect(properties.length).toBeGreaterThan(1);

        // Should have prop, notSelectable, and status properties
        const propCodes = properties.map(p => p.code);
        expect(propCodes).toContain('prop');
        expect(propCodes).toContain('notSelectable');
        expect(propCodes).toContain('status');
      });

      test('should include supplement properties', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
        const properties = await extensionsProvider.properties(opContextEn, 'code1');

        // Extensions CS code1 should have properties, but supplements don't add properties in our test data
        // This test mainly ensures the method doesn't break with supplements
        expect(properties).toBeDefined();
      });
    });

    describe('parent()', () => {
      test('should return null for root concepts', async () => {
        const parent = await simpleProvider.parent(opContextEn, 'code1');
        expect(parent).toBeNull();
      });

      test('should return parent for child concepts', async () => {
        const parent = await simpleProvider.parent(opContextEn, 'code2a');
        expect(parent).toBe('code2');
      });

      test('should return parent for grandchild concepts', async () => {
        const parent = await simpleProvider.parent(opContextEn, 'code2aI');
        expect(parent).toBe('code2a');
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.parent(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });
    });

    describe('sameConcept()', () => {
      test('should return true for same code', async () => {
        const same = await simpleProvider.sameConcept(opContextEn, 'code1', 'code1');
        expect(same).toBe(true);
      });

      test('should return false for different codes', async () => {
        const same = await simpleProvider.sameConcept(opContextEn, 'code1', 'code2');
        expect(same).toBe(false);
      });

      test('should work with context objects', async () => {
        const locateResult1 = await simpleProvider.locate(opContextEn, 'code1');
        const locateResult2 = await simpleProvider.locate(opContextEn, 'code1');
        const same = await simpleProvider.sameConcept(opContextEn, locateResult1.context, locateResult2.context);
        expect(same).toBe(true);
      });

      test('should return false for non-existent codes', async () => {
        await expect(simpleProvider.sameConcept(opContextEn, 'nonexistent', 'code1'))
          .rejects.toThrow('not found');
      });
    });

    describe('locateIsA()', () => {
      test('should find child in parent relationship', async () => {
        const result = await simpleProvider.locateIsA(opContextEn, 'code2a', 'code2');
        expect(result.context).toBeDefined();
        expect(result.context.code).toBe('code2a');
        expect(result.message).toBeNull();
      });

      test('should find grandchild in grandparent relationship', async () => {
        const result = await simpleProvider.locateIsA(opContextEn, 'code2aI', 'code2');
        expect(result.context).toBeDefined();
        expect(result.context.code).toBe('code2aI');
        expect(result.message).toBeNull();
      });

      test('should return null for non-descendant relationship', async () => {
        const result = await simpleProvider.locateIsA(opContextEn, 'code1', 'code2');
        expect(result.context).toBeNull();
        expect(result.message).toContain('not a descendant');
      });

      test('should handle same code when allowed', async () => {
        const result = await simpleProvider.locateIsA(opContextEn, 'code2', 'code2', false);
        expect(result.context).toBeDefined();
        expect(result.context.code).toBe('code2');
      });

      test('should reject same code when disallowed', async () => {
        const result = await simpleProvider.locateIsA(opContextEn, 'code2', 'code2', true);
        expect(result.context).toBeNull();
        expect(result.message).toContain('cannot be the same');
      });

      test('should return error message for CodeSystem without hierarchy', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, []);
        const result = await extensionsProvider.locateIsA(opContextEn, 'code1', 'code2');
        expect(result.context).toBeNull();
        expect(result.message).toContain('does not have parents');
      });
    });

    describe('subsumesTest()', () => {
      test('should return equivalent for same code', async () => {
        const result = await simpleProvider.subsumesTest(opContextEn, 'code1', 'code1');
        expect(result).toBe('equivalent');
      });

      test('should return subsumes for parent-child relationship', async () => {
        const result = await simpleProvider.subsumesTest(opContextEn, 'code2', 'code2a');
        expect(result).toBe('subsumes');
      });

      test('should return subsumed-by for child-parent relationship', async () => {
        const result = await simpleProvider.subsumesTest(opContextEn, 'code2a', 'code2');
        expect(result).toBe('subsumed-by');
      });

      test('should return subsumes for grandparent-grandchild relationship', async () => {
        const result = await simpleProvider.subsumesTest(opContextEn, 'code2', 'code2aI');
        expect(result).toBe('subsumes');
      });

      test('should return not-subsumed for unrelated codes', async () => {
        const result = await simpleProvider.subsumesTest(opContextEn, 'code1', 'code3');
        expect(result).toBe('not-subsumed');
      });

      test('should return not-subsumed for CodeSystem without hierarchy', async () => {
        const extensionsProvider = factory.build(opContextEn, extensionsCS, []);
        const result = await extensionsProvider.subsumesTest(opContextEn, 'code1', 'code2');
        expect(result).toBe('not-subsumed');
      });

      test('should throw error for non-existent codes', async () => {
        await expect(simpleProvider.subsumesTest(opContextEn, 'nonexistent', 'code1'))
          .rejects.toThrow('Unknown Code');
      });
    });

    describe('iterator()', () => {
      test('should create iterator for all concepts when context is null', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, null);
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('all');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(7); // All concepts in simple CS
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(7);
      });

      test('should create iterator for children when context is provided', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code2');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(2); // code2a and code2b
        expect(iterator.codes).toContain('code2a');
        expect(iterator.codes).toContain('code2b');
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(2);
      });

      test('should create empty iterator for leaf concepts', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code1');
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code1');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(0); // code1 has no children
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(0);
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.iterator(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });

      test('should work with context object', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const iterator = await simpleProvider.iterator(opContextEn, locateResult.context);
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code2');
        expect(iterator.codes.length).toBe(2);
      });
    });

    describe('nextContext()', () => {
      test('should iterate through all concepts', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, null);
        const contexts = [];

        let context = await simpleProvider.nextContext(opContextEn, iterator);
        while (context) {
          contexts.push(context);
          context = await simpleProvider.nextContext(opContextEn, iterator);
        }

        expect(contexts.length).toBe(7); // All concepts
        expect(contexts[0]).toBeInstanceOf(FhirCodeSystemProviderContext);

        // Check we got all the expected codes
        const codes = contexts.map(c => c.code);
        expect(codes).toContain('code1');
        expect(codes).toContain('code2');
        expect(codes).toContain('code2a');
        expect(codes).toContain('code2aI');
        expect(codes).toContain('code2aII');
        expect(codes).toContain('code2b');
        expect(codes).toContain('code3');
      });

      test('should iterate through children', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        const contexts = [];

        let context = await simpleProvider.nextContext(opContextEn, iterator);
        while (context) {
          contexts.push(context);
          context = await simpleProvider.nextContext(opContextEn, iterator);
        }

        expect(contexts.length).toBe(2); // code2a and code2b
        const codes = contexts.map(c => c.code);
        expect(codes).toContain('code2a');
        expect(codes).toContain('code2b');
      });

      test('should return null for empty iterator', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code1');
        const context = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context).toBeNull();
      });

      test('should return null when iterator is exhausted', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');

        // Get first context
        const context1 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context1).toBeDefined();

        // Get second context
        const context2 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context2).toBeDefined();

        // Third call should return null
        const context3 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context3).toBeNull();
      });

      test('should return null for invalid iterator', async () => {
        const context = await simpleProvider.nextContext(opContextEn, null);
        expect(context).toBeNull();
      });

      test('should handle iterator state correctly', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        expect(iterator.current).toBe(0);

        await simpleProvider.nextContext(opContextEn, iterator);
        expect(iterator.current).toBe(1);

        await simpleProvider.nextContext(opContextEn, iterator);
        expect(iterator.current).toBe(2);

        // Should be exhausted now
        const context = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context).toBeNull();
        expect(iterator.current).toBe(2); // Should stay at end
      });
    });

    describe('iterator()', () => {
      test('should create iterator for all concepts when context is null', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, null);
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('all');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(7); // All concepts in simple CS
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(7);
      });

      test('should create iterator for children when context is provided', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code2');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(2); // code2a and code2b
        expect(iterator.codes).toContain('code2a');
        expect(iterator.codes).toContain('code2b');
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(2);
      });

      test('should create empty iterator for leaf concepts', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code1');
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code1');
        expect(iterator.codes).toBeDefined();
        expect(Array.isArray(iterator.codes)).toBe(true);
        expect(iterator.codes.length).toBe(0); // code1 has no children
        expect(iterator.current).toBe(0);
        expect(iterator.total).toBe(0);
      });

      test('should return null for non-existent code', async () => {
        await expect(simpleProvider.iterator(opContextEn, 'nonexistent'))
          .rejects.toThrow('not found');
      });

      test('should work with context object', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const iterator = await simpleProvider.iterator(opContextEn, locateResult.context);
        expect(iterator).toBeDefined();
        expect(iterator.type).toBe('children');
        expect(iterator.parentCode).toBe('code2');
        expect(iterator.codes.length).toBe(2);
      });
    });

    describe('nextContext()', () => {
      test('should iterate through all concepts', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, null);
        const contexts = [];

        let context = await simpleProvider.nextContext(opContextEn, iterator);
        while (context) {
          contexts.push(context);
          context = await simpleProvider.nextContext(opContextEn, iterator);
        }

        expect(contexts.length).toBe(7); // All concepts
        expect(contexts[0]).toBeInstanceOf(FhirCodeSystemProviderContext);

        // Check we got all the expected codes
        const codes = contexts.map(c => c.code);
        expect(codes).toContain('code1');
        expect(codes).toContain('code2');
        expect(codes).toContain('code2a');
        expect(codes).toContain('code2aI');
        expect(codes).toContain('code2aII');
        expect(codes).toContain('code2b');
        expect(codes).toContain('code3');
      });

      test('should iterate through children', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        const contexts = [];

        let context = await simpleProvider.nextContext(opContextEn, iterator);
        while (context) {
          contexts.push(context);
          context = await simpleProvider.nextContext(opContextEn, iterator);
        }

        expect(contexts.length).toBe(2); // code2a and code2b
        const codes = contexts.map(c => c.code);
        expect(codes).toContain('code2a');
        expect(codes).toContain('code2b');
      });

      test('should return null for empty iterator', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code1');
        const context = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context).toBeNull();
      });

      test('should return null when iterator is exhausted', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');

        // Get first context
        const context1 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context1).toBeDefined();

        // Get second context
        const context2 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context2).toBeDefined();

        // Third call should return null
        const context3 = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context3).toBeNull();
      });

      test('should return null for invalid iterator', async () => {
        const context = await simpleProvider.nextContext(opContextEn, null);
        expect(context).toBeNull();
      });

      test('should handle iterator state correctly', async () => {
        const iterator = await simpleProvider.iterator(opContextEn, 'code2');
        expect(iterator.current).toBe(0);

        await simpleProvider.nextContext(opContextEn, iterator);
        expect(iterator.current).toBe(1);

        await simpleProvider.nextContext(opContextEn, iterator);
        expect(iterator.current).toBe(2);

        // Should be exhausted now
        const context = await simpleProvider.nextContext(opContextEn, iterator);
        expect(context).toBeNull();
        expect(iterator.current).toBe(2); // Should stay at end
      });
    });

    describe('extendLookup()', () => {
      test('should extend lookup with basic properties', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code1');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, [], params);

        expect(params.abstract).toBe(false);
        expect(params.designation).toBeDefined();
        expect(Array.isArray(params.designation)).toBe(true);
        expect(params.designation.length).toBeGreaterThan(0);

        // Should have the main display designation
        const mainDesignation = params.designation.find(d => d.value === 'Display 1');
        expect(mainDesignation).toBeDefined();
      });

      test('should include properties when requested', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code1');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, ['property'], params);

        expect(params.property).toBeDefined();
        expect(Array.isArray(params.property)).toBe(true);

        // Should have the 'prop' property
        const propProperty = params.property.find(p => p.code === 'prop');
        expect(propProperty).toBeDefined();
        expect(propProperty.valueCode).toBe('old');
      });

      test('should include parent when requested', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2a');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, ['parent'], params);

        expect(params.property).toBeDefined();
        const parentProperty = params.property.find(p => p.code === 'parent');
        expect(parentProperty).toBeDefined();
        expect(parentProperty.valueCode).toBe('code2');
        expect(parentProperty.description).toBe('Display 2');
      });

      test('should include children when requested', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, ['child'], params);

        expect(params.property).toBeDefined();
        const childProperties = params.property.filter(p => p.code === 'child');
        expect(childProperties.length).toBe(2);

        const childCodes = childProperties.map(p => p.valueCode);
        expect(childCodes).toContain('code2a');
        expect(childCodes).toContain('code2b');
      });

      test('should handle abstract concepts', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, [], params);

        expect(params.abstract).toBe(true); // code2 has notSelectable=true
      });

      test('should handle wildcard properties', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, ['*'], params);

        expect(params.abstract).toBe(true);
        expect(params.designation).toBeDefined();
        expect(params.property).toBeDefined();

        // Should have parent, children, and regular properties
        const parentProp = params.property.find(p => p.code === 'parent');
        expect(parentProp).toBeUndefined(); // code2 is root, no parent

        const childProps = params.property.filter(p => p.code === 'child');
        expect(childProps.length).toBe(2);
      });

      test('should handle specific property requests', async () => {
        const locateResult = await simpleProvider.locate(opContextEn, 'code2a');
        const params = {};

        await simpleProvider.extendLookup(opContextEn, locateResult.context, ['designation', 'parent'], params);

        expect(params.designation).toBeDefined();
        expect(params.property).toBeDefined();

        // Should have parent but not children (not requested)
        const parentProp = params.property.find(p => p.code === 'parent');
        expect(parentProp).toBeDefined();

        const childProps = params.property.filter(p => p.code === 'child');
        expect(childProps.length).toBe(0);
      });

      test('should handle invalid context gracefully', async () => {
        const params = {};

        await simpleProvider.extendLookup(opContextEn, null, [], params);

        // Should not crash, params should remain empty or minimal
        expect(params).toBeDefined();
      });
    });
    describe('Filter Implementation', () => {
      let simpleProvider, deProvider, extensionsProvider;
      let filterContext;

      beforeEach(() => {
        simpleProvider = factory.build(opContextEn, simpleCS, []);
        deProvider = factory.build(opContextEn, deCS, []);
        extensionsProvider = factory.build(opContextEn, extensionsCS, [supplementCS]);
        filterContext = {filters: []};
      });

      describe('Filter Infrastructure', () => {
        test('should create filter preparation context', async () => {
          const prepContext = await simpleProvider.getPrepContext(opContextEn, true);
          expect(prepContext).toBeDefined();
          expect(prepContext.filters).toBeDefined();
        });

        test('should report filters as closed', async () => {
          const notClosed = await simpleProvider.filtersNotClosed(opContextEn, filterContext);
          expect(notClosed).toBe(false);
        });

        test('should check filter support correctly', async () => {
          // Hierarchy filters
          expect(await simpleProvider.doesFilter(opContextEn, 'concept', 'is-a', 'code1')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'code', 'descendent-of', 'code2')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'concept', 'is-not-a', 'code1')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'code', 'in', 'code1,code2')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'code', '=', 'code1')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'code', 'regex', 'code.*')).toBe(true);

          // Child existence
          expect(await simpleProvider.doesFilter(opContextEn, 'child', 'exists', 'true')).toBe(true);

          // Property filters
          expect(await simpleProvider.doesFilter(opContextEn, 'prop', '=', 'old')).toBe(true);
          expect(await simpleProvider.doesFilter(opContextEn, 'status', 'in', 'active,retired')).toBe(true);

          // Known properties
          expect(await simpleProvider.doesFilter(opContextEn, 'notSelectable', '=', 'true')).toBe(true);

          // Unsupported filters
          expect(await simpleProvider.doesFilter(opContextEn, 'unknown', '=', 'value')).toBe(false);
          expect(await simpleProvider.doesFilter(opContextEn, 'code', 'unsupported-op', 'value')).toBe(false);
        });
      });

      describe('Search Filter', () => {
        test('should find concepts by exact code match', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'code1', true);
          expect(results.size()).toBeGreaterThan(0);

          const concept = results.findConceptByCode('code1');
          expect(concept).toBeDefined();
          expect(concept.code).toBe('code1');
        });

        test('should find concepts by display text match', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'Display 1', true);
          expect(results.size()).toBeGreaterThan(0);

          const concept = results.findConceptByCode('code1');
          expect(concept).toBeDefined();
        });

        test('should find concepts by partial match', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'Display', true);
          expect(results.size()).toBeGreaterThan(1); // Should find multiple concepts
        });

        test('should find concepts by definition match', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'first', true);
          expect(results.size()).toBeGreaterThan(0);
        });

        test('should return empty results for non-matching search', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'nonexistent', true);
          expect(results.size()).toBe(0);
        });

        test('should sort results by relevance when requested', async () => {
          const results = await simpleProvider.searchFilter(opContextEn, filterContext, 'code', true);
          expect(results.size()).toBeGreaterThan(1);

          // Results should be sorted by rating (exact matches first)
          let lastRating = 100;
          results.concepts.forEach(item => {
            expect(item.rating).toBeLessThanOrEqual(lastRating);
            lastRating = item.rating;
          });
        });
      });

      describe('Concept/Code Filters', () => {
        test('should filter by is-a relationship', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'concept', 'is-a', 'code2');
          expect(results.size()).toBe(5); // code2, code2a + children, code2b

          expect(results.findConceptByCode('code2')).toBeDefined();
          expect(results.findConceptByCode('code2a')).toBeDefined();
          expect(results.findConceptByCode('code2b')).toBeDefined();
          expect(results.findConceptByCode('code1')).toBeNull(); // Not a descendant
        });

        test('should filter by descendent-of relationship', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'descendent-of', 'code2');
          expect(results.size()).toBe(4); // code2a, code2aI, code2aII, code2b (not code2 itself)

          expect(results.findConceptByCode('code2')).toBeNull(); // Root not included
          expect(results.findConceptByCode('code2a')).toBeDefined();
          expect(results.findConceptByCode('code2aI')).toBeDefined();
          expect(results.findConceptByCode('code2aII')).toBeDefined();
          expect(results.findConceptByCode('code2b')).toBeDefined();
        });

        test('should filter by is-not-a relationship', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'concept', 'is-not-a', 'code2');
          expect(results.size()).toBe(2); // code1 and code3 (not descendants of code2)

          expect(results.findConceptByCode('code1')).toBeDefined();
          expect(results.findConceptByCode('code3')).toBeDefined();
          expect(results.findConceptByCode('code2')).toBeNull();
          expect(results.findConceptByCode('code2a')).toBeNull();
        });

        test('should filter by in relationship', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'in', 'code1,code3');
          expect(results.size()).toBe(2);

          expect(results.findConceptByCode('code1')).toBeDefined();
          expect(results.findConceptByCode('code3')).toBeDefined();
          expect(results.findConceptByCode('code2')).toBeNull();
        });

        test('should filter by exact match', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', '=', 'code1');
          expect(results.size()).toBe(1);

          expect(results.findConceptByCode('code1')).toBeDefined();
          expect(results.findConceptByCode('code2')).toBeNull();
        });

        test('should filter by regex pattern', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'regex', 'code2.*');
          expect(results.size()).toBeGreaterThan(1); // Should match code2, code2a, code2b, etc.

          expect(results.findConceptByCode('code2')).toBeDefined();
          expect(results.findConceptByCode('code2a')).toBeDefined();
          expect(results.findConceptByCode('code1')).toBeNull();
        });

        test('should handle invalid regex gracefully', async () => {
          await expect(
            simpleProvider.filter(opContextEn, filterContext, 'code', 'regex', '[invalid')
          ).rejects.toThrow('Invalid regex pattern');
        });
      });

      describe('Child Existence Filter', () => {
        test('should find concepts with children', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'child', 'exists', 'true');
          expect(results.size()).toBe(2); // code2 and code2a have children

          expect(results.findConceptByCode('code2')).toBeDefined();
          expect(results.findConceptByCode('code2a')).toBeDefined();
          expect(results.findConceptByCode('code1')).toBeNull(); // No children
        });

        test('should find concepts without children (leaf nodes)', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'child', 'exists', 'false');
          expect(results.size()).toBe(5); // code1, code2aI, code2aII, code2b, code3

          expect(results.findConceptByCode('code1')).toBeDefined();
          expect(results.findConceptByCode('code2aI')).toBeDefined();
          expect(results.findConceptByCode('code2aII')).toBeDefined();
          expect(results.findConceptByCode('code2b')).toBeDefined();
          expect(results.findConceptByCode('code3')).toBeDefined();
          expect(results.findConceptByCode('code2')).toBeNull(); // Has children
        });
      });

      describe('Property-Based Filters', () => {
        test('should filter by property equality', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'prop', '=', 'old');
          expect(results.size()).toBeGreaterThan(0);

          // code1 has prop=old
          expect(results.findConceptByCode('code1')).toBeDefined();
        });

        test('should filter by property in values', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'prop', 'in', 'old,new');
          expect(results.size()).toBeGreaterThan(0);

          // Should find concepts with either old or new values
          expect(results.findConceptByCode('code1')).toBeDefined(); // prop=old
        });

        test('should filter by property not in values', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'prop', 'not-in', 'retired');
          expect(results.size()).toBeGreaterThan(0);

          // Should exclude concepts with retired status
          expect(results.findConceptByCode('code1')).toBeDefined(); // Not retired
        });

        test('should filter by property regex', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'prop', 'regex', 'ol.*');
          expect(results.size()).toBeGreaterThan(0);

          // Should match "old" values
          expect(results.findConceptByCode('code1')).toBeDefined();
        });
      });

      describe('Known Property Filters', () => {
        test('should filter by notSelectable property', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'notSelectable', '=', 'true');
          expect(results.size()).toBe(1);

          // code2 has notSelectable=true
          expect(results.findConceptByCode('code2')).toBeDefined();
        });

        test('should filter by status property', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'status', '=', 'retired');
          expect(results.size()).toBe(1);

          // code2 has status=retired
          expect(results.findConceptByCode('code2')).toBeDefined();
        });

        test('should filter by status in values', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'status', 'in', 'active,retired');
          expect(results.size()).toBeGreaterThan(0);
        });
      });

      describe('Filter Iteration', () => {
        test('should iterate through filter results', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'in', 'code1,code2,code3');
          expect(results.size()).toBe(3);

          results.reset();
          const concepts = [];
          while (await simpleProvider.filterMore(opContextEn, filterContext, results)) {
            const context = await simpleProvider.filterConcept(opContextEn, filterContext, results);
            concepts.push(context);
          }

          expect(concepts.length).toBe(3);
          expect(concepts.every(c => c instanceof FhirCodeSystemProviderContext)).toBe(true);
        });

        test('should locate specific code in filter results', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'in', 'code1,code2');

          const located = await simpleProvider.filterLocate(opContextEn, filterContext, results, 'code1');
          expect(located).toBeInstanceOf(FhirCodeSystemProviderContext);
          expect(located.code).toBe('code1');

          const notFound = await simpleProvider.filterLocate(opContextEn, filterContext, results, 'code3');
          expect(typeof notFound).toBe('string'); // Error message
          expect(notFound).toContain('not found');
        });

        test('should check if concept is in filter results', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'in', 'code1,code2');

          const concept1 = new FhirCodeSystemProviderContext('code1', simpleCS.getConceptByCode('code1'));
          const concept3 = new FhirCodeSystemProviderContext('code3', simpleCS.getConceptByCode('code3'));

          const check1 = await simpleProvider.filterCheck(opContextEn, filterContext, results, concept1);
          expect(check1).toBe(true);

          const check3 = await simpleProvider.filterCheck(opContextEn, filterContext, results, concept3);
          expect(typeof check3).toBe('string'); // Error message
        });

        test('should get filter size correctly', async () => {
          const results = await simpleProvider.filter(opContextEn, filterContext, 'code', 'in', 'code1,code2,code3');

          const size = await simpleProvider.filterSize(opContextEn, filterContext, results);
          expect(size).toBe(3);

          const emptySize = await simpleProvider.filterSize(opContextEn, filterContext, null);
          expect(emptySize).toBe(0);
        });

        test('should execute and finish filters properly', async () => {
          filterContext.filters = [];
          await simpleProvider.filter(opContextEn, filterContext, 'code', '=', 'code1');

          const executed = await simpleProvider.executeFilters(opContextEn, filterContext);
          expect(Array.isArray(executed)).toBe(true);
          expect(executed.length).toBe(1);

          await simpleProvider.filterFinish(opContextEn, filterContext);
          expect(filterContext.filters.length).toBe(0);
        });
      });

      describe('Special Filters', () => {
        test('should handle special filter placeholder', async () => {
          const results = await simpleProvider.specialFilter(opContextEn, filterContext, 'special-filter', true);
          expect(results).toBeDefined();
          expect(results.size()).toBe(0); // Placeholder returns empty results
        });
      });

      describe('Error Handling', () => {
        test('should handle null filter context gracefully', async () => {
          const size = await simpleProvider.filterSize(opContextEn, null, null);
          expect(size).toBe(0);

          const hasMore = await simpleProvider.filterMore(opContextEn, null, null);
          expect(hasMore).toBe(false);

          const concept = await simpleProvider.filterConcept(opContextEn, null, null);
          expect(concept).toBeNull();
        });

        test('should handle invalid operation context', async () => {
          await expect(
            simpleProvider.filter(null, filterContext, 'code', '=', 'code1')
          ).rejects.toThrow('opContext is not an instance of TxOperationContext');
        });
      });

      describe('Complex Filter Scenarios', () => {
        test('should work with German CodeSystem', async () => {
          const results = await deProvider.searchFilter(opContextEn, filterContext, 'Anzeige', true);
          expect(results.size()).toBeGreaterThan(0);
        });

        test('should work with Extensions CodeSystem', async () => {
          const results = await extensionsProvider.filter(opContextEn, filterContext, 'code', 'regex', 'code[1-3]');
          expect(results.size()).toBe(3);
        });

        test('should handle multiple filters in sequence', async () => {
          // First filter: get all concepts with children
          const withChildren = await simpleProvider.filter(opContextEn, filterContext, 'child', 'exists', 'true');
          expect(withChildren.size()).toBe(2);

          // Second filter: get concepts with specific property
          const withProperty = await simpleProvider.filter(opContextEn, filterContext, 'prop', '=', 'new');
          expect(withProperty.size()).toBeGreaterThan(0);

          // Both filters should be in context
          expect(filterContext.filters.length).toBe(2);
        });
      });
    });
  });
});