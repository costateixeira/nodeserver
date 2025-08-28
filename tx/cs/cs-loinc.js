const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const { CodeSystem } = require('../library/codesystem');
const { Languages, Language } = require('../../library/languages');
const { CodeSystemProvider, Designation, CodeSystemFactoryProvider} = require('./cs-api');

// Context kinds matching Pascal enum
const LoincProviderContextKind = {
  CODE: 0,    // lpckCode
  PART: 1,    // lpckPart
  LIST: 2,    // lpckList
  ANSWER: 3   // lpckAnswer
};

class DescriptionCacheEntry {
  constructor(display, lang, value) {
    this.display = display;
    this.lang = lang;
    this.value = value;
  }
}

class LoincProviderContext {
  constructor(key, kind, code, desc) {
    this.key = key;
    this.kind = kind;
    this.code = code;
    this.desc = desc;
    this.displays = []; // Array of DescriptionCacheEntry
    this.children = null; // Will be Set of keys if this has children
  }

  addChild(key) {
    if (this.children === null) {
      this.children = new Set();
    }
    this.children.add(key);
  }
}

class LoincDisplay {
  constructor(language, value) {
    this.language = language;
    this.value = value;
  }
}

class LoincIteratorContext {
  constructor(context, keys) {
    this.context = context;
    this.keys = keys || [];
    this.current = 0;
    this.total = this.keys.length;
  }

  more() {
    return this.current < this.total;
  }

  next() {
    this.current++;
  }
}

class LoincFilterHolder {
  constructor() {
    this.keys = [];
    this.cursor = 0;
    this.lsql = '';
  }

  hasKey(key) {
    // Binary search since keys should be sorted
    let l = 0;
    let r = this.keys.length - 1;
    while (l <= r) {
      const m = Math.floor((l + r) / 2);
      if (this.keys[m] < key) {
        l = m + 1;
      } else if (this.keys[m] > key) {
        r = m - 1;
      } else {
        return true;
      }
    }
    return false;
  }
}

class LoincPrep {
  constructor() {
    this.filters = [];
  }
}

class LoincServices extends CodeSystemProvider {
  constructor(opContext, supplements, db, sharedData) {
    super(opContext, supplements);
    this.db = db;

    // Shared data from factory
    this.langs = sharedData.langs;
    this.codes = sharedData.codes;
    this.codeList = sharedData.codeList;
    this._version = sharedData._version;
    this.root = sharedData.root;
    this.firstCodeKey = sharedData.firstCodeKey;
    this.relationships = sharedData.relationships;
    this.properties = sharedData.properties;
    this.statusKeys = sharedData.statusKeys;
    this.statusCodes = sharedData.statusCodes;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Metadata methods
  system() {
    return 'http://loinc.org';
  }

  version() {
    return this._version;
  }

  description() {
    return 'LOINC';
  }

  async totalCount() {
    return this.codes.size;
  }

  hasParents() {
    return true; // LOINC has hierarchical relationships
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);

    // Check supplements first
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }

    // Check if any requested languages are available in LOINC data
    for (const requestedLang of langs.languages) {
      for (const [loincLangCode, loincLangKey] of this.langs) {
        const loincLang = new Language(loincLangCode);
        if (loincLang.matchesForDisplay(requestedLang)) {
          return true;
        }
      }
    }

    return super.hasAnyDisplays(langs);
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

    // Use language-aware display logic
    if (this.opContext.langs && !this.opContext.langs.isEnglishOrNothing()) {
      const displays = await this.#getDisplaysForContext(ctxt, this.opContext.langs);

      // Try to find exact language match
      for (const lang of this.opContext.langs.langs) {
        for (const display of displays) {
          if (lang.matches(display.language, true)) {
            return display.value;
          }
        }
      }

      // Try partial language match
      for (const lang of this.opContext.langs.langs) {
        for (const display of displays) {
          if (lang.matches(display.language, false)) {
            return display.value;
          }
        }
      }
    }

