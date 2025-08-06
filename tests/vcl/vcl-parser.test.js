const {
  parseVCL,
  parseVCLAndSetId,
  validateVCLExpression,
  createVCLValueSet,
  VCLParseException,
  TokenType,
  FilterOperator
} = require('../../vcl/vcl-parser');

/**
 * Comprehensive test suite for VCL (ValueSet Composition Language) Parser
 * Migrated from Java tests to JavaScript/Jest
 */
describe('VCL Parser', () => {
  
  test('Simple codes with disjunction', () => {
    const vs = parseVCL('(subscriber;provider)');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.concept.length).toBe(2);
    expect(include.concept[0].code).toBe('subscriber');
    expect(include.concept[1].code).toBe('provider');
  });

  test('Multiple systems with multiple codes', () => {
    const vcl = '(http://loinc.org)(41995-2;4548-4;4549-2;17855-8;17856-6;62388-4;71875-9;59261-8;86910-7);' +
      '(http://snomed.info/sct)(365845005;165679005;165680008;65681007;451061000124104;451051000124101);' +
      '(http://www.ama-assn.org/go/cpt)(83036;83037;3044F;3046F)';

    const vs = parseVCL(vcl);

    expect(vs.compose.include.length).toBe(3);

    // Check LOINC system
    const loincInclude = vs.compose.include[0];
    expect(loincInclude.system).toBe('http://loinc.org');
    expect(loincInclude.concept.length).toBe(9);
    expect(loincInclude.concept[0].code).toBe('41995-2');

    // Check SNOMED system
    const snomedInclude = vs.compose.include[1];
    expect(snomedInclude.system).toBe('http://snomed.info/sct');
    expect(snomedInclude.concept.length).toBe(6);

    // Check CPT system
    const cptInclude = vs.compose.include[2];
    expect(cptInclude.system).toBe('http://www.ama-assn.org/go/cpt');
    expect(cptInclude.concept.length).toBe(4);
  });

  test('Complex expression with filters and exclusion', () => {
    const vcl = '((http://snomed.info/sct)concept<<17311000168105;' +
      '(http://snomed.info/sct)(61796011000036105;923929011000036103);' +
      '(http://loinc.org)ancestor=LP185676-6)-((http://loinc.org)76573-5)';

    const vs = parseVCL(vcl);

    expect(vs.compose.include.length).toBe(3);
    expect(vs.compose.exclude.length).toBe(1);

    // Check exclusion
    const exclude = vs.compose.exclude[0];
    expect(exclude.system).toBe('http://loinc.org');
    expect(exclude.concept.length).toBe(1);
    expect(exclude.concept[0].code).toBe('76573-5');
  });

  test('Different systems with disjunction', () => {
    const vs = parseVCL('(http://hl7.org/fhir/paymentstatus)paid;(http://hl7.org/fhir/payeetype)provider');

    expect(vs.compose.include.length).toBe(2);

    const include1 = vs.compose.include[0];
    expect(include1.system).toBe('http://hl7.org/fhir/paymentstatus');
    expect(include1.concept[0].code).toBe('paid');

    const include2 = vs.compose.include[1];
    expect(include2.system).toBe('http://hl7.org/fhir/payeetype');
    expect(include2.concept[0].code).toBe('provider');
  });

  test('Include valueset', () => {
    const vs = parseVCL('^(http://hl7.org/fhir/ValueSet/payeetype)');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.valueSet.length).toBe(1);
    expect(include.valueSet[0]).toBe('http://hl7.org/fhir/ValueSet/payeetype');
  });

  test('Filter without system', () => {
    const vs = parseVCL('ancestor=LP185676-6');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('ancestor');
    expect(filter.op).toBe(FilterOperator.EQUAL);
    expect(filter.value).toBe('LP185676-6');
  });

  test('Regex filter', () => {
    const vs = parseVCL('COMPONENT/".*Dichloroethane.*"');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('COMPONENT');
    expect(filter.op).toBe(FilterOperator.REGEX);
    expect(filter.value).toBe('.*Dichloroethane.*');
  });

  test('Simple equality filter', () => {
    const vs = parseVCL('COMPONENT=LP15653-6');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('COMPONENT');
    expect(filter.op).toBe(FilterOperator.EQUAL);
    expect(filter.value).toBe('LP15653-6');
  });

  test('Simple codes in parentheses with disjunction', () => {
    const vs = parseVCL('(10007-3;10008-1)');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.concept.length).toBe(2);
    expect(include.concept[0].code).toBe('10007-3');
    expect(include.concept[1].code).toBe('10008-1');
  });

  test('Descendant-of filter', () => {
    const vs = parseVCL('concept<<17311000168105');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('concept');
    expect(filter.op).toBe(FilterOperator.IS_A);
    expect(filter.value).toBe('17311000168105');
  });

  test('IS-A filter', () => {
    const vs = parseVCL('concept<<17311000168105');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('concept');
    expect(filter.op).toBe(FilterOperator.IS_A);
    expect(filter.value).toBe('17311000168105');
  });

  test('IS-NOT-A filter', () => {
    const vs = parseVCL('concept~<<929360061000036106');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('concept');
    expect(filter.op).toBe(FilterOperator.IS_NOT_A);
    expect(filter.value).toBe('929360061000036106');
  });

  test('Simple single code', () => {
    const vs = parseVCL('A');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.concept.length).toBe(1);
    expect(include.concept[0].code).toBe('A');
  });

  test('Conjunction with comma', () => {
    const vs = parseVCL('A,B');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.concept.length).toBe(2);
    expect(include.concept[0].code).toBe('A');
    expect(include.concept[1].code).toBe('B');
  });

  test('Disjunction with semicolon', () => {
    const vs = parseVCL('A;B');

    expect(vs.compose.include.length).toBe(2);
    expect(vs.compose.include[0].concept[0].code).toBe('A');
    expect(vs.compose.include[1].concept[0].code).toBe('B');
  });

  test('Wildcard with system', () => {
    const vs = parseVCL('(http://snomed.info/sct)*');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.system).toBe('http://snomed.info/sct');
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('concept');
    expect(filter.op).toBe(FilterOperator.EXISTS);
    expect(filter.value).toBe('true');
  });

  test('Multiple status codes', () => {
    const vs = parseVCL('(in-progress;aborted;completed;entered-in-error)');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.concept.length).toBe(4);
    expect(include.concept[0].code).toBe('in-progress');
    expect(include.concept[1].code).toBe('aborted');
    expect(include.concept[2].code).toBe('completed');
    expect(include.concept[3].code).toBe('entered-in-error');
  });

  test('Include and exclude same valueset', () => {
    const vs = parseVCL('(^(http://csiro.au/fhir/ValueSet/selfexclude))-(^(http://csiro.au/fhir/ValueSet/selfexclude))');

    expect(vs.compose.include.length).toBe(1);
    expect(vs.compose.exclude.length).toBe(1);

    expect(vs.compose.include[0].valueSet[0]).toBe('http://csiro.au/fhir/ValueSet/selfexclude');
    expect(vs.compose.exclude[0].valueSet[0]).toBe('http://csiro.au/fhir/ValueSet/selfexclude');
  });

  test('Include one valueset, exclude another', () => {
    const vs = parseVCL('(^(http://csiro.au/fhir/ValueSet/selfimport))-(^(http://csiro.au/fhir/ValueSet/selfexcludeA))');

    expect(vs.compose.include.length).toBe(1);
    expect(vs.compose.exclude.length).toBe(1);

    expect(vs.compose.include[0].valueSet[0]).toBe('http://csiro.au/fhir/ValueSet/selfimport');
    expect(vs.compose.exclude[0].valueSet[0]).toBe('http://csiro.au/fhir/ValueSet/selfexcludeA');
  });

  test('Descendant-of with quoted value', () => {
    const vs = parseVCL('concept<<"_ActNoImmunizationReason"');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('concept');
    expect(filter.op).toBe(FilterOperator.IS_A);
    expect(filter.value).toBe('_ActNoImmunizationReason');
  });

  test('Equality filter with numeric code', () => {
    const vs = parseVCL('has_ingredient = 1886');

    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(1);

    const filter = include.filter[0];
    expect(filter.property).toBe('has_ingredient');
    expect(filter.op).toBe(FilterOperator.EQUAL);
    expect(filter.value).toBe('1886');
  });

  // Tests for cases that may not be fully supported yet
  test('Complex filter with constraint', () => {
    const vs = parseVCL('(constraint="<< 30506011000036107 |australian product|: 700000101000036108 |hasTP| = 17311000168105 |PANADOL|",expression="<< 30506011000036107 |australian product|: 700000101000036108 |hasTP| = 17311000168105 |PANADOL|")');
    expect(vs).not.toBeNull();
    expect(vs.compose.include.length).toBe(1);
  });

  test('Nested filters should throw exception', () => {
    expect(() => {
      parseVCL('has_ingredient^(has_tradename=2201670)');
    }).toThrow(VCLParseException);
  });

  test('Multiple filters with commas', () => {
    const vs = parseVCL('(has_ingredient=1886, has_dose_form=317541)');
    expect(vs).not.toBeNull();
    expect(vs.compose.include.length).toBe(1);
    const include = vs.compose.include[0];
    expect(include.filter.length).toBe(2); // Should have 2 filters

    // Check the filters
    expect(include.filter[0].property).toBe('has_ingredient');
    expect(include.filter[0].value).toBe('1886');
    expect(include.filter[1].property).toBe('has_dose_form');
    expect(include.filter[1].value).toBe('317541');
  });

  // Simple code parsing tests
  describe('Simple code parsing', () => {
    const testCases = [
      'A',
      '123456',
      'test-code',
      '"quoted code"',
      '*'
    ];

    testCases.forEach(code => {
      test(`Parses code: ${code}`, () => {
        const vs = parseVCL(code);
        expect(vs).not.toBeNull();
        expect(vs.compose.include.length).toBe(1);

        if (code !== '*') {
          const include = vs.compose.include[0];
          if (include.concept.length > 0) {
            const expectedCode = code.startsWith('"') && code.endsWith('"')
              ? code.substring(1, code.length - 1)
              : code;
            expect(include.concept[0].code).toBe(expectedCode);
          }
        }
      });
    });
  });

  // ValueSet includes tests
  describe('ValueSet includes', () => {
    const testCases = [
      '^(http://hl7.org/fhir/ValueSet/test1)',
      '^(http://hl7.org/fhir/ValueSet/test2)',
      '^(http://example.org/valueset)'
    ];

    testCases.forEach(vcl => {
      test(`Parses ValueSet include: ${vcl}`, () => {
        const vs = parseVCL(vcl);
        expect(vs).not.toBeNull();
        expect(vs.compose.include.length).toBe(1);
        expect(vs.compose.include[0].valueSet.length).toBe(1);
      });
    });
  });

  // Error cases
  describe('Error cases', () => {
    test('Empty expression should fail', () => {
      expect(() => parseVCL('')).toThrow(VCLParseException);
      expect(() => parseVCL('   ')).toThrow(VCLParseException);
      expect(() => parseVCL(null)).toThrow(VCLParseException);
    });

    test('Invalid syntax should fail', () => {
      expect(() => parseVCL('((unclosed')).toThrow(VCLParseException);
      expect(() => parseVCL('A B C')).toThrow(VCLParseException); // No operators between codes
      expect(() => parseVCL('=value')).toThrow(VCLParseException); // Filter without property
    });
  });

  // Additional tests for JS-specific functionality
  describe('JavaScript-specific functionality', () => {
    test('parseVCLAndSetId should generate a URL', () => {
      const vs = parseVCLAndSetId('(http://snomed.info/sct)123456789');
      expect(vs.url).toBeDefined();
      expect(vs.url).toMatch(/^cid:\d+$/);
    });

    test('validateVCLExpression should return boolean', () => {
      expect(validateVCLExpression('A')).toBe(true);
      expect(validateVCLExpression('((unclosed')).toBe(false);
      expect(validateVCLExpression('')).toBe(false);
    });

    test('createVCLValueSet should create a basic value set', () => {
      const vs = createVCLValueSet('test-id', 'Test Name', 'Test Description');
      expect(vs.resourceType).toBe('ValueSet');
      expect(vs.id).toBe('test-id');
      expect(vs.name).toBe('Test Name');
      expect(vs.description).toBe('Test Description');
      expect(vs.status).toBe('draft');
      expect(vs.experimental).toBe(true);
      expect(vs.compose.include).toEqual([]);
      expect(vs.compose.exclude).toEqual([]);
    });

    test('splitSystemUri should handle system with version', () => {
      const result = require('../../vcl/vcl-parser').splitSystemUri('http://snomed.info/sct|20210131');
      expect(result.system).toBe('http://snomed.info/sct');
      expect(result.version).toBe('20210131');
    });

    test('splitSystemUri should handle system without version', () => {
      const result = require('../../vcl/vcl-parser').splitSystemUri('http://snomed.info/sct');
      expect(result.system).toBe('http://snomed.info/sct');
      expect(result.version).toBe('');
    });

    test('isVCLCompatible should validate value set structure', () => {
      const compatible = {
        compose: {
          include: [{ 
            system: 'http://loinc.org',
            filter: [{ property: 'code', op: FilterOperator.EQUAL, value: 'LP12345-6' }]
          }]
        }
      };
      
      const incompatible = {
        compose: {
          include: [{ 
            system: 'http://loinc.org',
            filter: [{ property: 'code', op: 'unsupported-op', value: 'LP12345-6' }]
          }]
        }
      };
      
      const noCompose = { id: 'test' };
      
      expect(require('../../vcl/vcl-parser').isVCLCompatible(compatible)).toBe(true);
      expect(require('../../vcl/vcl-parser').isVCLCompatible(incompatible)).toBe(false);
      expect(require('../../vcl/vcl-parser').isVCLCompatible(noCompose)).toBe(false);
    });
  });

  // Tests for lexer and parser classes directly (for debugging)
  describe('Lexer and Parser classes', () => {
    test('VCLLexer should tokenize input correctly', () => {
      const { VCLLexer } = require('../../vcl/vcl-parser');
      const lexer = new VCLLexer('A,B;C-(D)');
      const tokens = lexer.tokenize();
      
      // Check first few tokens (skipping complete validation)
      expect(tokens[0].type).toBe(TokenType.SCODE);
      expect(tokens[0].value).toBe('A');
      expect(tokens[1].type).toBe(TokenType.COMMA);
      expect(tokens[2].type).toBe(TokenType.SCODE);
      expect(tokens[2].value).toBe('B');
      expect(tokens[3].type).toBe(TokenType.SEMI);
      // Final token should be EOF
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
    });

    test('VCLParserClass should handle simple expressions', () => {
      const { VCLLexer, VCLParserClass } = require('../../vcl/vcl-parser');
      const lexer = new VCLLexer('A,B');
      const tokens = lexer.tokenize();
      const parser = new VCLParserClass(tokens);
      const vs = parser.parse();
      
      expect(vs.compose.include.length).toBe(1);
      expect(vs.compose.include[0].concept.length).toBe(2);
      expect(vs.compose.include[0].concept[0].code).toBe('A');
      expect(vs.compose.include[0].concept[1].code).toBe('B');
    });
  });
});
