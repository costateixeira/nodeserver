const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const { CodeSystem } = require('../library/codesystem');
const { CodeSystemProvider, Designation, FilterExecutionContext, CodeSystemFactoryProvider } = require('./cs-api');
const {validateOptionalParameter} = require("../../library/utilities");

class OMOPConcept {
  constructor(code, display, domain, conceptClass, standard, vocabulary) {
    this.code = code;
    this.display = display;
    this.domain = domain;
    this.conceptClass = conceptClass;
    this.standard = standard || 'NS';
    this.vocabulary = vocabulary;
  }
}

class OMOPFilter extends FilterExecutionContext {
  constructor(db, sql, prepared = false) {
    super();
    this.db = db;
    this.sql = sql;
    this.prepared = prepared;
    this.rows = [];
    this.cursor = 0;
    this.executed = false;
  }

  async execute(params = []) {
    if (this.executed) return;

    return new Promise((resolve, reject) => {
      const callback = (err, rows) => {
        if (err) {
          reject(err);
        } else {
          this.rows = rows || [];
          this.executed = true;
          resolve();
        }
      };

      if (params.length > 0) {
        this.db.all(this.sql, params, callback);
      } else {
        this.db.all(this.sql, callback);
      }
    });
  }

  async executeForLocate(code) {
    return new Promise((resolve, reject) => {
      this.db.get(this.sql, [code], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  close() {
    // Database connection is managed by the provider
  }
}

class OMOPPrep extends FilterExecutionContext {
  constructor() {
    super();
  }
}

// Vocabulary mapping functions
function getVocabId(url) {
  const mapping = {
    'http://hl7.org/fhir/sid/icd-9-cm': 5046,
    'http://snomed.info/sct': 44819097,
    'http://hl7.org/fhir/sid/icd-10-cm': 44819098,
    'http://hl7.org/fhir/sid/icd-9-proc': 44819099,
    'http://www.ama-assn.org/go/cpt': 44819100,
    'http://terminology.hl7.org/CodeSystem/HCPCS-all-codes': 44819101,
    'http://loinc.org': 44819102,
    'http://www.nlm.nih.gov/research/umls/rxnorm': 44819104,
    'http://hl7.org/fhir/sid/ndc': 44819105,
    'http://unitsofmeasure.org': 44819107,
    'http://nucc.org/provider-taxonomy': 44819137,
    'http://www.whocc.no/atc': 44819117
  };
  return mapping[url] || -1;
}

function getUri(key) {
  const mapping = {
    5046: 'http://hl7.org/fhir/sid/icd-9-cm',
    44819097: 'http://snomed.info/sct',
    44819098: 'http://hl7.org/fhir/sid/icd-10-cm',
    44819099: 'http://hl7.org/fhir/sid/icd-9-proc',
    44819100: 'http://www.ama-assn.org/go/cpt',
    44819101: 'http://terminology.hl7.org/CodeSystem/HCPCS-all-codes',
    44819102: 'http://loinc.org',
    44819104: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    44819105: 'http://hl7.org/fhir/sid/ndc',
    44819107: 'http://unitsofmeasure.org',
    44819117: 'http://www.whocc.no/atc',
    44819137: 'http://nucc.org/provider-taxonomy'
  };
  return mapping[key] || '';
}

function getUriOrError(key) {
  const uri = getUri(key);
  if (!uri) {
    throw new Error(`Unmapped OMOP Vocabulary id: ${key}`);
  }
  return uri;
}

function getLang(langConcept) {
  if (langConcept === 'English language') return 'en';
  if (langConcept === 'Spanish language') return 'es';
  return 'en'; // default
}

class OMOPServices extends CodeSystemProvider {
  constructor(opContext, supplements, db, sharedData) {
    super(opContext, supplements);
    this.db = db;
    this._version = sharedData._version;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Metadata methods
  system() {
    return 'https://fhir-terminology.ohdsi.org';
  }

  version() {
    return this._version;
  }

  description() {
    return `OMOP Concepts, release ${this._version}`;
  }

  async totalCount() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM Concepts', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  // Core concept methods
  async code(context) {
    
    const ctxt = await this.#ensureContext(context);
    return ctxt ? ctxt.code : null;
  }

  async display(context) {
    
    const ctxt = await this.#ensureContext(context);

    if (!ctxt) {
      return null;
    }

    // Check supplements first
    let disp = this._displayFromSupplements(ctxt.code);
    if (disp) {
      return disp;
    }

    return ctxt.display || '';
  }

  async definition(context) {
    await this.#ensureContext(context);
    return ''; // OMOP doesn't provide definitions
  }

  async isAbstract(context) {
    await this.#ensureContext(context);
    return false; // OMOP concepts are not abstract
  }

  async isInactive(context) {
    await this.#ensureContext(context);
    return false; // Handle via standard_concept if needed
  }

  async isDeprecated(context) {
    await this.#ensureContext(context);
    return false; // Handle via invalid_reason if needed
  }

  async designations(context) {
    
    const ctxt = await this.#ensureContext(context);
    let designations = [];

    if (ctxt) {
      // Add main display
      designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), ctxt.display));

      // Add synonyms
      const synonyms = await this.#getSynonyms(ctxt.code);
      for (const synonym of synonyms) {
        designations.push(new Designation(synonym.language, null, synonym.value));
      }

      // Add supplement designations
      designations.push(...this._listSupplementDesignations(ctxt.code));
    }

    return designations;
  }

  async #getSynonyms(code) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT concept_synonym_name, concept_name
          FROM ConceptSynonyms, Concepts
          WHERE ConceptSynonyms.language_concept_id = Concepts.concept_id
            AND ConceptSynonyms.concept_id = ?
      `;

      this.db.all(sql, [code], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const synonyms = rows.map(row => ({
            language: getLang(row.concept_name),
            value: row.concept_synonym_name
          }));
          resolve(synonyms);
        }
      });
    });
  }

  async extendLookup(ctxt, props, params) {
    

    if (typeof ctxt === 'string') {
      const located = await this.locate(ctxt);
      if (!located.context) {
        throw new Error(located.message);
      }
      ctxt = located.context;
    }

    if (!(ctxt instanceof OMOPConcept)) {
      throw new Error('Invalid context for OMOP lookup');
    }

    // Add basic properties
    if (this.#hasProp(props, 'domain-id', true)) {
      this.#addProperty(params, 'property', 'domain-id', ctxt.domain);
    }
    if (this.#hasProp(props, 'concept-class-id', true)) {
      this.#addProperty(params, 'property', 'concept-class-id', ctxt.conceptClass);
    }
    if (this.#hasProp(props, 'standard-concept', true)) {
      this.#addProperty(params, 'property', 'standard-concept', ctxt.standard);
    }
    if (this.#hasProp(props, 'vocabulary-id', true)) {
      this.#addProperty(params, 'property', 'vocabulary-id', ctxt.vocabulary);
    }

    // Add synonyms as designations
    const synonyms = await this.#getSynonyms(ctxt.code);
    for (const synonym of synonyms) {
      this.#addProperty(params, 'designation', 'synonym', synonym.value, synonym.language);
    }

    // Add extended properties from database
    await this.#addExtendedProperties(ctxt, props, params);

    // Add relationships
    await this.#addRelationships(ctxt, props, params);
  }

  async #addExtendedProperties(ctxt, props, params) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM Concepts WHERE concept_id = ?';

      this.db.get(sql, [ctxt.code], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          if (this.#hasProp(props, 'concept-class-concept-id', true)) {
            this.#addProperty(params, 'property', 'concept-class-concept-id', row.concept_class_id);
          }
          if (this.#hasProp(props, 'domain-concept-id', true)) {
            this.#addProperty(params, 'property', 'domain-concept-id', row.domain_id);
          }
          if (this.#hasProp(props, 'valid-start-date', true) && row.valid_start_date) {
            this.#addProperty(params, 'property', 'valid-start-date', row.valid_start_date);
          }
          if (this.#hasProp(props, 'valid-end-date', true) && row.valid_end_date) {
            this.#addProperty(params, 'property', 'valid-end-date', row.valid_end_date);
          }
          if (this.#hasProp(props, 'source-concept-code', true) && row.concept_code && getUri(row.vocabulary_id)) {
            this.#addProperty(params, 'property', 'source-concept-code', `${getUriOrError(row.vocabulary_id)}|${row.concept_code}`);
          }
          if (this.#hasProp(props, 'vocabulary-concept-id', true)) {
            this.#addProperty(params, 'property', 'vocabulary-concept-id', row.vocabulary_id);
          }
          if (this.#hasProp(props, 'invalid-reason', true) && row.invalid_reason) {
            this.#addProperty(params, 'property', 'invalid-reason', row.invalid_reason);
          }
          resolve();
        } else {
          resolve();
        }
      });
    });
  }

  async #addRelationships(ctxt, props, params) {
    const seenConcepts = new Set();

    // Forward relationships
    await new Promise((resolve, reject) => {
      const sql = `
          SELECT Concepts.concept_id, Concepts.concept_name, Relationships.relationship_id
          FROM Concepts, ConceptRelationships, Relationships
          WHERE ConceptRelationships.relationship_id = Relationships.relationship_concept_id
            AND ConceptRelationships.concept_id_2 = Concepts.concept_id
            AND ConceptRelationships.concept_id_1 = ?
      `;

      this.db.all(sql, [ctxt.code], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            seenConcepts.add(row.concept_id);
            if (this.#hasProp(props, row.relationship_id, true)) {
              this.#addProperty(params, 'property', row.relationship_id,
                `${this.system()}|${row.concept_id}|${row.concept_name}`);
            }
          }
          resolve();
        }
      });
    });

    // Reverse relationships
    await new Promise((resolve, reject) => {
      const sql = `
          SELECT Concepts.concept_id, Concepts.concept_name, Relationships.reverse_relationship_id
          FROM Concepts, ConceptRelationships, Relationships
          WHERE ConceptRelationships.relationship_id = Relationships.relationship_concept_id
            AND ConceptRelationships.concept_id_1 = Concepts.concept_id
            AND ConceptRelationships.concept_id_2 = ?
      `;

      this.db.all(sql, [ctxt.code], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            if (!seenConcepts.has(row.concept_id)) {
              if (this.#hasProp(props, row.reverse_relationship_id, true)) {
                this.#addProperty(params, 'property', row.reverse_relationship_id,
                  `${this.system()}|${row.concept_id}|${row.concept_name}`);
              }
            }
          }
          resolve();
        }
      });
    });
  }

  #addProperty(params, type, name, value, language = null) {
    if (!params.parameter) {
      params.parameter = [];
    }

    const property = {
      name: type,
      part: [
        { name: 'code', valueCode: name },
        { name: 'value', valueString: String(value) } // Ensure value is always a string
      ]
    };

    if (language) {
      property.part.push({ name: 'language', valueCode: language });
    }

    params.parameter.push(property);
  }

  #hasProp(props, name, defaultValue) {
    if (!props || props.length === 0) return defaultValue;
    return props.includes(name);
  }

  async #ensureContext(context) {
    if (context == null) {
      return null;
    }
    if (typeof context === 'string') {
      const ctxt = await this.locate(context);
      if (ctxt.context == null) {
        throw new Error(ctxt.message);
      } else {
        return ctxt.context;
      }
    }
    if (context instanceof OMOPConcept) {
      return context;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof context));
  }

  // Lookup methods
  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    return new Promise((resolve, reject) => {
      const sql = `
          SELECT concept_id, concept_name, standard_concept,
                 Domains.domain_id, ConceptClasses.concept_class_id,
                 Vocabularies.vocabulary_id
          FROM Concepts, Domains, ConceptClasses, Vocabularies
          WHERE Concepts.domain_id = Domains.domain_concept_id
            AND ConceptClasses.concept_class_concept_id = Concepts.concept_class_id
            AND Concepts.vocabulary_id = Vocabularies.vocabulary_concept_id
            AND concept_id = ?
      `;

      this.db.get(sql, [code], (err, row) => {
        if (err) {
          reject(err);
        } else if (row && row.concept_id.toString() === code) {
          const concept = new OMOPConcept(
            code,
            row.concept_name,
            row.domain_id,
            row.concept_class_id,
            row.standard_concept || 'NS',
            row.vocabulary_id
          );
          resolve({ context: concept, message: null });
        } else {
          resolve({ context: null, message: `OMOP Concept '${code}' not found` });
        }
      });
    });
  }

  // Iterator methods - not supported for OMOP due to size
  async iterator(context) {
    await this.#ensureContext(context);
    throw new Error('getNextContext not supported by OMOP - too large to iterate');
  }

  // eslint-disable-next-line no-unused-vars
  async nextContext(iteratorContext) {
    throw new Error('getNextContext not supported by OMOP - too large to iterate');
  }

  // Filter support
  async doesFilter(prop, op, value) {
    if (prop === 'domain' && op === 'equal') {
      return value != null;
    }
    return false;
  }

  async getPrepContext(iterate) {
    return new OMOPPrep(iterate);
  }

  async filter(filterContext, prop, op, value) {
    

    if (prop === 'domain' && op === 'equal') {
      const sql = `
          SELECT concept_id, concept_name, domain_id
          FROM Concepts
          WHERE standard_concept = 'S'
            AND domain_id IN (
              SELECT domain_concept_id
              FROM Domains
              WHERE domain_id = ?
          )
      `;

      const filter = new OMOPFilter(this.db, sql);
      await filter.execute([value]);
      filterContext.filters.push(filter);
    } else {
      throw new Error(`Filter "${prop} ${op} ${value}" not understood for OMOP`);
    }
  }

  async executeFilters(filterContext) {
    
    return filterContext.filters;
  }

  async filterSize(filterContext, set) {
    
    return set.rows.length;
  }

  async filterMore(filterContext, set) {
    
    return set.cursor < set.rows.length;
  }

  async filterConcept(filterContext, set) {
    

    if (set.cursor >= set.rows.length) {
      return null;
    }

    const row = set.rows[set.cursor];
    set.cursor++;

    return new OMOPConcept(
      row.concept_id,
      row.concept_name,
      row.domain_id,
      '', // concept_class not in basic filter query
      'S', // standard_concept is 'S' by filter
      '' // vocabulary not in basic filter query
    );
  }

  async filterLocate(filterContext, set, code) {
    

    if (!set.prepared) {
      return `Filter not configured for locate operations`;
    }

    const row = await set.executeForLocate(code);
    if (row && row.concept_id.toString() === code) {
      return new OMOPConcept(
        row.concept_id,
        row.concept_name,
        row.domain_id,
        '',
        'S',
        ''
      );
    } else {
      return `Code '${code}' is not in the value set`;
    }
  }

  async filterCheck(filterContext, set, concept) {
    

    if (!(concept instanceof OMOPConcept)) {
      return false;
    }

    return set.rows.some(row => row.concept_id.toString() === concept.code);
  }

  async filterFinish(filterContext) {
    
    for (const filter of filterContext.filters) {
      filter.close();
    }
  }

  async filtersNotClosed(filterContext) {
    validateOptionalParameter(filterContext, "filterContext", FilterExecutionContext);
    return false; // OMOP filters are closed
  }

  // Search filter - not implemented
  // eslint-disable-next-line no-unused-vars
  async searchFilter(filterContext, filter, sort) {
    
    throw new Error('Search filter not implemented yet');
  }

  // Subsumption testing - not implemented
  async subsumesTest(codeA, codeB) {
    await this.#ensureContext(codeA);
    await this.#ensureContext(codeB);
    
    return false;
  }

  // Translation support
  async getTranslations(coding, target) {
    

    const vocabId = getVocabId(target);
    if (vocabId === -1) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const sql = `
          SELECT concept_code, concept_name
          FROM Concepts
          WHERE concept_id = ? AND vocabulary_id = ?
      `;

      this.db.all(sql, [coding.code, vocabId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          const translations = rows.map(row => ({
            uri: target,
            code: row.concept_code,
            display: row.concept_name,
            equivalence: 'equivalent',
            map: `${this.system()}/ConceptMap/to-${vocabId}|${this._version}`
          }));
          resolve(translations);
        }
      });
    });
  }

  // Build value sets for domains
  async buildValueSet(factory, id) {
    const domain = id.substring(44); // Remove prefix

    return new Promise((resolve, reject) => {
      const sql = `
          SELECT concept_id, concept_name, Domains.domain_id
          FROM Concepts, Domains
          WHERE Domains.domain_id = ?
            AND Domains.domain_concept_id = Concepts.concept_id
      `;

      this.db.get(sql, [domain], (err, row) => {
        if (err) {
          reject(err);
        } else if (row && row.domain_id === domain) {
          // Create value set structure
          const valueSet = {
            url: id,
            status: 'active',
            version: this._version,
            name: `OMOPDomain${domain}`,
            description: `OMOP value set for domain ${row.concept_name}`,
            date: new Date().toISOString(),
            experimental: false,
            compose: {
              include: [{
                system: this.system(),
                filter: [{
                  property: 'domain',
                  op: 'equal',
                  value: domain
                }]
              }]
            }
          };
          resolve(valueSet);
        } else {
          reject(new Error(`Unknown Value Domain ${id}`));
        }
      });
    });
  }

  // Register concept maps for vocabularies
  async registerConceptMaps(list) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT DISTINCT vocabulary_id FROM Concepts';

      this.db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            const key = row.vocabulary_id;
            const uri = getUri(key);
            if (uri) {
              // Create concept maps (simplified structure)
              list.push({
                id: `to-${key}`,
                url: `${this.system()}/ConceptMap/to-${key}`,
                sourceUri: this.system(),
                targetUri: uri
              });
              list.push({
                id: `from-${key}`,
                url: `${this.system()}/ConceptMap/from-${key}`,
                sourceUri: uri,
                targetUri: this.system()
              });
            }
          }
          resolve();
        }
      });
    });
  }
}

class OMOPServicesFactory extends CodeSystemFactoryProvider {
  constructor(dbPath) {
    super();
    this.dbPath = dbPath;
    this.uses = 0;
    this._loaded = false;
    this._sharedData = null;
  }

  system() {
    return 'https://fhir-terminology.ohdsi.org';
  }

  version() {
    return this._sharedData._version;
  }

  async #ensureLoaded() {
    if (!this._loaded) {
      await this.load();
    }
  }

  async load() {
    const db = new sqlite3.Database(this.dbPath);

    try {
      this._sharedData = {
        _version: 'unknown'
      };

      // Load version from OMOP Extension vocabulary
      await this.#loadVersion(db);

    } finally {
      db.close();
    }
    this._loaded = true;
  }

  async #loadVersion(db) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT vocabulary_version
          FROM Vocabularies
          WHERE vocabulary_id = 'OMOP Extension'
      `;

      db.get(sql, (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          // Extract version number from the end of the version string
          const version = row.vocabulary_version;
          const lastSpaceIndex = version.lastIndexOf(' ');
          this._sharedData._version = lastSpaceIndex !== -1 ?
            version.substring(lastSpaceIndex + 1) : version;
          resolve();
        } else {
          this._sharedData._version = 'unknown';
          resolve();
        }
      });
    });
  }

  defaultVersion() {
    return this._sharedData?._version || 'unknown';
  }

  async build(opContext, supplements) {
    await this.#ensureLoaded();
    this.recordUse();

    // Create fresh database connection for this provider instance
    const db = new sqlite3.Database(this.dbPath);

    return new OMOPServices(opContext, supplements, db, this._sharedData);
  }

  static checkDB(dbPath) {
    try {
      const fs = require('fs');

      // Check if file exists
      if (!fs.existsSync(dbPath)) {
        return 'Database file not found';
      }

      // Check file size
      const stats = fs.statSync(dbPath);
      if (stats.size < 1024) {
        return 'Database file too small';
      }

      // Try to open database and check for required tables
      const db = new sqlite3.Database(dbPath);

      try {
        // Simple count query to verify database integrity
        db.get('SELECT COUNT(*) as count FROM Concepts', (err) => {
          if (err) {
            db.close();
            return 'Missing Tables - needs re-importing (by java)';
          }
        });

        db.close();
        return 'OK (check via provider for count)';
      } catch (e) {
        return 'Missing Tables - needs re-importing (by java)';
      }
    } catch (e) {
      return `Database error: ${e.message}`;
    }
  }
}

module.exports = {
  OMOPServices,
  OMOPServicesFactory,
  OMOPConcept,
  OMOPFilter
};