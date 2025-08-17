const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const CodeSystem = require('../library/codesystem');
const { Languages, Language } = require('../../library/languages');
const { CodeSystemProvider, Designation } = require('./cs-api');

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
  constructor(db, supplements, sharedData) {
    super(supplements);
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

  async version() {
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
  async code(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    return ctxt ? ctxt.code : null;
  }

  async display(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    // Check supplements first
    let disp = this._displayFromSupplements(opContext, ctxt.code);
    if (disp) {
      return disp;
    }

    // Use language-aware display logic
    if (opContext.langs && !opContext.langs.isEnglishOrNothing()) {
      const displays = await this.#getDisplaysForContext(ctxt, opContext.langs);

      // Try to find exact language match
      for (const lang of opContext.langs.langs) {
        for (const display of displays) {
          if (lang.matches(display.language, true)) {
            return display.value;
          }
        }
      }

      // Try partial language match
      for (const lang of opContext.langs.langs) {
        for (const display of displays) {
          if (lang.matches(display.language, false)) {
            return display.value;
          }
        }
      }
    }

    return ctxt.desc || '';
  }

  async definition(opContext, context) {
    this._ensureOpContext(opContext);
    return null; // LOINC doesn't provide definitions
  }

  async isAbstract(opContext, context) {
    this._ensureOpContext(opContext);
    return false; // LOINC codes are not abstract
  }

  async isInactive(opContext, context) {
    this._ensureOpContext(opContext);
    return false; // Handle via status if needed
  }

  async isDeprecated(opContext, context) {
    this._ensureOpContext(opContext);
    return false; // Handle via status if needed
  }

  async designations(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
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

  async extendLookup(opContext, ctxt, props, params) {
    this._ensureOpContext(opContext);

    if (typeof ctxt === 'string') {
      const located = await this.locate(opContext, ctxt);
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

  async #ensureContext(opContext, context) {
    if (context == null) {
      return null;
    }
    if (typeof context === 'string') {
      const ctxt = await this.locate(opContext, context);
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
  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const context = this.codes.get(code);
    if (context) {
      return { context: context, message: null };
    }

    return { context: null, message: `LOINC Code '${code}' not found` };
  }

  // Iterator methods
  async iterator(opContext, context) {
    this._ensureOpContext(opContext);

    if (context === null) {
      // Iterate all codes starting from first code
      const keys = Array.from({ length: this.codeList.length - this.firstCodeKey }, (_, i) => i + this.firstCodeKey);
      return new LoincIteratorContext(null, keys);
    } else {
      const ctxt = await this.#ensureContext(opContext, context);
      if (ctxt.kind === LoincProviderContextKind.PART && ctxt.children) {
        return new LoincIteratorContext(ctxt, Array.from(ctxt.children));
      } else {
        return new LoincIteratorContext(ctxt, []);
      }
    }
  }

  async nextContext(opContext, iteratorContext) {
    this._ensureOpContext(opContext);

    if (!iteratorContext.more()) {
      return null;
    }

    const key = iteratorContext.keys[iteratorContext.current];
    iteratorContext.next();

    return this.codeList[key];
  }

  // Filter support
  async doesFilter(opContext, prop, op, value) {
    this._ensureOpContext(opContext);

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

  async getPrepContext(opContext, iterate) {
    this._ensureOpContext(opContext);
    return new LoincPrep();
  }

  async filter(opContext, filterContext, prop, op, value) {
    this._ensureOpContext(opContext);

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

  async executeFilters(opContext, filterContext) {
    this._ensureOpContext(opContext);
    return filterContext.filters;
  }

  async filterSize(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    return set.keys.length;
  }

  async filterMore(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    set.cursor = set.cursor || 0;
    return set.cursor < set.keys.length;
  }

  async filterConcept(opContext, filterContext, set) {
    this._ensureOpContext(opContext);

    if (set.cursor >= set.keys.length) {
      return null;
    }

    const key = set.keys[set.cursor];
    set.cursor++;

    return this.codeList[key];
  }

  async filterLocate(opContext, filterContext, set, code) {
    this._ensureOpContext(opContext);

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

  async filterCheck(opContext, filterContext, set, concept) {
    this._ensureOpContext(opContext);

    if (!(concept instanceof LoincProviderContext)) {
      return false;
    }

    return set.hasKey(concept.key);
  }

  async filterFinish(opContext, filterContext) {
    this._ensureOpContext(opContext);
    // Clean up resources if needed
  }

  // Search filter - placeholder for text search
  async searchFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    throw new Error('Text search not implemented yet');
  }

  // Subsumption testing
  async subsumesTest(opContext, codeA, codeB) {
    this._ensureOpContext(opContext);
    return false; // Not implemented yet
  }
}

class LoincServicesFactory {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.uses = 0;
    this._loaded = false;
    this._sharedData = null;
  }

  async #ensureLoaded() {
    if (!this._loaded) {
      await this.#loadSharedData();
      this._loaded = true;
    }
  }

  async #loadSharedData() {
    const db = new sqlite3.Database(this.dbPath);

    try {
      this._sharedData = {
        langs: new Map(),
        codes: new Map(),
        codeList: [null], // Index 0 is null, keys start from 1
        relationships: new Map(),
        properties: new Map(),
        statusKeys: new Map(),
        statusCodes: new Map(),
        _version: '',
        root: '',
        firstCodeKey: 0
      };

      // Load languages
      await this.#loadLanguages(db);

      // Load status codes
      await this.#loadStatusCodes(db);

      // Load relationship types
      await this.#loadRelationshipTypes(db);

      // Load property types
      await this.#loadPropertyTypes(db);

      // Load all codes
      await this.#loadCodes(db);

      // Load designations cache for some contexts
      await this.#loadDesignationsCache(db);

      // Load hierarchical relationships
      await this.#loadHierarchy(db);

      // Load version and root
      await this.#loadConfig(db);

    } finally {
      db.close();
    }
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
      db.all('SELECT CodeKey, Code, Type, Description FROM Codes ORDER BY CodeKey ASC', (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            const context = new LoincProviderContext(
              row.CodeKey,
              row.Type - 1, // Convert from 1-based to 0-based enum
              row.Code,
              row.Description
            );

            this._sharedData.codes.set(row.Code, context);

            // Extend codeList array if needed
            while (this._sharedData.codeList.length <= row.CodeKey) {
              this._sharedData.codeList.push(null);
            }
            this._sharedData.codeList[row.CodeKey] = context;

            // Track first code key
            if (this._sharedData.firstCodeKey === 0 && context.kind === LoincProviderContextKind.CODE) {
              this._sharedData.firstCodeKey = context.key;
            }
          }
          resolve();
        }
      });
    });
  }

  async #loadDesignationsCache(db) {
    return new Promise((resolve, reject) => {
      const sql = `
          SELECT Languages.Code as Lang, CodeKey as Key, DescriptionTypes.Description as DType, Value
          FROM Descriptions, Languages, DescriptionTypes
          WHERE Descriptions.DescriptionTypeKey != 4
            AND Descriptions.DescriptionTypeKey = DescriptionTypes.DescriptionTypeKey
            AND Descriptions.LanguageKey = Languages.LanguageKey
      `;

      db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          for (const row of rows) {
            const context = this._sharedData.codeList[row.Key];
            if (context) {
              const isDisplay = row.DType === 'LONG_COMMON_NAME';
              context.displays.push(new DescriptionCacheEntry(isDisplay, row.Lang, row.Value));
            }
          }
          resolve();
        }
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

    return new LoincServices(db, supplements, this._sharedData);
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