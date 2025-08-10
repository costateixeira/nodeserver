const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const assert = require('assert');
const CodeSystem = require('../library/codesystem');
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

class UniiDataMigrator {
  /**
   * Migrates UNII data from tab-delimited source file to SQLite database
   * @param {string} sourceFile - Path to tab-delimited source file
   * @param {string} destFile - Path to destination SQLite database file
   * @param {string} version - Version string to store in database
   * @param {boolean} verbose - Whether to log progress messages
   * @returns {Promise<void>}
   */
  async migrate(sourceFile, destFile, version = 'unknown', verbose = true) {
    if (verbose) console.log('Starting UNII data migration...');

    // Ensure destination directory exists
    const destDir = path.dirname(destFile);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Remove existing database file if it exists
    if (fs.existsSync(destFile)) {
      fs.unlinkSync(destFile);
    }

    // Create new SQLite database
    const db = new sqlite3.Database(destFile);

    try {
      // Create tables
      await this.#createTables(db, version, verbose);

      // Process source file
      await this.#processSourceFile(db, sourceFile, verbose);

      if (verbose) console.log('UNII data migration completed successfully');
    } finally {
      await this.#closeDatabase(db, verbose);
    }
  }

  /**
   * Creates the required database tables
   * @private
   */
  async #createTables(db, version, verbose = true) {
    if (verbose) console.log('Creating database tables...');

    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Create Unii table
        db.run(`
            CREATE TABLE Unii (
                                  UniiKey INTEGER NOT NULL PRIMARY KEY,
                                  Code TEXT(20) NOT NULL,
                                  Display TEXT(255) NULL
            )
        `, (err) => {
          if (err) return reject(err);
        });

        // Create UniiDesc table
        db.run(`
            CREATE TABLE UniiDesc (
                                      UniiDescKey INTEGER NOT NULL PRIMARY KEY,
                                      UniiKey INTEGER NOT NULL,
                                      Type TEXT(20) NOT NULL,
                                      Display TEXT(255) NULL
            )
        `, (err) => {
          if (err) return reject(err);
        });

        // Create UniiVersion table
        db.run(`
            CREATE TABLE UniiVersion (
                                         Version TEXT(20) NOT NULL
            )
        `, (err) => {
          if (err) return reject(err);
        });

        // Insert version
        db.run('INSERT INTO UniiVersion (Version) VALUES (?)', [version], (err) => {
          if (err) return reject(err);
          if (verbose) console.log('Database tables created');
          resolve();
        });
      });
    });
  }

  /**
   * Processes the tab-delimited source file
   * @private
   */
  async #processSourceFile(db, sourceFile, verbose = true) {
    if (verbose) console.log('Processing source file:', sourceFile);

    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Source file not found: ${sourceFile}`);
    }

    // Read all lines first using streaming (for memory efficiency)
    const lines = [];
    const fileStream = fs.createReadStream(sourceFile);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    await new Promise((resolve, reject) => {
      rl.on('line', (line) => {
        lines.push(line);
      });
      rl.on('close', resolve);
      rl.on('error', reject);
    });

    if (lines.length === 0) {
      throw new Error('Source file is empty');
    }

    if (verbose) console.log(`Read ${lines.length} lines, processing...`);

    // Track processed codes and auto-increment keys
    const codeMap = new Map(); // code -> UniiKey
    let lastUniiKey = 0;
    let lastUniiDescKey = 0;
    let processedLines = 0;

    const BATCH_SIZE = 1000;

    // Process batches sequentially
    for (let batchStart = 1; batchStart < lines.length; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, lines.length);

      await new Promise((resolve, reject) => {
        const insertUnii = db.prepare('INSERT INTO Unii (UniiKey, Code, Display) VALUES (?, ?, ?)');
        const insertUniiDesc = db.prepare('INSERT INTO UniiDesc (UniiDescKey, UniiKey, Type, Display) VALUES (?, ?, ?, ?)');

        db.serialize(() => {
          db.run('BEGIN TRANSACTION');

          for (let i = batchStart; i < batchEnd; i++) {
            const line = lines[i].trim();
            if (!line) continue; // Skip empty lines

            const cols = line.split('\t');

            // Need at least 3 columns (Display, Type, Code)
            if (cols.length < 3) {
              if (verbose) console.warn(`Skipping line ${i + 1}: insufficient columns`);
              continue;
            }

            const display = cols[0] || '';
            const type = cols[1] || '';
            const code = cols[2] || '';

            if (!code) {
              if (verbose) console.warn(`Skipping line ${i + 1}: empty UNII code`);
              continue;
            }

            let isnew = false;
            // Get or create UniiKey for this code
            let uniiKey = codeMap.get(code);
            if (!uniiKey) {
              isnew = true;
              lastUniiKey++;
              uniiKey = lastUniiKey;
              insertUnii.run(uniiKey, code, cols[3]);
              codeMap.set(code, uniiKey);
            }

            lastUniiDescKey++;
            insertUniiDesc.run(lastUniiDescKey, uniiKey, type, display);

            processedLines++;
          }

          db.run('COMMIT', (err) => {
            if (err) return reject(err);

            insertUnii.finalize((err) => {
              if (err) return reject(err);
              insertUniiDesc.finalize((err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          });
        });
      });

      if (processedLines % 10000 === 0) {
        console.log(`Processed ${processedLines} lines...`);
      }
    }

    if (verbose) {
      console.log(`Processing completed. Total lines processed: ${processedLines}`);
      console.log(`Unique UNII codes: ${codeMap.size}`);
      console.log(`Total descriptions: ${lastUniiDescKey}`);
    }
  }

  /**
   * Closes the database connection
   * @private
   */
  async #closeDatabase(db, verbose = true) {
    return new Promise((resolve) => {
      db.close((err) => {
        if (err && verbose) {
          console.error('Error closing database:', err);
        }
        resolve();
      });
    });
  }
}

module.exports = {
  UniiDataMigrator,
  UniiServices,
  UniiServicesFactory,
  UniiConcept
};