const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const CBOR = require('cbor');
const pako = require('pako');
const base45 = require('base45');

// Import the FHIR Validator
const FhirValidator = require('fhir-validator-wrapper');

// Try to load vhl.js module, but don't fail if it doesn't exist
let vhlProcessor;
try {
  vhlProcessor = require('./vhl.js');
} catch (err) {
  console.log('vhl.js not found - VHL processing will be skipped');
  vhlProcessor = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Global validator instance
let fhirValidator = null;

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'application/fhir+json', limit: '10mb' }));
app.use(express.raw({ type: 'application/fhir+xml', limit: '10mb' }));
app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true
}));

// Database setup
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Helper function to convert PEM to JWK for COSE signing
function pemToJwk(pemCert, pemKey) {
  try {
    // Parse the private key
    const keyObject = crypto.createPrivateKey(pemKey);
    
    // Get the key details
    const keyDetails = keyObject.asymmetricKeyDetails;
    const keyType = keyObject.asymmetricKeyType;
    
    if (keyType !== 'ec') {
      throw new Error('Only EC (Elliptic Curve) keys are supported for COSE signing');
    }
    
    // Export the key in JWK format
    const jwk = keyObject.export({ format: 'jwk' });
    
    return jwk;
  } catch (error) {
    throw new Error(`Failed to convert PEM to JWK: ${error.message}`);
  }
}

async function createCOSESign1(payload, privateKeyJWK, kid) {
  const crypto = require('crypto');
  const CBOR = require('cbor');

  try {
    // Create COSE Sign1 structure manually using Node.js crypto
    // Protected headers map
    const protectedHeaders = new Map();
    protectedHeaders.set(1, -7);  // alg: ES256
    protectedHeaders.set(4, kid); // kid

    const protectedEncoded = CBOR.encode(protectedHeaders);

    // Sig_structure for COSE Sign1: ["Signature1", protected, external_aad, payload]
    const sigStructure = [
      "Signature1",           // context
      protectedEncoded,       // protected headers (bstr)
      Buffer.alloc(0),        // external_aad (bstr, empty)
      payload                 // payload (bstr)
    ];

    const sigStructureEncoded = CBOR.encode(sigStructure);

    // Convert JWK private key to Node.js KeyObject
    const privateKey = crypto.createPrivateKey({
      key: {
        kty: privateKeyJWK.kty,
        crv: privateKeyJWK.crv,
        x: privateKeyJWK.x,
        y: privateKeyJWK.y,
        d: privateKeyJWK.d
      },
      format: 'jwk'
    });

    // Sign using Node.js crypto (which we know works with Java)
    const signer = crypto.createSign('SHA256');
    signer.update(sigStructureEncoded);
    const signatureDER = signer.sign(privateKey);

    // Convert DER signature to raw r||s format for COSE
    const rawSignature = derToRaw(signatureDER);

    // Build COSE Sign1 message: [protected, unprotected, payload, signature]
    const coseSign1Array = [
      protectedEncoded,       // protected headers (bstr)
      new Map(),              // unprotected headers (empty map)
      payload,                // payload (bstr)
      rawSignature            // signature (bstr)
    ];

    // Add COSE Sign1 tag (18) and encode
    const taggedMessage = new CBOR.Tagged(18, coseSign1Array);
    const encoded = CBOR.encode(taggedMessage);

    return encoded;

  } catch (error) {
    console.error('COSE Sign1 creation error:', error);
    throw error;
  }
}

// Helper function to convert DER signature to raw r||s format
function derToRaw(derSignature) {
  let offset = 2; // Skip SEQUENCE tag and length

  // First INTEGER (r)
  offset++; // Skip INTEGER tag
  const rLen = derSignature[offset++];
  const r = Buffer.alloc(32);

  // Handle potential leading zero padding in DER
  const rStart = Math.max(0, rLen - 32);
  const rCopyLen = Math.min(rLen, 32);
  derSignature.copy(r, 32 - rCopyLen, offset + rStart, offset + rLen);
  offset += rLen;

  // Second INTEGER (s)
  offset++; // Skip INTEGER tag
  const sLen = derSignature[offset++];
  const s = Buffer.alloc(32);

  // Handle potential leading zero padding in DER
  const sStart = Math.max(0, sLen - 32);
  const sCopyLen = Math.min(sLen, 32);
  derSignature.copy(s, 32 - sCopyLen, offset + sStart, offset + sLen);

  return Buffer.concat([r, s]);
}