    return ctxt.desc || '';
  }

  async definition(context) {
    
    return null; // LOINC doesn't provide definitions
  }

  async isAbstract(context) {
    
    return false; // LOINC codes are not abstract
  }

  async isInactive(context) {
    
    return false; // Handle via status if needed
  }

  async isDeprecated(context) {
    
    return false; // Handle via status if needed
  }

  async designations(context) {
    
    const ctxt = await this.#ensureContext(context);
    let designations = [];

    if (ctxt) {
      // Add main display
      designations.push(new Designation('en-US', CodeSystem.makeUseForDisplay(), ctxt.desc));

      // Add cached designations
      if (ctxt.displays.length === 0) {
        await this.#loadDesignationsForContext(ctxt);
      }

      for (const entry of ctxt.displays) {
        const use = entry.display ? CodeSystem.makeUseForDisplay() : null;
        designations.push(new Designation(entry.lang, use, entry.value));
      }

      // Add supplement designations
      designations.push(...this._listSupplementDesignations(ctxt.code));
    }

    return designations;
  }

  async extendLookup(ctxt, props, params) {
    

    if (typeof ctxt === 'string') {
      const located = await this.locate(ctxt);
      if (!located.context) {
        throw new Error(located.message);
      }
      ctxt = located.context;
    }

    if (!(ctxt instanceof LoincProviderContext)) {
      throw new Error('Invalid context for LOINC lookup');
    }

    // Set abstract status
    params.abstract = false;

    // Add relationships
    await this.#addRelationshipProperties(ctxt, params);

    // Add properties
    await this.#addConceptProperties(ctxt, params);

    // Add status
    await this.#addStatusProperty(ctxt, params);

    // Add designations based on context kind
    const designationUse = this.#getDesignationUse(ctxt.kind);
    this.#addProperty(params, 'designation', designationUse, ctxt.desc, 'en-US');

    // Add all other designations
    await this.#addAllDesignations(ctxt, params);
  }

  #getDesignationUse(kind) {
    switch (kind) {
      case LoincProviderContextKind.CODE:
        return 'LONG_COMMON_NAME';
      case LoincProviderContextKind.PART:
        return 'PartDisplayName';
      default:
        return 'LONG_COMMON_NAME';
    }
  }

  async #addRelationshipProperties(ctxt, params) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT RelationshipTypes.Description as Relationship, Codes.Code, Codes.Description as Value
          FROM Relationships, RelationshipTypes, Codes
          WHERE Relationships.SourceKey = ?
            AND Relationships.RelationshipTypeKey = RelationshipTypes.RelationshipTypeKey
            AND Relationships.TargetKey = Codes.CodeKey
      `;

      this.db.all(sql, [ctxt.key], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this.#addProperty(params, 'property', row.Relationship, row.Code);
          }
          resolve();
        }
      });
    });
  }

  async #addConceptProperties(ctxt, params) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT PropertyTypes.Description, PropertyValues.Value
          FROM Properties, PropertyTypes, PropertyValues
          WHERE Properties.CodeKey = ?
            AND Properties.PropertyTypeKey = PropertyTypes.PropertyTypeKey
            AND Properties.PropertyValueKey = PropertyValues.PropertyValueKey
      `;

      this.db.all(sql, [ctxt.key], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this.#addProperty(params, 'property', row.Description, row.Value);
          }
          resolve();
        }
      });
    });
  }

  async #addStatusProperty(ctxt, params) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT StatusKey FROM Codes WHERE CodeKey = ? AND StatusKey != 0';

      this.db.get(sql, [ctxt.key], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const statusDesc = this.statusCodes.get(row.StatusKey.toString());
          if (statusDesc) {
            this.#addProperty(params, 'property', 'STATUS', statusDesc);
          }
          resolve();
        } else {
          resolve();
        }
      });
    });
  }

  async #addAllDesignations(ctxt, params) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT Languages.Code as Lang, DescriptionTypes.Description as DType, Descriptions.Value
          FROM Descriptions, Languages, DescriptionTypes
          WHERE Descriptions.CodeKey = ?
            AND Descriptions.DescriptionTypeKey != 4 
          AND Descriptions.DescriptionTypeKey = DescriptionTypes.DescriptionTypeKey 
          AND Descriptions.LanguageKey = Languages.LanguageKey
      `;

      this.db.all(sql, [ctxt.key], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this.#addProperty(params, 'designation', row.DType, row.Value, row.Lang);
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
        { name: 'value', valueString: value }
      ]
    };

    if (language) {
      property.part.push({ name: 'language', valueCode: language });
    }

    params.parameter.push(property);
  }

  async #getDisplaysForContext(ctxt, langs) {
    const displays = [new LoincDisplay('en-US', ctxt.desc)];

    return new Promise((resolve, reject) => {
      const sql = `
          SELECT Languages.Code as Lang, Descriptions.Value
          FROM Descriptions, Languages
          WHERE Descriptions.CodeKey = ?
            AND Descriptions.DescriptionTypeKey IN (1,2,5)
            AND Descriptions.LanguageKey = Languages.LanguageKey
          ORDER BY DescriptionTypeKey
      `;

      this.db.all(sql, [ctxt.key], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            displays.push(new LoincDisplay(row.Lang, row.Value));
          }

          // Add supplement displays
          this.#addSupplementDisplays(displays, ctxt.code);

          resolve(displays);
        }
      });
    });
  }

  #addSupplementDisplays(displays, code) {
    if (this.supplements) {
      for (const supplement of this.supplements) {
        const concept = supplement.getConceptByCode(code);
        if (concept) {
          if (concept.display) {
            displays.push(new LoincDisplay(supplement.jsonObj.language || 'en', concept.display));
          }
          if (concept.designation) {
            for (const designation of concept.designation) {
              const lang = designation.language || supplement.jsonObj.language || 'en';
              displays.push(new LoincDisplay(lang, designation.value));
            }
          }
        }
      }
    }
  }

  async #loadDesignationsForContext(ctxt) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT Languages.Code as Lang, DescriptionTypes.Description as DType, Descriptions.Value
          FROM Descriptions, Languages, DescriptionTypes
          WHERE Descriptions.CodeKey = ?
            AND Descriptions.DescriptionTypeKey = DescriptionTypes.DescriptionTypeKey
            AND Descriptions.LanguageKey = Languages.LanguageKey
      `;

      this.db.all(sql, [ctxt.key], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            const isDisplay = row.DType === 'LONG_COMMON_NAME';
            ctxt.displays.push(new DescriptionCacheEntry(isDisplay, row.Lang, row.Value));
          }
          resolve();
        }
      });
    });
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
    if (context instanceof LoincProviderContext) {
      return context;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof context));
  }

  // Lookup methods
  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const context = this.codes.get(code);
    if (context) {
      return { context: context, message: null };
    }

    return { context: null, message: `LOINC Code '${code}' not found` };
  }

  // Iterator methods
  async iterator(context) {
    

    if (context === null) {
      // Iterate all codes starting from first code
      const keys = Array.from({ length: this.codeList.length - this.firstCodeKey }, (_, i) => i + this.firstCodeKey);
      return new LoincIteratorContext(null, keys);
    } else {
      const ctxt = await this.#ensureContext(context);
      if (ctxt.kind === LoincProviderContextKind.PART && ctxt.children) {
        return new LoincIteratorContext(ctxt, Array.from(ctxt.children));
      } else {
        return new LoincIteratorContext(ctxt, []);
      }
    }
  }

  async nextContext(iteratorContext) {
    

    if (!iteratorContext.more()) {
      return null;
    }

    const key = iteratorContext.keys[iteratorContext.current];
    iteratorContext.next();

    return this.codeList[key];
  }

  // Filter support
  async doesFilter(prop, op, value) {
    

    // Relationship filters
    if (this.relationships.has(prop) && ['equal', 'in'].includes(op)) {
      return this.codes.has(value) || true; // Allow description matching too
    }

    // Property filters
    if (this.properties.has(prop) && ['equal', 'in'].includes(op)) {
      return true;
    }

    // Special filters
    if (prop === 'STATUS' && op === 'equal' && this.statusKeys.has(value)) {
      return true;
    }

    if (prop === 'LIST' && op === 'equal' && this.codes.has(value)) {
      return true;
    }

    if (prop === 'answers-for' && op === 'equal') {
      return true;
    }

    if (prop === 'concept' && ['is-a', 'descendent-of'].includes(op)) {
      return true;
    }

    if (prop === 'copyright' && op === 'equal' && ['LOINC', '3rdParty'].includes(value)) {
      return true;
    }

    // Regex support
    if ((this.relationships.has(prop) || this.properties.has(prop)) && op === 'regex') {
      return true;
    }

    return false;
  }

  async getPrepContext(iterate) {
    
    return new LoincPrep();
  }

  async filter(filterContext, prop, op, value) {
    

    const filter = new LoincFilterHolder();
    await this.#executeFilterQuery(prop, op, value, filter);
    filterContext.filters.push(filter);
  }
  async #executeFilterQuery(prop, op, value, filter) {
    let sql = '';
    let lsql = '';

    // LIST filter
    if (prop === 'LIST' && op === 'equal' && this.codes.has(value)) {
      sql = `SELECT TargetKey as Key FROM Relationships
             WHERE RelationshipTypeKey = ${this.relationships.get('Answer')} AND SourceKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')
             ORDER BY SourceKey ASC`;
      lsql = `
          SELECT COUNT(TargetKey) FROM Relationships
          WHERE RelationshipTypeKey = ${this.relationships.get('Answer')} AND SourceKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')
            AND TargetKey =
      `;
    }
    // answers-for filter
    else if (prop === 'answers-for' && op === 'equal') {
      if (value.startsWith('LL')) {
        sql = `SELECT TargetKey as Key FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get('Answer')} AND SourceKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}') ORDER BY SourceKey ASC`;
        lsql = `SELECT COUNT(TargetKey) FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get('Answer')} AND SourceKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}') AND TargetKey = `;
      } else {
        sql = `
            SELECT TargetKey as Key FROM Relationships
            WHERE RelationshipTypeKey = ${this.relationships.get('Answer')}
              AND SourceKey IN (
                SELECT SourceKey FROM Relationships
                WHERE RelationshipTypeKey = ${this.relationships.get('answers-for')}
              AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')
                )
            ORDER BY SourceKey ASC
        `;
        lsql = `SELECT COUNT(TargetKey) FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get('Answer')} AND SourceKey IN (SELECT SourceKey FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get('answers-for')} AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')) AND TargetKey = `;
      }
    }
    // Relationship filters
    else if (this.relationships.has(prop) && op === 'equal') {
      if (this.codes.has(value)) {
        sql = `
            SELECT SourceKey as Key FROM Relationships
            WHERE RelationshipTypeKey = ${this.relationships.get(prop)}
              AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')
            ORDER BY SourceKey ASC
        `;
        lsql = `SELECT COUNT(SourceKey) FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get(prop)} AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}') AND SourceKey = `;
      } else {
        sql = `
            SELECT SourceKey as Key FROM Relationships
            WHERE RelationshipTypeKey = ${this.relationships.get(prop)}
              AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Description = '${this.#sqlWrapString(value)}' COLLATE NOCASE)
            ORDER BY SourceKey ASC
        `;
        lsql = `SELECT COUNT(SourceKey) FROM Relationships WHERE RelationshipTypeKey = ${this.relationships.get(prop)} AND TargetKey IN (SELECT CodeKey FROM Codes WHERE Description = '${this.#sqlWrapString(value)}' COLLATE NOCASE) AND SourceKey = `;
      }
    }
    // Property filters
    else if (this.properties.has(prop) && op === 'equal') {
      if (prop === 'CLASSTYPE' && ['1', '2', '3', '4'].includes(value)) {
        const classTypes = {
          '1': 'Laboratory class',
          '2': 'Clinical class',
          '3': 'Claims attachments',
          '4': 'Surveys'
        };
        value = classTypes[value];
      }

      sql = `
          SELECT CodeKey as Key FROM Properties, PropertyValues
          WHERE Properties.PropertyTypeKey = ${this.properties.get(prop)}
            AND Properties.PropertyValueKey = PropertyValues.PropertyValueKey
            AND PropertyValues.Value = '${this.#sqlWrapString(value)}' COLLATE NOCASE
          ORDER BY CodeKey ASC
      `;
      lsql = `SELECT COUNT(CodeKey) FROM Properties, PropertyValues WHERE Properties.PropertyTypeKey = ${this.properties.get(prop)} AND Properties.PropertyValueKey = PropertyValues.PropertyValueKey AND PropertyValues.Value = '${this.#sqlWrapString(value)}' COLLATE NOCASE AND CodeKey = `;
    }
    // Status filter
    else if (prop === 'STATUS' && op === 'equal' && this.statusKeys.has(value)) {
      sql = `
          SELECT CodeKey as Key FROM Codes
          WHERE StatusKey = ${this.statusKeys.get(value)}
          ORDER BY CodeKey ASC
      `;
      lsql = `SELECT COUNT(CodeKey) FROM Codes WHERE StatusKey = ${this.statusKeys.get(value)} AND CodeKey = `;
    }
    // Concept hierarchy filters
    else if (prop === 'concept' && ['is-a', 'descendent-of'].includes(op)) {
      sql = `
          SELECT DescendentKey as Key FROM Closure
          WHERE AncestorKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}')
          ORDER BY DescendentKey ASC
      `;
      lsql = `SELECT COUNT(DescendentKey) FROM Closure WHERE AncestorKey IN (SELECT CodeKey FROM Codes WHERE Code = '${this.#sqlWrapString(value)}') AND DescendentKey = `;
    }
    // Copyright filters
    else if (prop === 'copyright' && op === 'equal') {
      if (value === 'LOINC') {
        sql = `
            SELECT CodeKey as Key FROM Codes
            WHERE NOT CodeKey IN (SELECT CodeKey FROM Properties WHERE PropertyTypeKey = 9)
            ORDER BY CodeKey ASC
        `;
        lsql = `SELECT COUNT(CodeKey) FROM Codes WHERE NOT CodeKey IN (SELECT CodeKey FROM Properties WHERE PropertyTypeKey = 9) AND CodeKey = `;
      } else if (value === '3rdParty') {
        sql = `
            SELECT CodeKey as Key FROM Codes
            WHERE CodeKey IN (SELECT CodeKey FROM Properties WHERE PropertyTypeKey = 9)
            ORDER BY CodeKey ASC
        `;
        lsql = `SELECT COUNT(CodeKey) FROM Codes WHERE CodeKey IN (SELECT CodeKey FROM Properties WHERE PropertyTypeKey = 9) AND CodeKey = `;
      }
    }

    if (sql) {
      await this.#executeSQL(sql, filter);
      filter.lsql = lsql;
    } else {
      throw new Error(`The filter "${prop} ${op} ${value}" is not supported for LOINC`);
    }
  }

  async #executeSQL(sql, filter) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          filter.keys = rows.map(row => row.Key).filter(key => key !== 0);
          resolve();
        }
      });
    });
  }

  #sqlWrapString(str) {
    return str.replace(/'/g, "''");
  }

  async executeFilters(filterContext) {
    
    return filterContext.filters;
  }

  async filterSize(filterContext, set) {
    
    return set.keys.length;
  }

  async filterMore(filterContext, set) {
    
    set.cursor = set.cursor || 0;
    return set.cursor < set.keys.length;
  }

  async filterConcept(filterContext, set) {
    

    if (set.cursor >= set.keys.length) {
      return null;
    }

    const key = set.keys[set.cursor];
    set.cursor++;

    return this.codeList[key];
  }

  async filterLocate(filterContext, set, code) {
    

    const context = this.codes.get(code);
    if (!context) {
      return `Not a valid code: ${code}`;
    }

    if (set.lsql === '') {
      return 'Filter not understood';
    }

    // Check if this context's key is in the filter
    if (set.hasKey(context.key)) {
      return context;
    } else {
      return `Code ${code} is not in the specified filter`;
    }
  }

  async filterCheck(filterContext, set, concept) {
    

    if (!(concept instanceof LoincProviderContext)) {
      return false;
    }

    return set.hasKey(concept.key);
  }

  async filterFinish(filterContext) {
    
    // Clean up resources if needed
  }

  // Search filter - placeholder for text search
  async searchFilter(filterContext, filter, sort) {
    
    throw new Error('Text search not implemented yet');
  }

  // Subsumption testing
  async subsumesTest(codeA, codeB) {
    
    return false; // Not implemented yet
  }
}

