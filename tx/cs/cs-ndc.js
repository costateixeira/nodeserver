const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const { CodeSystem } = require('../library/codesystem');
const { CodeSystemProvider, Designation } = require('./cs-api');

class NdcConcept {
  constructor(code, display, isPackage = false, key = null) {
    this.code = code;
    this.display = display;
    this.isPackage = isPackage;
    this.key = key;

    // Additional NDC-specific properties
    this.productCode = null; // For packages, the related product code
    this.code11 = null; // 11-digit version for packages
    this.active = true;
    this.properties = {}; // Store additional properties from database
  }
}

class NdcServices extends CodeSystemProvider {
  constructor(db, supplements, lookupTables, packageCount, productCount, version) {
    super(supplements);
    this.db = db;
    this._version = version;
    this._lookupTables = lookupTables;
    this._packageCount = packageCount;
    this._productCount = productCount;
  }

  // Clean up database connection when provider is destroyed
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Metadata methods
  system() {
    return 'http://hl7.org/fhir/sid/ndc'; // NDC system URI
  }

  async version() {
    return this._version;
  }

  description() {
    return 'National Drug Code (NDC) Directory';
  }

  async totalCount() {
    return this._packageCount + this._productCount;
  }

  hasParents() {
    return false; // No hierarchical relationships
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }
    return super.hasAnyDisplays(langs);
  }

  // Core concept methods
  async code(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return ctxt ? ctxt.code : null;
  }

  async display(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    if (!ctxt) {
      return null;
    }

    // Check supplements first
    let disp = this._displayFromSupplements(opContext, ctxt.code);
    if (disp) {
      return disp;
    }

    return ctxt.display ? ctxt.display.trim() : '';
  }

  async definition(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return null; // No definitions provided in NDC
  }

  async isAbstract(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // No abstract concepts in NDC
  }

  async isInactive(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return ctxt ? !ctxt.active : false;
  }

  async isDeprecated(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // NDC doesn't track deprecated status separately
  }

  async designations(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    let designations = [];

    if (ctxt) {
      // Add main display
      if (ctxt.display) {
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), ctxt.display.trim()));
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

    if (!(ctxt instanceof NdcConcept)) {
      throw new Error('Invalid context for NDC lookup');
    }

    // Get full data for the concept
    const fullData = await this.#getFullConceptData(ctxt);

    // Add NDC-specific properties
    if (!ctxt.isPackage) {
      // Product properties
      this.#addProperty(params, 'code-type', 'product');
      this.#addProperty(params, 'description', fullData.display || '');
    } else {
      // Package properties
      if (ctxt.code.includes('-')) {
        this.#addProperty(params, 'code-type', '10-digit');
        if (fullData.code11) {
          this.#addProperty(params, 'synonym', fullData.code11);
        }
      } else {
        this.#addProperty(params, 'code-type', '11-digit');
        if (fullData.originalCode) {
          this.#addProperty(params, 'synonym', fullData.originalCode);
        }
      }
      this.#addProperty(params, 'description', fullData.display || '');
      if (fullData.productCode) {
        this.#addProperty(params, 'product', fullData.productCode);
      }
    }

    // Common properties
    if (fullData.type && this._lookupTables.types.has(fullData.type)) {
      this.#addProperty(params, 'type', this._lookupTables.types.get(fullData.type));
    }

    this.#addProperty(params, 'active', fullData.active ? 'true' : 'false');

    if (fullData.tradeName) {
      this.#addProperty(params, 'trade-name', fullData.tradeName);
    }

    if (fullData.doseForm && this._lookupTables.doseForms.has(fullData.doseForm)) {
      this.#addProperty(params, 'dose-form', this._lookupTables.doseForms.get(fullData.doseForm));
    }

    if (fullData.route && this._lookupTables.routes.has(fullData.route)) {
      this.#addProperty(params, 'route', this._lookupTables.routes.get(fullData.route));
    }

    if (fullData.company && this._lookupTables.organizations.has(fullData.company)) {
      this.#addProperty(params, 'company', this._lookupTables.organizations.get(fullData.company));
    }

    if (fullData.category) {
      this.#addProperty(params, 'category', fullData.category);
    }

    if (fullData.generics) {
      this.#addProperty(params, 'generic', fullData.generics);
    }
  }

  #addProperty(params, name, value) {
    // This follows the FHIR Parameters structure for lookup responses
    // Each property becomes a parameter with name='property' and sub-parameters
    const property = {
      name: 'property',
      part: [
        { name: 'code', valueCode: name },
        { name: 'value', valueString: value }
      ]
    };

    if (!params.parameter) {
      params.parameter = [];
    }
    params.parameter.push(property);
  }

  async #getFullConceptData(concept) {
    return new Promise((resolve, reject) => {
      let sql, params;

      if (concept.isPackage) {
        sql = `
          SELECT p.Code as PCode, pkg.Code, pkg.Code11, pkg.Active, pkg.Description,
                 p.TradeName, p.Suffix, p.Type, p.DoseForm, p.Route, p.Company, 
                 p.Category, p.Generics
          FROM NDCProducts p
          JOIN NDCPackages pkg ON p.NDCKey = pkg.ProductKey
          WHERE pkg.NDCKey = ?
        `;
        params = [concept.key];
      } else {
        sql = `
          SELECT Code, TradeName, Suffix, Type, DoseForm, Route, Company, 
                 Category, Generics, Active
          FROM NDCProducts 
          WHERE NDCKey = ?
        `;
        params = [concept.key];
      }

      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else if (!row) {
          resolve({});
        } else {
          const result = {
            active: row.Active === 1,
            tradeName: row.TradeName,
            suffix: row.Suffix,
            type: row.Type,
            doseForm: row.DoseForm,
            route: row.Route,
            company: row.Company,
            category: row.Category,
            generics: row.Generics
          };

          if (concept.isPackage) {
            result.productCode = row.PCode;
            result.code11 = row.Code11;
            result.originalCode = row.Code;
            result.display = this.#packageDisplay(row);
          } else {
            result.display = this.#productDisplay(row);
          }

          resolve(result);
        }
      });
    });
  }

  #productDisplay(row) {
    const tradeName = row.TradeName || '';
    const suffix = row.Suffix || '';
    if (suffix) {
      return `${tradeName} ${suffix} (product)`.trim();
    }
    return `${tradeName} (product)`.trim();
  }

  #packageDisplay(row) {
    const tradeName = row.TradeName || '';
    const suffix = row.Suffix || '';
    const description = row.Description || '';

    let display = tradeName;
    if (suffix) {
      display += ` ${suffix}`;
    }
    if (description) {
      display += `, ${description}`;
    }
    display += ' (package)';

    return display.replace(/\s+/g, ' ').trim();
  }

  async #ensureContext(opContext, code) {
    if (code == null) {
      return null;
    }
    if (typeof code === 'string') {
      const ctxt = await this.locate(opContext, code);
      if (ctxt.context == null) {
        throw new Error(ctxt.message);
      } else {
        return ctxt.context;
      }
    }
    if (code instanceof NdcConcept) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // Lookup methods
  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    // First try packages (both regular code and code11)
    const packageResult = await this.#locateInPackages(code);
    if (packageResult) {
      return { context: packageResult, message: null };
    }

    // Then try products
    const productResult = await this.#locateInProducts(code);
    if (productResult) {
      return { context: productResult, message: null };
    }

    return { context: null, message: `NDC Code '${code}' not found` };
  }

  async #locateInPackages(code) {
    return new Promise((resolve, reject) => {
      // Try both regular code and code11 formats
      const sql = `
        SELECT pkg.NDCKey, pkg.Code, pkg.Code11, p.TradeName, p.Suffix, pkg.Description,
               p.Code as ProductCode, pkg.Active
        FROM NDCPackages pkg
        JOIN NDCProducts p ON pkg.ProductKey = p.NDCKey
        WHERE pkg.Code = ? OR pkg.Code11 = ?
        LIMIT 1
      `;

      this.db.get(sql, [code, code], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const concept = new NdcConcept(code, this.#packageDisplay(row), true, row.NDCKey);
          concept.productCode = row.ProductCode;
          concept.code11 = row.Code11;
          concept.active = row.Active === 1;
          resolve(concept);
        } else {
          resolve(null);
        }
      });
    });
  }

  async #locateInProducts(code) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT NDCKey, Code, TradeName, Suffix, Active
        FROM NDCProducts
        WHERE Code = ?
        LIMIT 1
      `;

      this.db.get(sql, [code], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          const concept = new NdcConcept(code, this.#productDisplay(row), false, row.NDCKey);
          concept.active = row.Active === 1;
          resolve(concept);
        } else {
          resolve(null);
        }
      });
    });
  }

  // Filter support for code-type filtering
  async doesFilter(opContext, prop, op, value) {
    this._ensureOpContext(opContext);
    return prop === 'code-type' &&
      op === 'equal' &&
      ['10-digit', '11-digit', 'product'].includes(value);
  }

  async getPrepContext(opContext, iterate) {
    this._ensureOpContext(opContext);
    return { filters: [] };
  }

  async filter(opContext, filterContext, prop, op, value) {
    this._ensureOpContext(opContext);

    if (prop === 'code-type' && op === 'equal') {
      const filter = { type: 'code-type', value: value };
      filterContext.filters.push(filter);
      return filter;
    }

    throw new Error(`The filter "${prop} ${op} ${value}" is not supported for NDC`);
  }

  async executeFilters(opContext, filterContext) {
    this._ensureOpContext(opContext);
    return filterContext.filters;
  }

  async filterSize(opContext, filterContext, set) {
    this._ensureOpContext(opContext);

    return new Promise((resolve, reject) => {
      let sql;

      switch (set.value) {
        case 'product':
          sql = 'SELECT COUNT(*) as count FROM NDCProducts';
          break;
        case '10-digit':
          sql = "SELECT COUNT(*) as count FROM NDCPackages WHERE Code LIKE '%-%'";
          break;
        case '11-digit':
          sql = "SELECT COUNT(*) as count FROM NDCPackages WHERE Code NOT LIKE '%-%'";
          break;
        default:
          resolve(0);
          return;
      }

      this.db.get(sql, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  async filterMore(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    if (!set._iterator) {
      set._iterator = { offset: 0, hasMore: true };
    }
    return set._iterator.hasMore;
  }

  async filterConcept(opContext, filterContext, set) {
    this._ensureOpContext(opContext);

    if (!set._iterator) {
      set._iterator = { offset: 0, hasMore: true };
    }

    return new Promise((resolve, reject) => {
      let sql;

      switch (set.value) {
        case 'product':
          sql = 'SELECT NDCKey, Code, TradeName, Suffix, Active FROM NDCProducts LIMIT 1 OFFSET ?';
          break;
        case '10-digit':
          sql = `
            SELECT pkg.NDCKey, pkg.Code, p.TradeName, p.Suffix, pkg.Description, pkg.Active
            FROM NDCPackages pkg
            JOIN NDCProducts p ON pkg.ProductKey = p.NDCKey
            WHERE pkg.Code LIKE '%-%'
            LIMIT 1 OFFSET ?
          `;
          break;
        case '11-digit':
          sql = `
            SELECT pkg.NDCKey, pkg.Code, p.TradeName, p.Suffix, pkg.Description, pkg.Active
            FROM NDCPackages pkg
            JOIN NDCProducts p ON pkg.ProductKey = p.NDCKey
            WHERE pkg.Code NOT LIKE '%-%'
            LIMIT 1 OFFSET ?
          `;
          break;
        default:
          resolve(null);
          return;
      }

      this.db.get(sql, [set._iterator.offset], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          set._iterator.offset++;

          let concept;
          if (set.value === 'product') {
            concept = new NdcConcept(row.Code, this.#productDisplay(row), false, row.NDCKey);
          } else {
            concept = new NdcConcept(row.Code, this.#packageDisplay(row), true, row.NDCKey);
          }
          concept.active = row.Active === 1;

          resolve(concept);
        } else {
          set._iterator.hasMore = false;
          resolve(null);
        }
      });
    });
  }

  async filterLocate(opContext, filterContext, set, code) {
    this._ensureOpContext(opContext);

    // First locate the code normally
    const located = await this.locate(opContext, code);
    if (!located.context) {
      return located.message;
    }

    const concept = located.context;

    // Check if it matches the filter
    switch (set.value) {
      case 'product':
        return concept.isPackage ? 'Code is a package, not a product' : concept;
      case '10-digit':
        return (!concept.isPackage || !concept.code.includes('-')) ?
          'Code is not a 10-digit package code' : concept;
      case '11-digit':
        return (!concept.isPackage || concept.code.includes('-')) ?
          'Code is not an 11-digit package code' : concept;
      default:
        return 'Unknown filter type';
    }
  }

  async filterCheck(opContext, filterContext, set, concept) {
    this._ensureOpContext(opContext);

    if (!(concept instanceof NdcConcept)) {
      return false;
    }

    switch (set.value) {
      case 'product':
        return !concept.isPackage;
      case '10-digit':
        return concept.isPackage && concept.code.includes('-');
      case '11-digit':
        return concept.isPackage && !concept.code.includes('-');
      default:
        return false;
    }
  }

  async filterFinish(opContext, filterContext) {
    this._ensureOpContext(opContext);
    // Clean up any resources if needed
  }

  // Iterator methods - not supported for NDC
  async iterator(opContext, code) {
    this._ensureOpContext(opContext);
    return null; // No iteration support
  }

  async nextContext(opContext, iteratorContext) {
    this._ensureOpContext(opContext);
    throw new Error('Iteration not supported for NDC codes');
  }
}

class NdcServicesFactory {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.uses = 0;
    this._loaded = false;
    this._lookupTables = null;
    this._packageCount = null;
    this._productCount = null;
    this._version = null;
  }

  async #ensureLoaded() {
    if (!this._loaded) {
      await this.#loadData();
      this._loaded = true;
    }
  }

  async #loadData() {
    // Use temporary database connection for loading
    const tempDb = new sqlite3.Database(this.dbPath);

    try {
      // Load version
      this._version = await new Promise((resolve, reject) => {
        tempDb.get('SELECT Version FROM NDCVersion ORDER BY Version DESC LIMIT 1', (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.Version : 'unknown');
        });
      });

      // Initialize lookup tables
      this._lookupTables = {
        types: new Map(),
        organizations: new Map(),
        doseForms: new Map(),
        routes: new Map()
      };

      // Load lookup tables
      const tables = [
        { name: 'types', sql: 'SELECT NDCKey, Name FROM NDCProductTypes' },
        { name: 'organizations', sql: 'SELECT NDCKey, Name FROM NDCOrganizations' },
        { name: 'doseForms', sql: 'SELECT NDCKey, Name FROM NDCDoseForms' },
        { name: 'routes', sql: 'SELECT NDCKey, Name FROM NDCRoutes' }
      ];

      for (const table of tables) {
        await new Promise((resolve, reject) => {
          tempDb.all(table.sql, (err, rows) => {
            if (err) reject(err);
            else {
              const map = this._lookupTables[table.name];
              rows.forEach(row => map.set(row.NDCKey, row.Name));
              resolve();
            }
          });
        });
      }

      // Load counts
      this._packageCount = await new Promise((resolve, reject) => {
        tempDb.get('SELECT COUNT(NDCKey) as count FROM NDCPackages', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      this._productCount = await new Promise((resolve, reject) => {
        tempDb.get('SELECT COUNT(NDCKey) as count FROM NDCProducts', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

    } finally {
      tempDb.close();
    }
  }

  defaultVersion() {
    return this._version || 'unknown';
  }

  async build(opContext, supplements) {
    await this.#ensureLoaded();
    this.recordUse();

    // Create fresh database connection for this provider instance
    const db = new sqlite3.Database(this.dbPath);

    return new NdcServices(
      db,
      supplements,
      this._lookupTables,
      this._packageCount,
      this._productCount,
      this._version
    );
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  NdcServices,
  NdcServicesFactory,
  NdcConcept
};