// Initialize FHIR Validator
async function initializeFhirValidator() {
  try {
    console.log('Initializing FHIR Validator...');
    
    // Get validator configuration from database
    const getConfigSql = 'SELECT key, value FROM config WHERE key LIKE "validator.%"';
    
    return new Promise((resolve, reject) => {
      db.all(getConfigSql, [], async (err, rows) => {
        if (err) {
          console.error('Failed to get validator config:', err);
          return reject(err);
        }
        
        // Parse configuration
        const config = {};
        const packages = [];
        
        rows.forEach(row => {
          if (row.key.startsWith('validator.package.')) {
            packages.push(row.value);
          } else {
            const key = row.key.replace('validator.', '');
            config[key] = row.value;
          }
        });
        
        // Set defaults
        const validatorConfig = {
          version: config.version || '4.0.1',
          txServer: config.txServer || 'http://tx.fhir.org/r4',
          txLog: config.txLog || './tx.log',
          port: parseInt(config.port || '8081'),
          igs: packages,
          timeout: 60000 // 60 second timeout for startup
        };
        
        console.log('Starting FHIR Validator with config:', validatorConfig);
        
        try {
          // Path to validator JAR in same directory
          const validatorJarPath = path.join(__dirname, 'validator_cli.jar');
          
          fhirValidator = new FhirValidator(validatorJarPath);
          await fhirValidator.start(validatorConfig);
          
          console.log('FHIR Validator started successfully');
          resolve();
        } catch (error) {
          console.error('Failed to start FHIR Validator:', error);
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('FHIR Validator initialization error:', error);
    throw error;
  }
}

// Initialize database with SHL tables and validator config
function initializeDatabase() {
  const createConfigTable = `
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  
  const createSHLTable = `
    CREATE TABLE IF NOT EXISTS SHL (
      uuid TEXT PRIMARY KEY,
      vhl BOOLEAN NOT NULL,
      expires_at DATETIME NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;
  
  const createSHLFilesTable = `
    CREATE TABLE IF NOT EXISTS SHLFiles (
      id TEXT PRIMARY KEY,
      shl_uuid TEXT NOT NULL,
      cnt TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shl_uuid) REFERENCES SHL (uuid) ON DELETE CASCADE
    )
  `;
  
  const createSHLViewsTable = `
    CREATE TABLE IF NOT EXISTS SHLViews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shl_uuid TEXT NOT NULL,
      recipient TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shl_uuid) REFERENCES SHL (uuid) ON DELETE CASCADE
    )
  `;
  
  db.run(createConfigTable, (err) => {
    if (err) {
      console.error('Error creating config table:', err.message);
    } else {
      console.log('Config table ready');
      
      // Insert default configurations
      const defaultConfigs = [
        ['shl_password', 'default123'],
        ['cert_pem', '-----BEGIN CERTIFICATE-----\nEXAMPLE_CERTIFICATE_DATA_HERE\n-----END CERTIFICATE-----'],
        ['key_pem', '-----BEGIN PRIVATE KEY-----\nEXAMPLE_PRIVATE_KEY_DATA_HERE\n-----END PRIVATE KEY-----'],
        ['kid', '11'],
        ['vhl.issuer', 'XXX'],
        // FHIR Validator configuration
        ['validator.version', '4.0.1'],
        ['validator.txServer', 'http://tx.fhir.org/r4'],
        ['validator.txLog', './tx.log'],
        ['validator.port', '8081'],
        // Default packages - add more as needed
        ['validator.package.1', 'hl7.fhir.us.core#6.0.0'],
        ['validator.package.2', 'hl7.fhir.uv.ips#1.1.0']
      ];
      
      defaultConfigs.forEach(([key, value]) => {
        db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', 
          [key, value], function(err) {
          if (!err && this.changes > 0) {
            console.log(`Default config set: ${key}`);
          }
        });
      });
      
      // Initialize FHIR Validator after database setup
      setTimeout(() => {
        initializeFhirValidator().catch(error => {
          console.error('Failed to initialize FHIR Validator:', error);
          console.log('Server will continue without validation capabilities');
        });
      }, 1000);
    }
  });
  
  db.run(createSHLTable, (err) => {
    if (err) {
      console.error('Error creating SHL table:', err.message);
    } else {
      console.log('SHL table ready');
    }
  });
  
  db.run(createSHLFilesTable, (err) => {
    if (err) {
      console.error('Error creating SHLFiles table:', err.message);
    } else {
      console.log('SHLFiles table ready');
    }
  });
  
  db.run(createSHLViewsTable, (err) => {
    if (err) {
      console.error('Error creating SHLViews table:', err.message);
    } else {
      console.log('SHLViews table ready');
    }
  });
}

// Utility function to generate UUID
function generateUUID() {
  return crypto.randomUUID();
}

// Cleanup expired SHL entries
function cleanupExpiredEntries() {
  const deleteSql = 'DELETE FROM SHL WHERE expires_at < datetime("now")';
  
  db.run(deleteSql, function(err) {
    if (err) {
      console.error('Cleanup error:', err.message);
    } else if (this.changes > 0) {
      console.log(`Cleaned up ${this.changes} expired SHL entries`);
    }
  });
}

// Schedule cleanup to run every hour at minute 0
cron.schedule('0 * * * *', () => {
  console.log('Running scheduled cleanup of expired SHL entries...');
  cleanupExpiredEntries();
});

// Routes

// FHIR Validation endpoint
app.post('/validate', async (req, res) => {
  console.log("validate! (1)");
  if (!fhirValidator || !fhirValidator.isRunning()) {
    return res.status(503).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: 'FHIR Validator service is not available'
      }]
    });
  }
  
  try {
    // Get content type to determine format
    const contentType = req.get('Content-Type') || 'application/fhir+json';

    // Get validation options from query parameters
    const options = {};
    
    if (req.query.profiles) {
      options.profiles = req.query.profiles.split(',');
    }
    if (req.query.resourceIdRule) {
      options.resourceIdRule = req.query.resourceIdRule;
    }
    if (req.query.anyExtensionsAllowed !== undefined) {
      options.anyExtensionsAllowed = req.query.anyExtensionsAllowed === 'true';
    }
    if (req.query.bpWarnings) {
      options.bpWarnings = req.query.bpWarnings;
    }
    if (req.query.displayOption) {
      options.displayOption = req.query.displayOption;
    }
    console.log("validate! (4)");

    // Validate the resource
    let resource;
    if (Buffer.isBuffer(req.body)) {
      resource = req.body;
    } else if (typeof req.body === 'string') {
      resource = req.body;
    } else {
      resource = JSON.stringify(req.body);
    }
      console.log("validate! (5)");

    const operationOutcome = await fhirValidator.validate(resource, options);
      console.log("validate! (6)");

    // Return the OperationOutcome
    res.json(operationOutcome);
      console.log("validate! (7)");

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: `Validation failed: ${error.message}`
      }]
    });
  }
});

