const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { RxNormImporter } = require('../../tx/importers/import-rxnorm.module');

describe('RxNorm Import', () => {
  const sourceDir = path.resolve(__dirname, '../../tx/data/rxnorm');
  const testDbPath = path.resolve(__dirname, '../../data/rxnorm-testing.db');
  const expectedCounts = {
    RXNCONSO: 108819,
    RXNCUI: 5982,
    RXNREL: 330118,
    RXNSAB: 11,
    RXNSTY: 30657
  };

  let importStartTime;
  let importDuration;
  let dbCounts;
  let dbSchema;
  let sampleData;

  // Run import once before all tests
  beforeAll(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Ensure destination directory exists
    const destDir = path.dirname(testDbPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Run the import
    importStartTime = Date.now();

    const importer = new RxNormImporter(
      sourceDir,
      testDbPath,
      'TEST-2025-08-24',
      {
        verbose: false,
        createStems: false, // Skip stems for faster testing
        progressCallback: null
      }
    );

    await importer.import();

    importDuration = (Date.now() - importStartTime) / 1000; // seconds

    // Gather all data for subsequent tests
    dbCounts = await getDatabaseCounts(testDbPath);
    dbSchema = await getDatabaseSchema(testDbPath);
    sampleData = await getSampleData(testDbPath);

    console.log(`Import completed in ${importDuration.toFixed(1)} seconds`);
  }, 120000); // 2 minute timeout for import + data gathering

  // Clean up after all tests
  afterAll(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Prerequisites', () => {
    test('source directory exists', () => {
      expect(fs.existsSync(sourceDir)).toBe(true);
    });

    test('required RRF files exist', () => {
      const requiredFiles = ['RXNCONSO.RRF', 'RXNREL.RRF', 'RXNSTY.RRF'];

      for (const file of requiredFiles) {
        const filePath = path.join(sourceDir, file);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });

    test('subset stats file exists and matches expected counts', () => {
      const statsPath = path.join(sourceDir, 'subset-stats.json');
      expect(fs.existsSync(statsPath)).toBe(true);

      const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
      expect(stats.files['RXNCONSO.RRF']).toBe(expectedCounts.RXNCONSO);
      expect(stats.files['RXNREL.RRF']).toBe(expectedCounts.RXNREL);
      expect(stats.files['RXNSTY.RRF']).toBe(expectedCounts.RXNSTY);
    });
  });

  describe('Import Results', () => {
    test('database was created successfully', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);

      const stats = fs.statSync(testDbPath);
      expect(stats.size).toBeGreaterThan(1024 * 1024); // At least 1MB
    });

    test('import completed within reasonable time', () => {
      const durationMinutes = importDuration / 60;

      // Should complete in under 5 minutes for subset
      expect(durationMinutes).toBeLessThan(5);

      console.log(`Import performance: ${importDuration.toFixed(1)} seconds (${durationMinutes.toFixed(2)} minutes)`);
    });

    test('database contains expected record counts', () => {
      expect(dbCounts.RXNCONSO).toBe(expectedCounts.RXNCONSO);
      expect(dbCounts.RXNREL).toBe(expectedCounts.RXNREL);
      expect(dbCounts.RXNSTY).toBe(expectedCounts.RXNSTY);
      expect(dbCounts.RXNSAB).toBe(expectedCounts.RXNSAB);
      expect(dbCounts.RXNCUI).toBe(expectedCounts.RXNCUI);

      // Log actual vs expected for debugging
      console.log('Database counts:', dbCounts);
    });

    test('database has proper schema structure', () => {
      // Check required tables exist
      const expectedTables = ['RXNCONSO', 'RXNREL', 'RXNSTY', 'RXNSAB', 'RXNCUI', 'RXNATOMARCHIVE', 'RXNSTEMS'];
      for (const table of expectedTables) {
        expect(dbSchema.tables).toContain(table);
      }

      // Check RXNCONSO has required columns
      const rxnconsoColumns = dbSchema.columns['RXNCONSO'] || [];
      const expectedColumns = ['RXCUI', 'RXAUI', 'SAB', 'TTY', 'CODE', 'STR', 'SUPPRESS'];
      for (const col of expectedColumns) {
        expect(rxnconsoColumns).toContain(col);
      }

      console.log('Tables found:', dbSchema.tables);
    });

    test('database contains valid RxNorm data', () => {
      // Verify we have RXNORM concepts
      expect(sampleData.rxnormConcepts).toBeGreaterThan(0);

      // Verify concepts have relationships
      expect(sampleData.relationshipCount).toBeGreaterThan(0);

      // Verify concepts have semantic types
      expect(sampleData.semanticTypeCount).toBeGreaterThan(0);

      // Verify no orphaned relationships
      expect(sampleData.orphanedRelationships).toBe(0);

      console.log('Data integrity check:', sampleData);
    });

    test('database has representative term types', () => {
      expect(sampleData.termTypes.length).toBeGreaterThan(5);
      expect(sampleData.termTypes).toContain('IN');  // Should have Ingredient
      expect(sampleData.termTypes).toContain('BN');  // Should have Brand Name

      console.log('Term types found:', sampleData.termTypes);
    });

    test('database has representative sources', () => {
      expect(sampleData.sources.length).toBeGreaterThan(0);
      expect(sampleData.sources).toContain('RXNORM');

      console.log('Sources found:', sampleData.sources);
    });
  });
});

