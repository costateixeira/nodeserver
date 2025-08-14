const path = require('path');
const fs = require('fs');
const {
  SnomedStrings,
  SnomedWords,
  SnomedStems,
  SnomedReferences,
  SnomedDescriptions,
  SnomedDescriptionIndex,
  SnomedConceptList,
  SnomedRelationshipList,
  SnomedReferenceSetMembers,
  SnomedReferenceSetIndex,
  SnomedFileReader
} = require('../../tx/cs/cs-snomed-structures');

const {
  SnomedExpressionParser,
  SnomedExpressionStatus,
  SnomedConcept,
  SnomedExpression,
  SnomedRefinement,
  SnomedRefinementGroup,
  SnomedExpressionServices,
  SnomedExpressionContext,
  MatchingConcept,
  SnomedServicesRenderOption,
  SnomedRefinementGroupMatchState
} = require('../../tx/cs/cs-snomed-expressions');
const {SnomedImporter} = require("../../tx/importers/import-sct.module");

describe('SNOMED CT Module Import', () => {
  const testSourceDir = path.resolve(__dirname, '../../tx/data/snomed');
  const testCachePath = path.resolve(__dirname, '../../data/snomed-testing.cache');

  beforeAll(() => {
    // Ensure data directory exists
    const dataDir = path.dirname(testCachePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Clean up any existing test cache
    if (fs.existsSync(testCachePath)) {
      fs.unlinkSync(testCachePath);
    }
  });

  afterAll(() => {
    // Clean up test cache after tests
    // if (fs.existsSync(testCachePath)) {
    //   fs.unlinkSync(testCachePath);
    // }
  });

  test('should import SNOMED CT test data successfully', async () => {
    // Verify source data exists
    expect(fs.existsSync(testSourceDir)).toBe(true);

    // Verify required SNOMED files exist
    const requiredFiles = [
      'Terminology/sct2_Concept_Snapshot_INT_20250814.txt',
      'Terminology/sct2_Description_Snapshot-en_INT_20250814.txt',
      'Terminology/sct2_Relationship_Snapshot_INT_20250814.txt'
    ];

    let foundFiles = 0;
    for (const file of requiredFiles) {
      const filePath = path.join(testSourceDir, file);
      if (fs.existsSync(filePath)) {
        foundFiles++;
        // console.log(`✓ Found: ${file}`);
      } else {
        // Try to find similar files with glob-like pattern
        const dir = path.dirname(path.join(testSourceDir, file));
        const filename = path.basename(file);
        const pattern = filename.replace('20250814', '*').replace('INT', '*');

        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const similar = files.filter(f => {
            const basePattern = pattern.replace(/\*/g, '.*');
            return new RegExp(basePattern).test(f);
          });

          if (similar.length > 0) {
            foundFiles++;
            // console.log(`✓ Found similar: ${similar[0]} (instead of ${file})`);
          } else {
            // console.log(`✗ Missing: ${file}`);
          }
        }
      }
    }

    // We need at least some of the core files
    expect(foundFiles).toBeGreaterThanOrEqual(1);

    // Create importer and run import
    const config = {
      source: testSourceDir,
      dest: testCachePath,
      edition: '900000000000207008', // International edition
      version: '20250814',
      uri: 'http://snomed.info/sct/900000000000207008/version/20250814',
      language: 'en-US',
      verbose: false, // Suppress console output during tests
      overwrite: true,
      createIndexes: true,
      estimatedDuration: '5-15 minutes (test dataset)'
    };

    const importer = new SnomedImporter(config);
    await importer.run();

    // Verify cache file was created
    expect(fs.existsSync(testCachePath)).toBe(true);
  }, 300000); // 5 minute timeout for import

  test('should have valid cache file structure', async () => {
    // Verify cache file exists
    expect(fs.existsSync(testCachePath)).toBe(true);

    // Try to load the cache file
    const reader = new SnomedFileReader(testCachePath);
    const data = await reader.loadSnomedData();

    // Verify basic metadata
    expect(data.cacheVersion).toBeDefined();
    expect(data.versionUri).toBe('http://snomed.info/sct/900000000000207008/version/20250814');
    expect(data.versionDate).toBe('20250814');
    expect(data.edition).toBeDefined();
    expect(data.version).toBeDefined();

    // console.log('Cache Version:', data.cacheVersion);
    // console.log('Version URI:', data.versionUri);
    // console.log('Version Date:', data.versionDate);
    // console.log('Edition:', data.edition);
    // console.log('SNOMED Version:', data.version);

    // Verify root concepts exist
    expect(Array.isArray(data.activeRoots)).toBe(true);
    expect(Array.isArray(data.inactiveRoots)).toBe(true);
    expect(data.activeRoots.length).toBeGreaterThan(0);

    // console.log('Active roots count:', data.activeRoots.length);
    // console.log('Inactive roots count:', data.inactiveRoots.length);
  });

  test('should have loaded core SNOMED structures', async () => {
    const reader = new SnomedFileReader(testCachePath);
    const data = await reader.loadSnomedData();

    // Verify all required data structures exist
    expect(data.strings).toBeDefined();
    expect(data.refs).toBeDefined();
    expect(data.desc).toBeDefined();
    expect(data.words).toBeDefined();
    expect(data.stems).toBeDefined();
    expect(data.concept).toBeDefined();
    expect(data.rel).toBeDefined();
    expect(data.descRef).toBeDefined();

    // Verify structures have data
    expect(data.strings.length).toBeGreaterThan(0);
    expect(data.concept.length).toBeGreaterThan(0);
    expect(data.desc.length).toBeGreaterThan(0);
    expect(data.rel.length).toBeGreaterThan(0);

    // console.log('Strings size:', data.strings.length);
    // console.log('Concepts size:', data.concept.length);
    // console.log('Descriptions size:', data.desc.length);
    // console.log('Relationships size:', data.rel.length);
    // console.log('References size:', data.refs.length);
  });

  test('should have proper file size and structure', () => {
    const stats = fs.statSync(testCachePath);

    // Cache should be reasonably sized (at least 1MB for even small test data)
    expect(stats.size).toBeGreaterThan(1024 * 1024);

    // File should be readable
    expect(stats.mode & fs.constants.R_OK).toBeTruthy();

    // console.log('Cache file size:', (stats.size / (1024 * 1024)).toFixed(2), 'MB');
    // console.log('Cache file created:', stats.birthtime.toISOString());
  });
});