// Validator status endpoint
app.get('/validate/status', (req, res) => {
  const status = {
    validatorRunning: fhirValidator ? fhirValidator.isRunning() : false,
    validatorInitialized: fhirValidator !== null
  };
  
  res.json(status);
});

// Load additional IG endpoint
app.post('/validate/loadig', async (req, res) => {
  if (!fhirValidator || !fhirValidator.isRunning()) {
    return res.status(503).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: 'FHIR Validator service is not available'
      }]
    });
  }
  
  const { packageId, version } = req.body;
  
  if (!packageId || !version) {
    return res.status(400).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'required',
        diagnostics: 'packageId and version are required'
      }]
    });
  }
  
  try {
    const result = await fhirValidator.loadIG(packageId, version);
    res.json(result);
  } catch (error) {
    console.error('Load IG error:', error);
    res.status(500).json({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'exception',
        diagnostics: `Failed to load IG: ${error.message}`
      }]
    });
  }
});

// SHL create endpoint
app.post('/shl/create', (req, res) => {
  const { vhl, password, days } = req.body;
  
  // Validation
  if (typeof vhl !== 'boolean' || !password) {
    return res.status(400).json({
      error: 'Invalid request. Required: vhl (boolean), password (string), days (number or string)'
    });
  }
  
  // Convert days to number if it's a string
  let daysNumber;
  if (typeof days === 'string') {
    daysNumber = parseInt(days, 10);
    if (isNaN(daysNumber)) {
      return res.status(400).json({
        error: 'days must be a valid number or numeric string'
      });
    }
  } else if (typeof days === 'number') {
    daysNumber = days;
  } else {
    return res.status(400).json({
      error: 'days is required and must be a number or numeric string'
    });
  }
  
  // Check password against config table
  const checkPasswordSql = 'SELECT value FROM config WHERE key = ?';
  
  db.get(checkPasswordSql, ['shl_password'], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row || row.value !== password) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Password matches, create new SHL entry
    const uuid = generateUUID();
    const newPassword = generateUUID();
    
    // Calculate expiry date using the converted number
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysNumber);
    const expiryDateString = expiryDate.toISOString();
    
    const insertSql = 'INSERT INTO SHL (uuid, vhl, expires_at, password) VALUES (?, ?, ?, ?)';
    
    db.run(insertSql, [uuid, vhl, expiryDateString, newPassword], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create SHL entry: '+err });
      }
      
      // Get the host from the request
      const host = req.get('host') || 'localhost:3000';
      const protocol = req.secure ? 'https' : 'http';
      
      res.status(201).json({
        uuid: uuid,
        pword: newPassword,
        link: `https://${host}/shl/access/${uuid}`
      });
    });
  });
});