class LoincServicesFactory extends CodeSystemFactoryProvider {
  constructor(dbPath) {
    super();
    this.dbPath = dbPath;
    this.uses = 0;
    this._loaded = false;
    this._sharedData = null;
  }

  system() {
    return 'http://loinc.org';
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

    // Enable performance optimizations
    await this.#optimizeDatabase(db);

    try {
      this._sharedData = {
        langs: new Map(),
        codes: new Map(),
        codeList: [null],
        relationships: new Map(),
        properties: new Map(),
        statusKeys: new Map(),
        statusCodes: new Map(),
        _version: '',
        root: '',
        firstCodeKey: 0
      };

      // Load small lookup tables in parallel
      const [langs, statusCodes, relationships, properties, config] = await Promise.all([
        this.#loadLanguages(db),
        this.#loadStatusCodes(db),
        this.#loadRelationshipTypes(db),
        this.#loadPropertyTypes(db),
        this.#loadConfig(db)
      ]);

      // Load codes (largest operation)
      await this.#loadCodes(db);

      // Load dependent data in parallel
      await Promise.all([
        this.#loadDesignationsCache(db),
        this.#loadHierarchy(db)
      ]);

    } finally {
      db.close();
    }
    this._loaded = true;
  }

  async #optimizeDatabase(db) {
    return new Promise((resolve) => {
      db.serialize(() => {
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA synchronous = NORMAL');
        db.run('PRAGMA cache_size = 10000');
        db.run('PRAGMA temp_store = MEMORY');
        db.run('PRAGMA mmap_size = 268435456'); // 256MB
        resolve();
      });
    });
  }

  async #loadLanguages(db) {
    return new Promise((resolve, reject) => {
      db.all('SELECT LanguageKey, Code FROM Languages', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this._sharedData.langs.set(row.Code, row.LanguageKey);
          }
          resolve();
        }
      });
    });
  }

  async #loadStatusCodes(db) {
    return new Promise((resolve, reject) => {
      db.all('SELECT StatusKey, Description FROM StatusCodes', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this._sharedData.statusKeys.set(row.Description, row.StatusKey.toString());
            this._sharedData.statusCodes.set(row.StatusKey.toString(), row.Description);
          }
          resolve();
        }
      });
    });
  }

  async #loadRelationshipTypes(db) {
    return new Promise((resolve, reject) => {
      db.all('SELECT RelationshipTypeKey, Description FROM RelationshipTypes', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this._sharedData.relationships.set(row.Description, row.RelationshipTypeKey.toString());
          }
          resolve();
        }
      });
    });
  }

  async #loadPropertyTypes(db) {
    return new Promise((resolve, reject) => {
      db.all('SELECT PropertyTypeKey, Description FROM PropertyTypes', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            this._sharedData.properties.set(row.Description, row.PropertyTypeKey.toString());
          }
          resolve();
        }
      });
    });
  }

  async #loadCodes(db) {
    return new Promise((resolve, reject) => {
      // First get the count to pre-allocate array
      db.get('SELECT MAX(CodeKey) as maxKey FROM Codes', (err, row) => {
        if (err) return reject(err);

        // Pre-allocate the array to avoid repeated resizing
        const maxKey = row.maxKey || 0;
        this._sharedData.codeList = new Array(maxKey + 1).fill(null);

        // Now load all codes
        db.all('SELECT CodeKey, Code, Type, Description FROM Codes ORDER BY CodeKey ASC', (err, rows) => {
          if (err) return reject(err);

          // Batch process rows
          for (const row of rows) {
            const context = new LoincProviderContext(
              row.CodeKey,
              row.Type - 1,
              row.Code,
              row.Description
            );

            this._sharedData.codes.set(row.Code, context);
            this._sharedData.codeList[row.CodeKey] = context;

            if (this._sharedData.firstCodeKey === 0 && context.kind === LoincProviderContextKind.CODE) {
              this._sharedData.firstCodeKey = context.key;
            }
          }
          resolve();
        });
      });
    });
  }

  async #loadDesignationsCache(db) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT
              d.CodeKey,
              l.Code as Lang,
              dt.Description as DType,
              d.Value,
              dt.Description = 'LONG_COMMON_NAME' as IsDisplay
          FROM Descriptions d
                   JOIN Languages l ON d.LanguageKey = l.LanguageKey
                   JOIN DescriptionTypes dt ON d.DescriptionTypeKey = dt.DescriptionTypeKey
          WHERE d.DescriptionTypeKey != 4
          ORDER BY d.CodeKey
      `;

      db.all(sql, (err, rows) => {
        if (err) return reject(err);

        // Batch process by CodeKey to reduce lookups
        let currentKey = null;
        let currentContext = null;

        for (const row of rows) {
          if (row.CodeKey !== currentKey) {
            currentKey = row.CodeKey;
            currentContext = this._sharedData.codeList[currentKey];
          }

          if (currentContext) {
            currentContext.displays.push(
              new DescriptionCacheEntry(row.IsDisplay, row.Lang, row.Value)
            );
          }
        }
        resolve();
      });
    });
  }

  async #loadHierarchy(db) {
    const childRelKey = this._sharedData.relationships.get('child');
    if (!childRelKey) {
      return; // No child relationships defined
    }

    return new Promise((resolve, reject) => {
      const sql = `
          SELECT SourceKey, TargetKey FROM Relationships
          WHERE RelationshipTypeKey = ${childRelKey}
      `;

      db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            if (row.SourceKey !== 0 && row.TargetKey !== 0) {
              const parentContext = this._sharedData.codeList[row.SourceKey];
              if (parentContext) {
                parentContext.addChild(row.TargetKey);
              }
            }
          }
          resolve();
        }
      });
    });
  }

  async #loadConfig(db) {
    return new Promise((resolve, reject) => {
      db.all('SELECT ConfigKey, Value FROM Config WHERE ConfigKey IN (2, 3)', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            if (row.ConfigKey === 2) {
              this._sharedData._version = row.Value;
            } else if (row.ConfigKey === 3) {
              this._sharedData.root = row.Value;
            }
          }
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

    return new LoincServices(opContext, supplements, db, this._sharedData);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  LoincServices,
  LoincServicesFactory,
  LoincProviderContext,
  LoincProviderContextKind
};