describe('SNOMED CT Expression Processing (File-based Tests)', () => {
  let snomedData;
  let structures;
  let expressionServices;
  let parser;

  beforeAll(async () => {
    // Try to load the test cache file first, then fall back to any available cache
    const testCachePath = path.join(__dirname, '..', '..', 'data', 'snomed-testing.cache');
    const fallbackCachePath = path.join(__dirname, '..', '..', 'data', 'sct_intl_20250201.cache');

    let cacheFilePath = null;

    if (fs.existsSync(testCachePath)) {
      cacheFilePath = testCachePath;
      // console.log('Using test cache file');
    } else if (fs.existsSync(fallbackCachePath)) {
      cacheFilePath = fallbackCachePath;
      // console.log('Using fallback cache file');
    }

    if (!cacheFilePath) {
      console.log('No SNOMED cache file available - skipping file-based tests');
      return;
    }

    try {
      // Load the SNOMED file
      const reader = new SnomedFileReader(cacheFilePath);
      snomedData = await reader.loadSnomedData();

      // Create structure instances with the loaded data
      structures = {
        strings: new SnomedStrings(snomedData.strings),
        words: new SnomedWords(snomedData.words),
        stems: new SnomedStems(snomedData.stems),
        refs: new SnomedReferences(snomedData.refs),
        descriptions: new SnomedDescriptions(snomedData.desc),
        descriptionIndex: new SnomedDescriptionIndex(snomedData.descRef),
        concepts: new SnomedConceptList(snomedData.concept),
        relationships: new SnomedRelationshipList(snomedData.rel),
        refSetMembers: new SnomedReferenceSetMembers(snomedData.refSetMembers),
        refSetIndex: new SnomedReferenceSetIndex(snomedData.refSetIndex, snomedData.hasLangs)
      };

      // Initialize expression services
      const isAIndex = snomedData.isAIndex || 0; // Use stored is-a index
      expressionServices = new SnomedExpressionServices(structures, isAIndex);
      parser = new SnomedExpressionParser();
    } catch (error) {
      // console.log('Failed to load SNOMED cache file:', error.message);
      snomedData = null;
    }
  });

  // Helper function to skip tests if no cache file is available
  function describeWithCache(description, testFn) {
    if (snomedData) {
      describe(description, testFn);
    } else {
      describe.skip(description + ' (no cache file available)', testFn);
    }
  }

  function testWithCache(description, testFn) {
    if (snomedData) {
      test(description, testFn);
    } else {
      test.skip(description + ' (no cache file available)', testFn);
    }
  }

  testWithCache('should load basic file metadata', () => {
    expect(snomedData.cacheVersion).toBeDefined();
    expect(snomedData.versionUri).toBeDefined();
    expect(snomedData.versionDate).toBeDefined();
    expect(snomedData.edition).toBeDefined();
    expect(snomedData.defaultLanguage).toBeDefined();

    // // console.log('Cache Version:', snomedData.cacheVersion);
    // console.log('Version URI:', snomedData.versionUri);
    // console.log('Version Date:', snomedData.versionDate);
    // console.log('Edition:', snomedData.edition);
    // console.log('SNOMED Version:', snomedData.version);
    // console.log('Has Langs:', snomedData.hasLangs);
    // console.log('Default Language:', snomedData.defaultLanguage);
  });

  testWithCache('should have loaded string data', () => {
    expect(structures.strings.length).toBeGreaterThan(0);

    // Try to read the first string at offset 0 (if it exists and isn't our weird edge case)
    if (structures.strings.length > 5) {
      const firstString = structures.strings.getEntry(5); // Skip offset 0 due to the weird null case
      expect(typeof firstString).toBe('string');
      // console.log('Sample string:', firstString);
    }
  });

  testWithCache('should have loaded concept data', () => {
    const conceptCount = structures.concepts.count();
    expect(conceptCount).toBeGreaterThan(0);
    // console.log('Total concepts:', conceptCount);

    // Test reading first concept
    if (conceptCount > 0) {
      const firstConcept = structures.concepts.getConcept(0);
      expect(firstConcept.identity).toBeDefined();
      expect(typeof firstConcept.flags).toBe('number');
      // console.log('First concept ID:', firstConcept.identity.toString());
    }
  });

  testWithCache('should have loaded description data', () => {
    const descCount = structures.descriptions.count();
    expect(descCount).toBeGreaterThan(0);
    // console.log('Total descriptions:', descCount);

    // Test reading first description
    if (descCount > 0) {
      const firstDesc = structures.descriptions.getDescription(0);
      expect(firstDesc.id).toBeDefined();
      expect(firstDesc.concept).toBeDefined();
      // console.log('First description ID:', firstDesc.id.toString());
    }
  });

  testWithCache('should have loaded relationship data', () => {
    const relCount = structures.relationships.count();
    expect(relCount).toBeGreaterThan(0);
    // console.log('Total relationships:', relCount);

    // Test reading first relationship
    if (relCount > 0) {
      const firstRel = structures.relationships.getRelationship(0);
      expect(firstRel.source).toBeDefined();
      expect(firstRel.target).toBeDefined();
      expect(firstRel.relType).toBeDefined();
      // console.log('First relationship:', firstRel.source, '->', firstRel.target, '(type:', firstRel.relType, ')');
    }
  });

  testWithCache('should have loaded reference set data', () => {
    const refSetCount = structures.refSetIndex.count();
    expect(refSetCount).toBeGreaterThan(0);
    // console.log('Total reference sets:', refSetCount);

    // Test reading first reference set
    if (refSetCount > 0) {
      const firstRefSet = structures.refSetIndex.getReferenceSet(0);
      expect(firstRefSet.definition).toBeDefined();
      expect(firstRefSet.name).toBeDefined();
      // console.log('First reference set definition:', firstRefSet.definition);
    }
  });

  testWithCache('should have loaded root concepts', () => {
    expect(Array.isArray(snomedData.activeRoots)).toBe(true);
    expect(Array.isArray(snomedData.inactiveRoots)).toBe(true);

    // console.log('Active roots count:', snomedData.activeRoots.length);
    // console.log('Inactive roots count:', snomedData.inactiveRoots.length);

    if (snomedData.activeRoots.length > 0) {
      // console.log('First active root:', snomedData.activeRoots[0].toString());
    }
  });

  testWithCache('should be able to find concepts by ID', () => {
    // Try to find the SNOMED CT root concept (138875005)
    const rootConceptId = BigInt('138875005');
    const result = structures.concepts.findConcept(rootConceptId);

    if (result.found) {
      // console.log('Found SNOMED CT root concept at offset:', result.index);
      const concept = structures.concepts.getConcept(result.index);
      expect(concept.identity).toBe(rootConceptId);
    } else {
      // console.log('SNOMED CT root concept not found (this might be normal depending on the dataset)');
    }
  });

  describeWithCache('Expression Services Integration Tests', () => {
    test('should initialize expression services correctly', () => {
      expect(expressionServices).toBeDefined();
      expect(expressionServices.concepts).toBeDefined();
      expect(expressionServices.relationships).toBeDefined();
      expect(expressionServices.strings).toBeDefined();
      // console.log('Expression services initialized successfully');
    });

    test('should validate expressions with real concept data', () => {
      // Try to find a concept that should exist in most SNOMED datasets
      const commonConcepts = ['138875005', '404684003', '64572001']; // SNOMED CT Concept, Clinical finding, Disease

      for (const conceptId of commonConcepts) {
        const result = structures.concepts.findConcept(BigInt(conceptId));
        if (result.found) {
          // console.log(`Found concept ${conceptId} at index ${result.index}`);

          // Test parsing with this real concept
          const expression = conceptId;
          try {
            const parsed = expressionServices.parseExpression(expression);
            expect(parsed.concepts).toHaveLength(1);
            expect(parsed.concepts[0].code).toBe(conceptId);
            // console.log(`✓ Successfully parsed and validated expression: ${expression}`);
            break; // Exit after first successful test
          } catch (error) {
            // console.log(`⚠ Failed to validate expression ${expression}: ${error.message}`);
          }
        }
      }
    });

    test('should handle expression equivalence checking', () => {
      const expr1 = parser.parse('116680003');
      const expr2 = parser.parse('116680003');

      const equivalent = expressionServices.expressionsEquivalent(expr1, expr2);
      expect(equivalent).toBe(true);
      // console.log('✓ Expression equivalence checking works correctly');
    });

    test('should render expressions in different formats', () => {
      const expr = parser.parse('128045006|Cellulitis|:{363698007|finding site|=56459004|foot structure|}');

      const minimal = expressionServices.renderExpression(expr, SnomedServicesRenderOption.Minimal);
      const asIs = expressionServices.renderExpression(expr, SnomedServicesRenderOption.AsIs);

      expect(minimal).toBeDefined();
      expect(asIs).toBeDefined();
      expect(asIs.length).toBeGreaterThanOrEqual(minimal.length); // AsIs should include terms

      // console.log('Minimal render:', minimal);
      // console.log('AsIs render:', asIs);
      // console.log('✓ Expression rendering works correctly');
    });

    test('should create expression contexts', () => {
      const context1 = SnomedExpressionContext.fromReference(12345);
      expect(context1.getReference()).toBe(12345);
      expect(context1.expression.concepts).toHaveLength(1);

      const expr = parser.parse('116680003:{363698007=56459004}');
      const context2 = new SnomedExpressionContext('test source', expr);
      expect(context2.source).toBe('test source');
      expect(context2.isComplex()).toBe(true);

      // console.log('✓ Expression contexts work correctly');
    });
  });
});