// SHL upload endpoint
app.post('/shl/upload', (req, res) => {
  const { uuid, pword, files } = req.body;
  
  // Validation
  if (!uuid || !pword || !Array.isArray(files)) {
    return res.status(400).json({
      error: 'Invalid request. Required: uuid (string), pword (string), files (array)'
    });
  }
  
  // Validate files array structure
  for (const f of files) {
    if (!f.cnt || !f.type) {
      return res.status(400).json({
        error: 'Invalid file format. Each file must have cnt (base64) and type (mime type)'
      });
    }
  }
  
  // Check if SHL entry exists and password matches
  const checkSHLSql = 'SELECT vhl, password FROM SHL WHERE uuid = ?';
  
  db.get(checkSHLSql, [uuid], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'SHL entry not found' });
    }
    
    if (row.password !== pword) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Password matches, process file uploads
    // First, delete any existing files for this UUID
    const deleteExistingFilesSql = 'DELETE FROM SHLFiles WHERE shl_uuid = ?';
    
    db.run(deleteExistingFilesSql, [uuid], (err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to clear existing files' });
      }
      
      // Insert new files with their own UUIDs
      const insertPromises = files.map((f) => {
        return new Promise((resolve, reject) => {
          const fileId = generateUUID();
          const insertFileSql = 'INSERT INTO SHLFiles (id, shl_uuid, cnt, type) VALUES (?, ?, ?, ?)';
          
          db.run(insertFileSql, [fileId, uuid, f.cnt, f.type], function(err) {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      });
      
      Promise.all(insertPromises)
        .then(() => {
          // Files uploaded successfully
          res.json({ msg: 'ok' });
        })
        .catch((error) => {
          console.error('File upload error:', error);
          res.status(500).json({ error: 'Failed to upload files' });
        });
    });
  });
});

// Helper function for the shared access logic
function handleSHLAccess(req, res) {
  const { uuid } = req.params;
  
  // For GET requests, set recipient to 'anonymous' and embeddedLengthMax to undefined
  // For POST requests, get from request body
  let recipient, embeddedLengthMax;
  
  if (req.method === 'GET') {
    recipient = 'anonymous';
    embeddedLengthMax = undefined;
  } else {
    ({ recipient, embeddedLengthMax } = req.body);
    
    // Validation - recipient is required for POST
    if (!recipient) {
      return res.status(400).json({
        error: 'recipient is required in request body'
      });
    }
  }
  
  // Get client IP address
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
    (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
    req.headers['x-forwarded-for'] || 'unknown';
  
  // Check if SHL entry exists and is not expired
  const checkSHLSql = 'SELECT uuid, vhl FROM SHL WHERE uuid = ? AND expires_at > datetime("now")';
  
  db.get(checkSHLSql, [uuid], (err, shlRow) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!shlRow) {
      return res.status(404).json({ error: 'SHL entry not found or expired' });
    }
    
    // Log the access in SHLViews table
    const logAccessSql = 'INSERT INTO SHLViews (shl_uuid, recipient, ip_address) VALUES (?, ?, ?)';
    
    db.run(logAccessSql, [uuid, recipient, clientIP], function(logErr) {
      if (logErr) {
        console.error('Failed to log SHL access:', logErr.message);
        // Continue processing even if logging fails
      }
      
      // Get all files for this SHL entry
      const getFilesSql = 'SELECT id, cnt, type FROM SHLFiles WHERE shl_uuid = ?';
      
      db.all(getFilesSql, [uuid], (err, fileRows) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to retrieve files' });
        }
        
        const host = req.get('host') || 'localhost:3000';
        const protocol = req.secure ? 'https' : 'http';
        const maxLength = embeddedLengthMax ? parseInt(embeddedLengthMax) : undefined;
        
        const files = fileRows.map(file => {
          const fileResponse = {
            contentType: file.type,
            location: `${protocol}://${host}/shl/file/${file.id}`
          };
          
          // Add embedded content if no max length specified or content is under the limit
          if (maxLength === undefined || file.cnt.length <= maxLength) {
            fileResponse.embedded = file.cnt;
          }
          
          return fileResponse;
        });
        
        const standardResponse = { files };
        
        // If vhl is true and vhl processor is available, use it
        if (shlRow.vhl && vhlProcessor) {
          try {
            const vhlResponse = vhlProcessor.processVHL(host, uuid, standardResponse);
            res.json(vhlResponse);
          } catch (vhlErr) {
            console.error('VHL processing error:', vhlErr.message);
            // Fall back to standard response if VHL processing fails
            res.json(standardResponse);
          }
        } else {
          // Standard response for non-VHL or when vhl.js not available
          res.json(standardResponse);
        }
      });
    });
  });
}