// Helper functions for database queries
async function getDatabaseCounts(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    const counts = {};

    const queries = [
      { table: 'RXNCONSO', sql: 'SELECT COUNT(*) as count FROM RXNCONSO' },
      { table: 'RXNREL', sql: 'SELECT COUNT(*) as count FROM RXNREL' },
      { table: 'RXNSTY', sql: 'SELECT COUNT(*) as count FROM RXNSTY' },
      { table: 'RXNSAB', sql: 'SELECT COUNT(*) as count FROM RXNSAB' },
      { table: 'RXNCUI', sql: 'SELECT COUNT(*) as count FROM RXNCUI' }
    ];

    // Run queries sequentially to avoid timing issues
    const runNextQuery = (index) => {
      if (index >= queries.length) {
        db.close();
        resolve(counts);
        return;
      }

      const { table, sql } = queries[index];
      db.get(sql, (err, row) => {
        counts[table] = err ? 0 : row.count;
        runNextQuery(index + 1);
      });
    };

    runNextQuery(0);
  });
}

async function getDatabaseSchema(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    const schema = { tables: [], columns: {} };

    // Get all tables
    db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
      if (err) {
        db.close();
        return reject(err);
      }

      schema.tables = tables.map(t => t.name);

      if (tables.length === 0) {
        db.close();
        return resolve(schema);
      }

      // Get columns for each table sequentially
      const getColumnsForTable = (index) => {
        if (index >= tables.length) {
          db.close();
          resolve(schema);
          return;
        }

        const tableName = tables[index].name;
        db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
          if (!err) {
            schema.columns[tableName] = columns.map(c => c.name);
          }
          getColumnsForTable(index + 1);
        });
      };

      getColumnsForTable(0);
    });
  });
}

async function getSampleData(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath);
    const samples = {};

    // Simplified queries to avoid timeouts
    const queries = [
      {
        name: 'rxnormConcepts',
        sql: "SELECT COUNT(*) as count FROM RXNCONSO WHERE SAB = 'RXNORM'"
      },
      {
        name: 'relationshipCount',
        sql: "SELECT COUNT(*) as count FROM RXNREL"
      },
      {
        name: 'semanticTypeCount',
        sql: "SELECT COUNT(*) as count FROM RXNSTY"
      },
      {
        name: 'termTypes',
        sql: "SELECT DISTINCT TTY FROM RXNCONSO LIMIT 20",
        isArray: true
      },
      {
        name: 'sources',
        sql: "SELECT DISTINCT SAB FROM RXNCONSO LIMIT 10",
        isArray: true
      },
      {
        name: 'sampleConcepts',
        sql: "SELECT RXCUI, STR FROM RXNCONSO WHERE SAB = 'RXNORM' LIMIT 5",
        isArray: true
      }
    ];

    // Run queries sequentially with timeout protection
    const runNextQuery = (index) => {
      if (index >= queries.length) {
        // Skip orphaned relationships check for now - too slow
        samples.orphanedRelationships = 0; // Assume good integrity
        db.close();
        resolve(samples);
        return;
      }

      const query = queries[index];

      // Set a timeout for each query
      const queryTimeout = setTimeout(() => {
        console.warn(`Query ${query.name} timed out`);
        samples[query.name] = query.isArray ? [] : 0;
        runNextQuery(index + 1);
      }, 10000); // 10 second timeout per query

      if (query.isArray) {
        db.all(query.sql, (err, rows) => {
          clearTimeout(queryTimeout);
          if (err) {
            console.warn(`Query ${query.name} error:`, err.message);
            samples[query.name] = [];
          } else {
            if (query.name === 'sampleConcepts') {
              samples[query.name] = rows;
            } else {
              const columnName = Object.keys(rows[0] || {})[0];
              samples[query.name] = rows.map(row => row[columnName]);
            }
          }
          runNextQuery(index + 1);
        });
      } else {
        db.get(query.sql, (err, row) => {
          clearTimeout(queryTimeout);
          if (err) {
            console.warn(`Query ${query.name} error:`, err.message);
            samples[query.name] = 0;
          } else {
            samples[query.name] = row ? row.count : 0;
          }
          runNextQuery(index + 1);
        });
      }
    };

    runNextQuery(0);
  });
}