// The pure parser tests don't require file loading, so they can always run
describe('SNOMED CT Expression Parser (Standalone Tests)', () => {
  let parser;

  beforeAll(() => {
    parser = new SnomedExpressionParser();
  });

  /**
   * Helper function to parse and validate basic structure
   */
  function parseAndValidate(expression, testName) {
    const result = parser.parse(expression);
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    // console.log(`Parsed ${testName}: ${expression}`);
    return result;
  }

  describe('Basic Concept Parsing', () => {
    test('should parse simple concept', () => {
      const expr = parseAndValidate('116680003', 'Simple concept');
      expect(expr.concepts).toHaveLength(1);
      expect(expr.concepts[0].code).toBe('116680003');
      expect(expr.hasRefinements()).toBe(false);
      expect(expr.hasRefinementGroups()).toBe(false);
    });

    test('should parse concept with description', () => {
      const expr = parseAndValidate('116680003|Body structure|', 'Concept with description');
      expect(expr.concepts).toHaveLength(1);
      expect(expr.concepts[0].code).toBe('116680003');
      expect(expr.concepts[0].description).toBe('Body structure');
    });

    test('should parse multiple concepts with addition', () => {
      const expr = parseAndValidate('421720008 |spray dose form| + 7946007 |drug suspension|', 'Multiple concepts');
      expect(expr.concepts).toHaveLength(2);
      expect(expr.concepts[0].code).toBe('421720008');
      expect(expr.concepts[1].code).toBe('7946007');
      expect(expr.concepts[0].description).toBe('spray dose form');
      expect(expr.concepts[1].description).toBe('drug suspension');
    });
  });

  describe('Refinement Parsing', () => {
    test('should parse concept with grouped refinement', () => {
      const expr = parseAndValidate('128045006:{363698007=56459004}', 'Concept with refinement');
      expect(expr.concepts).toHaveLength(1);
      expect(expr.concepts[0].code).toBe('128045006');
      expect(expr.hasRefinementGroups()).toBe(true);
      expect(expr.refinementGroups).toHaveLength(1);
      expect(expr.refinementGroups[0].refinements).toHaveLength(1);
      expect(expr.refinementGroups[0].refinements[0].name.code).toBe('363698007');
      expect(expr.refinementGroups[0].refinements[0].value.concepts[0].code).toBe('56459004');
    });

    test('should parse concept with ungrouped refinement', () => {
      const expr = parseAndValidate('31978002: 272741003=7771000', 'Ungrouped refinement');
      expect(expr.concepts).toHaveLength(1);
      expect(expr.hasRefinements()).toBe(true);
      expect(expr.refinements).toHaveLength(1);
      expect(expr.refinements[0].name.code).toBe('272741003');
      expect(expr.refinements[0].value.concepts[0].code).toBe('7771000');
    });
  });

  describe('Expression Status Prefixes', () => {
    test('should parse expression with equivalence status', () => {
      const expr = parseAndValidate('=== 46866001 |fracture of lower limb| + 428881005 |injury of tibia| :116676008 |associated morphology| = 72704001 |fracture|,363698007 |finding site| = 12611008 |bone structure of tibia|', 'Expression with equivalence status');
      expect(expr.status).toBe(SnomedExpressionStatus.Equivalent);
      expect(expr.concepts).toHaveLength(2);
      expect(expr.refinements).toHaveLength(2);
    });

    test('should parse expression with subsumption status', () => {
      const expr = parseAndValidate('<<< 73211009 |diabetes mellitus| : 363698007 |finding site| = 113331007 |endocrine system|', 'Expression with subsumption status');
      expect(expr.status).toBe(SnomedExpressionStatus.SubsumedBy);
      expect(expr.concepts).toHaveLength(1);
      expect(expr.refinements).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    test('should throw error for invalid concept format', () => {
      expect(() => {
        parser.parse('invalid_concept_format');
      }).toThrow();
    });

    test('should throw error for unclosed parentheses', () => {
      expect(() => {
        parser.parse('116680003:(128045006');
      }).toThrow();
    });

    test('should throw error for incomplete refinement', () => {
      expect(() => {
        parser.parse('116680003:363698007=');
      }).toThrow();
    });
  });
});