// SHL access endpoint - now supports both GET and POST
app.get('/shl/access/:uuid', handleSHLAccess);
app.post('/shl/access/:uuid', handleSHLAccess);

// SHL file endpoint - serves individual files
app.get('/shl/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  
  // Get client IP address
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
    (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
    req.headers['x-forwarded-for'] || 'unknown';
  
  const getFileSql = 'SELECT id, shl_uuid, cnt, type FROM SHLFiles WHERE id = ?';
  
  db.get(getFileSql, [fileId], (err, fileRow) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!fileRow) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Log the file access in SHLViews table for both master UUID and file UUID
    const logMasterAccessSql = 'INSERT INTO SHLViews (shl_uuid, recipient, ip_address) VALUES (?, ?, ?)';
    const logFileAccessSql = 'INSERT INTO SHLViews (shl_uuid, recipient, ip_address) VALUES (?, ?, ?)';
    
    // Log access for master SHL UUID
    db.run(logMasterAccessSql, [fileRow.shl_uuid, null, clientIP], function(logErr) {
      if (logErr) {
        console.error('Failed to log master SHL file access:', logErr.message);
      }
    });
    
    // Log access for specific file UUID
    db.run(logFileAccessSql, [fileRow.id, null, clientIP], function(logErr) {
      if (logErr) {
        console.error('Failed to log file-specific access:', logErr.message);
      }
    });
    
    // Decode base64 content and serve with proper content type
    try {
      const fileBuffer = Buffer.from(fileRow.cnt, 'base64');
      res.set('Content-Type', 'application/jose');
      res.send(fileBuffer);
    } catch (decodeErr) {
      res.status(500).json({ error: 'Failed to decode file content' });
    }
  });
});

