const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const { CodeSystem } = require('../library/codesystem');
const { CodeSystemProvider, Designation } = require('./cs-api');

class UniiConcept {
  constructor(code, display) {
    this.code = code;
    this.display = display;
    this.others = []; // Array of other descriptions from UniiDesc table
  }
}

class UniiServices extends CodeSystemProvider {
  constructor(db, supplements) {
    super(supplements);
    this.db = db;
    this._version = null;
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
    return 'http://fdasis.nlm.nih.gov'; // UNII system URI
  }

  async version() {
    if (this._version === null) {
      this._version = await this.#getVersion();
    }
    return this._version;
  }

  description() {
    return 'UNII Codes';
  }

  totalCount() {
    return -1; // Database-driven, use count query if needed
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
    if (ctxt.display && opContext.langs.isEnglishOrNothing()) {
      return ctxt.display.trim();
    }
    let disp = this._displayFromSupplements(opContext, ctxt.code);
    if (disp) {
      return disp;
    }
    return ctxt.display ? ctxt.display.trim() : '';
  }

  async definition(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return null; // No definitions provided
  }

  async isAbstract(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // No abstract concepts
  }

  async isInactive(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // No inactive concepts
  }

  async isDeprecated(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // No deprecated concepts
  }

  async designations(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    let designations = [];
    if (ctxt != null) {
      // Add main display
      if (ctxt.display) {
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), ctxt.display.trim()));
      }
      // Add other descriptions
      ctxt.others.forEach(other => {
        if (other && other.trim()) {
          designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), other.trim()));
        }
      });
      designations.push(...this._listSupplementDesignations(ctxt.code));
    }
    return designations;
  }

  async #ensureContext(opContext, code) {
    if (code == null) {
      return code;
    }
    if (typeof code === 'string') {
      const ctxt = await this.locate(opContext, code);
      if (ctxt.context == null) {
        throw new Error(ctxt.message);
      } else {
        return ctxt.context;
      }
    }
    if (code instanceof UniiConcept) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // Database helper methods
  async #getVersion() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT Version FROM UniiVersion', (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.Version : 'unknown');
      });
    });
  }

  async #getTotalCount() {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM Unii', (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  // Lookup methods
  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    return new Promise((resolve, reject) => {
      // First query: get main concept
      this.db.get('SELECT UniiKey, Display FROM Unii WHERE Code = ?', [code], (err, row) => {
        if (err) {
          return reject(err);
        }

        if (!row) {
          return resolve({ context: null, message: `UNII Code '${code}' not found` });
        }

        const concept = new UniiConcept(code, row.Display);
        const uniiKey = row.UniiKey;

        // Second query: get all descriptions
        this.db.all('SELECT Display FROM UniiDesc WHERE UniiKey = ?', [uniiKey], (err, rows) => {
          if (err) return reject(err);

          // Add unique descriptions to others array
          rows.forEach(descRow => {
            const desc = descRow.Display;
            if (desc && desc.trim() && !concept.others.includes(desc.trim())) {
              concept.others.push(desc.trim());
            }
          });

          resolve({ context: concept, message: null });
        });
      });
    });
  }

  // Iterator methods - not supported
  async iterator(opContext, code) {
    this._ensureOpContext(opContext);
    return { index: 0, total: 0 }; // No iteration support
  }

  async nextContext(opContext, iteratorContext) {
    this._ensureOpContext(opContext);
    throw new Error('Iteration not supported for UNII codes');
  }

}

class UniiServicesFactory {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.uses = 0;
  }

  defaultVersion() {
    return 'unknown';
  }

  build(opContext, supplements) {
    this.uses++;

    return new UniiServices(new sqlite3.Database(this.dbPath), supplements);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }

}

module.exports = {
  UniiServices,
  UniiServicesFactory,
  UniiConcept
};