const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const CBOR = require('cbor');
const cose = require('cose-js');
const pako = require('pako');
const base45 = require('base45');

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

// Middleware
app.use(express.json());
app.use(cors());

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

// Initialize database with SHL tables
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
      // Insert default password if not exists
      db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', 
        ['shl_password', 'default123'], function(err) {
        if (!err) {
          if (this.changes > 0) {
            console.log('Default SHL password set to: default123');
          } else {
            console.log('SHL password already configured');
          }
        }
      });
      // Insert default certificate PEM if not exists
      db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', 
        ['cert_pem', '-----BEGIN CERTIFICATE-----\nEXAMPLE_CERTIFICATE_DATA_HERE\n-----END CERTIFICATE-----'], function(err) {
        if (!err) {
          if (this.changes > 0) {
            console.log('Default certificate PEM added to config');
          } else {
            console.log('Certificate PEM already configured');
          }
        }
      });
      // Insert default private key PEM if not exists
      db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', 
        ['key_pem', '-----BEGIN PRIVATE KEY-----\nEXAMPLE_PRIVATE_KEY_DATA_HERE\n-----END PRIVATE KEY-----'], function(err) {
        if (!err) {
          if (this.changes > 0) {
            console.log('Default private key PEM added to config');
          } else {
            console.log('Private key PEM already configured');
          }
        }
      });
      // Insert default VHL issuer if not exists
      db.run('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)', 
        ['vhl.issuer', 'XXX'], function(err) {
        if (!err) {
          if (this.changes > 0) {
            console.log('Default VHL issuer set to: XXX');
          } else {
            console.log('VHL issuer already configured');
          }
        }
      });
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
        link: `${protocol}://${host}/shl/access/${uuid}`
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

// SHL access endpoint
app.post('/shl/access/:uuid', (req, res) => {
  const { uuid } = req.params;
  const { recipient, embeddedLengthMax } = req.body;
  
  // Validation - recipient is required
  if (!recipient) {
    return res.status(400).json({
      error: 'recipient is required in request body'
    });
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
});

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
      res.set('Content-Type', fileRow.type);
      res.send(fileBuffer);
    } catch (decodeErr) {
      res.status(500).json({ error: 'Failed to decode file content' });
    }
  });
});

// SHL sign endpoint
app.post('/shl/sign', async (req, res) => {
  const { url } = req.body;
  
  // Validation
  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'url is required and must be a string'
    });
  }
  
  try {
    // Get issuer, certificate PEM, and private key PEM from config table
    const getConfigSql = 'SELECT key, value FROM config WHERE key IN (?, ?, ?)';
    
    db.all(getConfigSql, ['vhl.issuer', 'cert_pem', 'key_pem'], async (err, configRows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error retrieving config' });
      }
      
      // Parse config values
      let issuer = 'XXX';
      let certPem = null;
      let keyPem = null;
      
      configRows.forEach(row => {
        if (row.key === 'vhl.issuer') {
          issuer = row.value;
        } else if (row.key === 'cert_pem') {
          certPem = row.value;
        } else if (row.key === 'key_pem') {
          keyPem = row.value;
        }
      });
      
      if (!certPem || !keyPem) {
        return res.status(500).json({ error: 'Certificate PEM or private key PEM not found in config' });
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
        const headers = {
          p: { alg: 'ES256' },
          u: { kid: '11' }
        };
        
        const signer = {
          key: jwk
        };
        
        const coseSigned = await cose.sign.create(headers, cborEncoded, signer);
        
        // Step 4: Deflate the signed bytes
        const deflated = pako.deflate(coseSigned);
        
        // Step 5: Base45 encode the deflated bytes
        const base45Encoded = base45.encode(deflated);
        
        // Return the result
        res.json({
          signature: base45Encoded
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: 'Connected'
  });
});

// Error handling middleware
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found'
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
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
  console.log(`API endpoints: http://localhost:${PORT}/api/users`);
});