// SHL sign endpoint
// SHL sign endpoint - enhanced to return all intermediate steps
app.post('/shl/sign', async (req, res) => {
  const { url } = req.body;
  
  // Validation
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'url is required and must be a string'
    });
  }
  
  try {
    // Get issuer, certificate PEM, private key PEM, and KID from config table
    const getConfigSql = 'SELECT key, value FROM config WHERE key IN (?, ?, ?, ?)';
    
    db.all(getConfigSql, ['vhl.issuer', 'cert_pem', 'key_pem', 'kid'], async (err, configRows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error retrieving config' });
      }
      
      // Parse config values
      let issuer = 'XX';
      let certPem = null;
      let keyPem = null;
      let kid = '11'; // Default fallback
      
      configRows.forEach(row => {
        if (row.key === 'vhl.issuer') {
          issuer = row.value;
        } else if (row.key === 'cert_pem') {
          certPem = row.value;
        } else if (row.key === 'key_pem') {
          keyPem = row.value;
        } else if (row.key === 'kid') {
          kid = row.value;
        }
      });
      
      if (!certPem || !keyPem) {
        return res.status(500).json({ error: 'Certificate PEM or private key PEM not found in config' });
      }
      
      if (!kid) {
        return res.status(500).json({ error: 'KID not found in config' });
      }
      
      try {
        // Convert PEM to JWK for COSE signing
        const jwk = pemToJwk(certPem, keyPem);
        
        // Step 1: Wrap the URL in the specified payload structure with issuer
        const payload = {
          "1": issuer,
          "-260": {
            "5": [url]
          }
        };

        // Step 2: CBOR encode the object to bytes
        const cborEncoded = CBOR.encode(payload);

        // Step 3: COSE sign the bytes using JWK converted from PEM
        const coseSigned = await createCOSESign1(cborEncoded, jwk, kid);

        // Step 4: Deflate the signed bytes
        const deflated = pako.deflate(coseSigned);
        
        // Step 5: Base45 encode the deflated bytes
        const base45Encoded = base45.encode(deflated);

        // Create JWK for response (excluding private key components)
        const publicJwk = {
          kty: jwk.kty,
          crv: jwk.crv,
          x: jwk.x,
          y: jwk.y
          // Explicitly excluding 'd' (private key)
        };

        // Return the result with all intermediate steps, for the ICVP step
        res.json({
          signature: base45Encoded,
          steps: {
            input: {
              url: url,
              issuer: issuer,
              kid: kid
            },
            step1_payload: payload,
            step1_payload_json: JSON.stringify(payload),
            step2_cbor_encoded: Array.from(cborEncoded), // Convert Buffer to array for JSON serialization
            step2_cbor_encoded_hex: cborEncoded.toString('hex'),
            step2_cbor_encoded_base64: cborEncoded.toString('base64'),
            step3_cose_signed: Array.from(coseSigned),
            step3_cose_signed_hex: coseSigned.toString('hex'),
            step3_cose_signed_base64: coseSigned.toString('base64'),
            step4_deflated: Array.from(deflated),
            step4_deflated_hex: Buffer.from(deflated).toString('hex'),
            step4_deflated_base64: Buffer.from(deflated).toString('base64'),
            step5_base45_encoded: base45Encoded,
            crypto_info: {
              public_key_jwk: publicJwk,
              certificate_pem: certPem,
              algorithm: "ES256",
              curve: "P-256"
            },
            sizes: {
              original_url_bytes: Buffer.byteLength(url, 'utf8'),
              payload_json_bytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
              cbor_encoded_bytes: cborEncoded.length,
              cose_signed_bytes: coseSigned.length,
              deflated_bytes: deflated.length,
              base45_encoded_bytes: Buffer.byteLength(base45Encoded, 'utf8')
            }
          }
        });
        
      } catch (error) {
        console.error('SHL sign processing error:', error);
        res.status(500).json({
          error: 'Failed to sign URL: ' + error.message
        });
      }
    });
    
  } catch (error) {
    console.error('SHL sign error:', error);
    res.status(500).json({
      error: 'Failed to sign URL'
    });
  }
});

// Configuration management endpoints (optional - for runtime config updates)
app.get('/config/:key', (req, res) => {
  const { key } = req.params;
  
  // Only allow reading certain config keys for security
  const allowedKeys = ['vhl.issuer', 'kid', 'validator.version', 'validator.txServer', 'validator.port'];
  
  if (!allowedKeys.includes(key)) {
    return res.status(403).json({ error: 'Access to this config key is not allowed' });
  }
  
  const getConfigSql = 'SELECT value FROM config WHERE key = ?';
  
  db.get(getConfigSql, [key], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Config key not found' });
    }
    
    res.json({
      key: key,
      value: row.value
    });
  });
});

app.put('/config/:key', (req, res) => {
  const { key } = req.params;
  const { value, password } = req.body;
  
  // Only allow updating certain config keys for security
  const allowedKeys = ['vhl.issuer', 'kid', 'validator.version', 'validator.txServer', 'validator.port'];
  
  if (!allowedKeys.includes(key)) {
    return res.status(403).json({ error: 'Updating this config key is not allowed' });
  }
  
  if (!value || !password) {
    return res.status(400).json({ error: 'value and password are required' });
  }
  
  // Check password against config table
  const checkPasswordSql = 'SELECT value FROM config WHERE key = ?';
  
  db.get(checkPasswordSql, ['shl_password'], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!row || row.value !== password) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Update the config value
    const updateConfigSql = 'INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)';
    
    db.run(updateConfigSql, [key, value], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to update config' });
      }
      
      res.json({
        message: 'Config updated successfully',
        key: key,
        value: value
      });
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: 'Connected',
    validator: fhirValidator ? (fhirValidator.isRunning() ? 'Running' : 'Stopped') : 'Not initialized'
  });
});

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  
  // Stop FHIR validator
  if (fhirValidator) {
    try {
      console.log('Stopping FHIR validator...');
      await fhirValidator.stop();
      console.log('FHIR validator stopped');
    } catch (error) {
      console.error('Error stopping FHIR validator:', error);
    }
  }
  
  // Close database
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Validation endpoint: http://localhost:${PORT}/validate`);
  console.log(`Validator status: http://localhost:${PORT}/validate/status`);
});