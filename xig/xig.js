//
// Copyright 2025, Health Intersections Pty Ltd (http://www.healthintersections.com.au)
//
// Licensed under BSD-3: https://opensource.org/license/bsd-3-clause
//

const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const { EventEmitter } = require('events');
const zlib = require('zlib');
const htmlServer = require('../common/html-server');

const Logger = require('../common/logger');
const xigLog = Logger.getInstance().child({ module: 'xig' });

const router = express.Router();

// Configuration
const XIG_DB_URL = 'http://fhir.org/guides/stats/xig.db';
const XIG_DB_PATH = path.join(__dirname, 'data', 'xig.db');
const TEMPLATE_PATH = path.join(__dirname, 'xig-template.html');

// Global database instance
let xigDb = null;

// Template cache
let htmlTemplate = null;

// Request tracking
let requestStats = {
  total: 0,
  startTime: new Date(),
  dailyCounts: new Map() // date string -> count
};

// Cache object - this is the "atomic" reference that gets replaced
let configCache = {
  loaded: false,
  lastUpdated: null,
  maps: {}
};

// Event emitter for cache updates
const cacheEmitter = new EventEmitter();

// Cache loading lock to prevent concurrent loads
let cacheLoadInProgress = false;

// Security Middleware Setup
function setupSecurityMiddleware() {
  // Security headers middleware
  router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'"
    ].join('; '));
    res.removeHeader('X-Powered-By');
    next();
  });

}

// Parameter validation middleware
function validateQueryParams(allowedParams = {}) {
  return (req, res, next) => {
    try {
      const normalized = {};
      
      // Check for parameter pollution (arrays) and validate
      for (const [key, value] of Object.entries(req.query)) {
        if (Array.isArray(value)) {
          return res.status(400).json({ 
            error: 'Parameter pollution detected',
            parameter: key 
          });
        }
        
        if (allowedParams[key]) {
          const config = allowedParams[key];
          
          if (value !== undefined) {
            if (typeof value !== 'string') {
              return res.status(400).json({ 
                error: `Parameter ${key} must be a string` 
              });
            }
            
            if (value.length > (config.maxLength || 255)) {
              return res.status(400).json({ 
                error: `Parameter ${key} too long (max ${config.maxLength || 255})` 
              });
            }
            
            if (config.pattern && !config.pattern.test(value)) {
              return res.status(400).json({ 
                error: `Parameter ${key} has invalid format` 
              });
            }
            
            normalized[key] = value;
          } else if (config.required) {
            return res.status(400).json({ 
              error: `Parameter ${key} is required` 
            });
          } else {
            normalized[key] = config.default || '';
          }
        } else if (value !== undefined) {
          return res.status(400).json({ 
            error: `Unknown parameter: ${key}` 
          });
        }
      }
      
      // Set default values for missing optional parameters
      for (const [key, config] of Object.entries(allowedParams)) {
        if (normalized[key] === undefined && !config.required) {
          normalized[key] = config.default || '';
        }
      }
      
      req.query = normalized;
      next();
    } catch (error) {
      xigLog.error('Parameter validation error:', error);
      res.status(500).json({ error: 'Parameter validation failed' });
    }
  };
}

// Enhanced HTML escaping
function escapeHtml(text) {
  if (typeof text !== 'string') {
    return String(text);
  }
  
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;'
  };
  
  return text.replace(/[&<>"'`=\/]/g, function(m) { return map[m]; });
}

// URL validation for external requests
function validateExternalUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Protocol ${parsed.protocol} not allowed`);
    }
    
    // Block private IP ranges
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || 
        hostname === '127.0.0.1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname)) {
      throw new Error('Private IP addresses not allowed');
    }
    
    return parsed;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

// Secure SQL query building with parameterized queries
function buildSecureResourceQuery(queryParams, offset = 0, limit = 50) {
  const { realm, auth, ver, type, rt, text } = queryParams;
  
  let baseQuery = `
    SELECT 
      ResourceKey, ResourceType, Type, Kind, Description, PackageKey,
      Realm, Authority, R2, R2B, R3, R4, R4B, R5, R6,
      Id, Url, Version, Status, Date, Name, Title, Content,
      Supplements, Details, FMM, WG, StandardsStatus, Web
    FROM Resources
    WHERE 1=1
  `;
  
  const conditions = [];
  const params = [];
  
  // Realm filter
  if (realm && realm !== '') {
    conditions.push('AND realm = ?');
    params.push(realm);
  }
  
  // Authority filter
  if (auth && auth !== '') {
    conditions.push('AND authority = ?');
    params.push(auth);
  }
  
  // Version filter
  if (ver) {
    switch (ver) {
      case 'R2':
        conditions.push('AND R2 = 1');
        break;
      case 'R2B':
        conditions.push('AND R2B = 1');
        break;
      case 'R3':
        conditions.push('AND R3 = 1');
        break;
      case 'R4':
        conditions.push('AND R4 = 1');
        break;
      case 'R4B':
        conditions.push('AND R4B = 1');
        break;
      case 'R5':
        conditions.push('AND R5 = 1');
        break;
      case 'R6':
        conditions.push('AND R6 = 1');
        break;
    }
  }
  
  // Type-specific filters
  switch (type) {
    case 'cs': // CodeSystem
      conditions.push("AND ResourceType = 'CodeSystem'");
      break;
      
    case 'rp': // Resource Profiles
      conditions.push("AND ResourceType = 'StructureDefinition' AND kind = 'resource'");
      if (rt && rt !== '' && hasCachedValue('profileResources', rt)) {
        conditions.push('AND Type = ?');
        params.push(rt);
      }
      break;
      
    case 'dp': // Datatype Profiles
      conditions.push("AND ResourceType = 'StructureDefinition' AND (kind = 'complex-type' OR kind = 'primitive-type')");
      if (rt && rt !== '' && hasCachedValue('profileTypes', rt)) {
        conditions.push('AND Type = ?');
        params.push(rt);
      }
      break;
      
    case 'lm': // Logical Models
      conditions.push("AND ResourceType = 'StructureDefinition' AND kind = 'logical'");
      break;
      
    case 'ext': // Extensions
      conditions.push("AND ResourceType = 'StructureDefinition' AND Type = 'Extension'");
      if (rt && rt !== '' && hasCachedValue('extensionContexts', rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 2 AND Code = ?)');
        params.push(rt);
      }
      break;
      
    case 'vs': // ValueSets
      conditions.push("AND ResourceType = 'ValueSet'");
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 1 AND Code = ?)');
        params.push(rt);
      }
      break;
      
    case 'cm': // ConceptMaps
      conditions.push("AND ResourceType = 'ConceptMap'");
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 1 AND Code = ?)');
        params.push(rt);
      }
      break;
      
    default:
      // No specific type selected
      if (rt && rt !== '' && hasCachedValue('resourceTypes', rt)) {
        conditions.push('AND ResourceType = ?');
        params.push(rt);
      }
      break;
  }
  
  // Text search filter
  if (text && text !== '') {
    if (type === 'cs') {
      conditions.push(`AND (ResourceKey IN (SELECT ResourceKey FROM ResourceFTS WHERE Description MATCH ? OR Narrative MATCH ?) 
                      OR ResourceKey IN (SELECT ResourceKey FROM CodeSystemFTS WHERE Display MATCH ? OR Definition MATCH ?))`);
      params.push(text, text, text, text);
    } else {
      conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM ResourceFTS WHERE Description MATCH ? OR Narrative MATCH ?)');
      params.push(text, text);
    }
  }
  
  // Build final query
  const fullQuery = baseQuery + ' ' + conditions.join(' ') + ' ORDER BY ResourceType, Type, Description LIMIT ? OFFSET ?';
  params.push(limit, offset);
  
  return { query: fullQuery, params };
}

function buildSecureResourceCountQuery(queryParams) {
  const { realm, auth, ver, type, rt, text } = queryParams;
  
  let baseQuery = 'SELECT COUNT(*) as total FROM Resources WHERE 1=1';
  const conditions = [];
  const params = [];
  
  // Same conditions as main query but for counting
  if (realm && realm !== '') {
    conditions.push('AND realm = ?');
    params.push(realm);
  }
  
  if (auth && auth !== '') {
    conditions.push('AND authority = ?');
    params.push(auth);
  }
  
  if (ver) {
    switch (ver) {
      case 'R2': conditions.push('AND R2 = 1'); break;
      case 'R2B': conditions.push('AND R2B = 1'); break;
      case 'R3': conditions.push('AND R3 = 1'); break;
      case 'R4': conditions.push('AND R4 = 1'); break;
      case 'R4B': conditions.push('AND R4B = 1'); break;
      case 'R5': conditions.push('AND R5 = 1'); break;
      case 'R6': conditions.push('AND R6 = 1'); break;
    }
  }
  
  switch (type) {
    case 'cs':
      conditions.push("AND ResourceType = 'CodeSystem'");
      break;
    case 'rp':
      conditions.push("AND ResourceType = 'StructureDefinition' AND kind = 'resource'");
      if (rt && rt !== '' && hasCachedValue('profileResources', rt)) {
        conditions.push('AND Type = ?');
        params.push(rt);
      }
      break;
    case 'dp':
      conditions.push("AND ResourceType = 'StructureDefinition' AND (kind = 'complex-type' OR kind = 'primitive-type')");
      if (rt && rt !== '' && hasCachedValue('profileTypes', rt)) {
        conditions.push('AND Type = ?');
        params.push(rt);
      }
      break;
    case 'lm':
      conditions.push("AND ResourceType = 'StructureDefinition' AND kind = 'logical'");
      break;
    case 'ext':
      conditions.push("AND ResourceType = 'StructureDefinition' AND Type = 'Extension'");
      if (rt && rt !== '' && hasCachedValue('extensionContexts', rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 2 AND Code = ?)');
        params.push(rt);
      }
      break;
    case 'vs':
      conditions.push("AND ResourceType = 'ValueSet'");
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 1 AND Code = ?)');
        params.push(rt);
      }
      break;
    case 'cm':
      conditions.push("AND ResourceType = 'ConceptMap'");
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM Categories WHERE Mode = 1 AND Code = ?)');
        params.push(rt);
      }
      break;
    default:
      if (rt && rt !== '' && hasCachedValue('resourceTypes', rt)) {
        conditions.push('AND ResourceType = ?');
        params.push(rt);
      }
      break;
  }
  
  if (text && text !== '') {
    if (type === 'cs') {
      conditions.push(`AND (ResourceKey IN (SELECT ResourceKey FROM ResourceFTS WHERE Description MATCH ? OR Narrative MATCH ?) 
                      OR ResourceKey IN (SELECT ResourceKey FROM CodeSystemFTS WHERE Display MATCH ? OR Definition MATCH ?))`);
      params.push(text, text, text, text);
    } else {
      conditions.push('AND ResourceKey IN (SELECT ResourceKey FROM ResourceFTS WHERE Description MATCH ? OR Narrative MATCH ?)');
      params.push(text, text);
    }
  }
  
  const fullQuery = baseQuery + ' ' + conditions.join(' ');
  return { query: fullQuery, params };
}

// Template Functions

function loadTemplate() {
  try {
    // Load using shared HTML server
    const templateLoaded = htmlServer.loadTemplate('xig', TEMPLATE_PATH);
    if (!templateLoaded) {
      xigLog.error('Failed to load HTML template via shared framework');
    }
  } catch (error) {
    xigLog.error(`Failed to load HTML template: ${error.message}`);
  }
}

function renderPage(title, content, options = {}) {
  try {
    return htmlServer.renderPage('xig', title, content, options);
  } catch (error) {
    throw new Error(`Failed to render page: ${error.message}`);
  }
}

async function gatherPageStatistics() {
  const startTime = Date.now();
  
  try {
    // Get database age info
    const dbAge = getDatabaseAgeInfo();
    let downloadDate = 'Unknown';
    
    if (dbAge.lastDownloaded) {
      downloadDate = dbAge.lastDownloaded.toISOString().split('T')[0];
    } else {
      downloadDate = 'Never';
    }
    
    // Get counts from database
    const tableCounts = await getDatabaseTableCounts();
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    return {
      downloadDate: downloadDate,
      totalResources: tableCounts.resources || 0,
      totalPackages: tableCounts.packages || 0,
      processingTime: processingTime,
      version: getMetadata('fhir-version') || '4.0.1'
    };
    
  } catch (error) {
    xigLog.error(`Error gathering page statistics: ${error.message}`);
    
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    return {
      downloadDate: 'Error',
      totalResources: 0,
      totalPackages: 0,
      processingTime: processingTime,
      version: '4.0.1'
    };
  }
}

// Function to build simple content HTML
function buildContentHtml(contentData) {
  if (typeof contentData === 'string') {
    return contentData;
  }
  
  let html = '';
  
  if (contentData.message) {
    html += `<p>${escapeHtml(contentData.message)}</p>`;
  }
  
  if (contentData.data && Array.isArray(contentData.data)) {
    html += '<ul>';
    contentData.data.forEach(item => {
      html += `<li>${escapeHtml(item)}</li>`;
    });
    html += '</ul>';
  }
  
  if (contentData.table) {
    html += '<table class="table table-striped">';
    if (contentData.table.headers) {
      html += '<thead><tr>';
      contentData.table.headers.forEach(header => {
        html += `<th>${escapeHtml(header)}</th>`;
      });
      html += '</tr></thead>';
    }
    if (contentData.table.rows) {
      html += '<tbody>';
      contentData.table.rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => {
          html += `<td>${escapeHtml(cell)}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody>';
    }
    html += '</table>';
  }
  
  return html;
}

// SQL Filter Building Functions

function sqlEscapeString(str) {
  if (!str) return '';
  // Escape single quotes for SQL
  return str.replace(/'/g, "''");
}

function buildSqlFilter(queryParams) {
  const { realm, auth, ver, type, rt, text } = queryParams;
  let filter = '';
  
  // Realm filter
  if (realm && realm !== '') {
    filter += ` and realm = '${sqlEscapeString(realm)}'`;
  }
  
  // Authority filter
  if (auth && auth !== '') {
    filter += ` and authority = '${sqlEscapeString(auth)}'`;
  }
  
  // Version filter - check specific version columns
  if (ver) {
    switch (ver) {
      case 'R2':
        filter += ' and R2 = 1';
        break;
      case 'R2B':
        filter += ' and R2B = 1';
        break;
      case 'R3':
        filter += ' and R3 = 1';
        break;
      case 'R4':
        filter += ' and R4 = 1';
        break;
      case 'R4B':
        filter += ' and R4B = 1';
        break;
      case 'R5':
        filter += ' and R5 = 1';
        break;
      case 'R6':
        filter += ' and R6 = 1';
        break;
    }
  }
  
  // Type-specific filters
  switch (type) {
    case 'cs': // CodeSystem
      filter += " and ResourceType = 'CodeSystem'";
      break;
      
    case 'rp': // Resource Profiles
      filter += " and ResourceType = 'StructureDefinition' and kind = 'resource'";
      if (rt && rt !== '' && hasCachedValue('profileResources', rt)) {
        filter += ` and Type = '${sqlEscapeString(rt)}'`;
      }
      break;
      
    case 'dp': // Datatype Profiles
      filter += " and ResourceType = 'StructureDefinition' and (kind = 'complex-type' or kind = 'primitive-type')";
      if (rt && rt !== '' && hasCachedValue('profileTypes', rt)) {
        filter += ` and Type = '${sqlEscapeString(rt)}'`;
      }
      break;
      
    case 'lm': // Logical Models
      filter += " and ResourceType = 'StructureDefinition' and kind = 'logical'";
      break;
      
    case 'ext': // Extensions
      filter += " and ResourceType = 'StructureDefinition' and (Type = 'Extension')";
      if (rt && rt !== '' && hasCachedValue('extensionContexts', rt)) {
        filter += ` and ResourceKey in (Select ResourceKey from Categories where Mode = 2 and Code = '${sqlEscapeString(rt)}')`;
      }
      break;
      
    case 'vs': // ValueSets
      filter += " and ResourceType = 'ValueSet'";
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        filter += ` and ResourceKey in (Select ResourceKey from Categories where Mode = 1 and Code = '${sqlEscapeString(rt)}')`;
      }
      break;
      //
// Copyright 2025, Health Intersections Pty Ltd (http://www.healthintersections.com.au)
//
// Licensed under BSD-3: https://opensource.org/license/bsd-3-clause
//

      const express = require('express');
      const fs = require('fs');
      const path = require('path');
      const https = require('https');
      const http = require('http');
      const cron = require('node-cron');
      const sqlite3 = require('sqlite3').verbose();
      const { EventEmitter } = require('events');
      const zlib = require('zlib');
      const htmlServer = require('../common/html-server');

      const Logger = require('../common/logger');
      const xigLog = Logger.getInstance().child({ module: 'xig' });

      const router = express.Router();

// Configuration
      const XIG_DB_URL = 'http://fhir.org/guides/stats/xig.db';
      const XIG_DB_PATH = path.join(__dirname, 'data', 'xig.db');
      const TEMPLATE_PATH = path.join(__dirname, 'xig-template.html');

// Global database instance
      let xigDb = null;

// Template cache
      let htmlTemplate = null;

// Request tracking
      let requestStats = {
        total: 0,
        startTime: new Date(),
        dailyCounts: new Map() // date string -> count
      };

// Event emitter for cache updates
      const cacheEmitter = new EventEmitter();

// Cache loading lock to prevent concurrent loads
      let cacheLoadInProgress = false;

    case 'cm': // ConceptMaps
      filter += " and ResourceType = 'ConceptMap'";
      if (rt && rt !== '' && hasTerminologySource(rt)) {
        filter += ` and ResourceKey in (Select ResourceKey from Categories where Mode = 1 and Code = '${sqlEscapeString(rt)}')`;
      }
      break;
      
    default:
      // No specific type selected - handle rt parameter for general resource filtering
      if (rt && rt !== '' && hasCachedValue('resourceTypes', rt)) {
        filter += ` and ResourceType = '${sqlEscapeString(rt)}'`;
      }
      break;
  }
  
  // Text search filter
  if (text && text !== '') {
    const escapedText = sqlEscapeString(text);
    if (type === 'cs') {
      // Special handling for CodeSystems - search both resource and CodeSystem-specific fields
      filter += ` and (ResourceKey in (select ResourceKey from ResourceFTS where Description match '${escapedText}' or Narrative match '${escapedText}') ` +
                `or ResourceKey in (select ResourceKey from CodeSystemFTS where Display match '${escapedText}' or Definition match '${escapedText}'))`;
    } else {
      // Standard resource text search
      filter += ` and ResourceKey in (select ResourceKey from ResourceFTS where Description match '${escapedText}' or Narrative match '${escapedText}')`;
    }
  }
  
  // Convert to proper WHERE clause
  if (filter !== '') {
    // Remove the first " and " and prepend "WHERE "
    filter = 'WHERE ' + filter.substring(4);
  }
  
  return filter;
}

// Helper function to check if a terminology source exists
// This is a placeholder - you might need to implement this based on your data
function hasTerminologySource(sourceCode) {
  // For now, return true if the source code exists in txSources cache
  // You might need to adjust this logic based on your actual requirements
  return hasCachedValue('txSources', sourceCode);
}

function buildResourceListQuery(queryParams, offset = 0, limit = 50) {
  const whereClause = buildSqlFilter(queryParams);
  
  // Build the complete SQL query
  let sql = `
    SELECT 
      ResourceKey,
      ResourceType,
      Type,
      Kind,
      Description,
      PackageKey,
      Realm,
      Authority,
      R2, R2B, R3, R4, R4B, R5, R6,
      Id,
      Url,
      Version,
      Status,
      Date,
      Name,
      Title,
      Content,
      Supplements,
      Details,
      FMM,
      WG, 
      StandardsStatus,
      Web
    FROM Resources
    ${whereClause}
    ORDER BY ResourceType, Type, Description
    LIMIT ${limit} OFFSET ${offset}
  `;
  
  return sql.trim();
}

function buildResourceCountQuery(queryParams) {
  const whereClause = buildSqlFilter(queryParams);
  
  let sql = `
    SELECT COUNT(*) as total
    FROM Resources
    ${whereClause}
  `;
  
  return sql.trim();
}

// Resource List Table Functions

function buildPaginationControls(count, offset, baseUrl, queryParams) {
  if (count <= 200) {
    return ''; // No pagination needed
  }
  
  let html = '<p>';
  
  // Start link
  if (offset > 200) {
    const startParams = { ...queryParams };
    delete startParams.offset; // Remove offset to go to start
    const startUrl = buildPaginationUrl(baseUrl, startParams);
    html += `<a href="${startUrl}">Start</a> `;
  }
  
  // Prev link  
  if (offset >= 200) {
    const prevParams = { ...queryParams, offset: (offset - 200).toString() };
    const prevUrl = buildPaginationUrl(baseUrl, prevParams);
    html += `<a href="${prevUrl}">Prev</a> `;
  }
  
  // Current range
  const endRange = Math.min(offset + 200, count);
  html += `<b>Rows ${offset} - ${endRange}</b>`;
  
  // Next link (only if there are more results)
  if (offset + 200 < count) {
    const nextParams = { ...queryParams, offset: (offset + 200).toString() };
    const nextUrl = buildPaginationUrl(baseUrl, nextParams);
    html += ` <a href="${nextUrl}">Next</a>`;
  }
  
  html += '</p>';
  return html;
}

function buildPaginationUrl(baseUrl, params) {
  const queryString = Object.keys(params)
    .filter(key => params[key] && params[key] !== '')
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return baseUrl + (queryString ? '?' + queryString : '');
}

function showVersion(row) {
  const versions = ['R2', 'R2B', 'R3', 'R4', 'R4B', 'R5', 'R6'];
  const supportedVersions = versions.filter(v => row[v] === 1);
  return supportedVersions.join(', ');
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  } catch (error) {
    return dateString; // Return original if parsing fails
  }
}

function getPackage(packageKey) {
  if (!configCache.loaded || !configCache.maps.packages) {
    return null;
  }
  
  return configCache.maps.packages.get(packageKey) || null;
}

function renderExtension(details) {
  if (!details) return '<td></td><td></td><td></td>';
  
  // Extension details are stored in a structured format
  // For now, we'll do basic parsing - you may need to adjust based on actual format
  try {
    const parts = details.split('|');
    const context = parts[0] || '';
    const modifier = parts[1] || '';
    const type = parts[2] || '';
    
    return `<td>${escapeHtml(context)}</td><td>${escapeHtml(modifier)}</td><td>${escapeHtml(type)}</td>`;
  } catch (error) {
    return `<td colspan="3">${escapeHtml(details)}</td>`;
  }
}

async function buildResourceTable(queryParams, resourceCount, offset = 0) {
  if (!xigDb || resourceCount === 0) {
    return '<p>No resources to display.</p>';
  }

  const { ver, realm, auth, type, rt } = queryParams;
  const parts = []; // Use array instead of string concatenation

  try {
    // Add pagination controls
    parts.push(buildPaginationControls(resourceCount, offset, '/xig', queryParams));

    // Get resource data with pagination
    const { query: resourceQuery, params: qp } = buildSecureResourceQuery(queryParams, offset, 200);

    // Add SQL query as HTML comment for debugging/transparency
    const escapedQuery = resourceQuery
      .replace(/--/g, '&#45;&#45;')  // Escape double hyphens
      .replace(/>/g, '&gt;')         // Escape greater than
      .replace(/</g, '&lt;');        // Escape less than
    const escapedParams = JSON.stringify(qp)
      .replace(/--/g, '&#45;&#45;')
      .replace(/>/g, '&gt;')
      .replace(/</g, '&lt;');

    parts.push(`<!-- SQL Query: ${escapedQuery} -->`);
    parts.push(`<!-- Parameters: ${escapedParams} -->`);
    // Build table start and headers
    parts.push(
      '<table class="table table-striped table-bordered">',
      '<tr>',
      '<th>Package</th>'
    );

    if (!ver || ver === '') {
      parts.push('<th>Version</th>');
    }

    parts.push(
      '<th>Identity</th>',
      '<th>Name/Title</th>',
      '<th>Status</th>',
      '<th>FMM</th>',
      '<th>WG</th>',
      '<th>Date</th>'
    );

    if (!realm || realm === '') {
      parts.push('<th>Realm</th>');
    }

    if (!auth || auth === '') {
      parts.push('<th>Auth</th>');
    }

    // Type-specific columns
    switch (type) {
      case 'cs': // CodeSystem
        parts.push('<th>Content</th>');
        break;
      case 'rp': // Resource Profiles
        if (!rt || rt === '') {
          parts.push('<th>Resource</th>');
        }
        break;
      case 'dp': // Datatype Profiles
        if (!rt || rt === '') {
          parts.push('<th>DataType</th>');
        }
        break;
      case 'ext': // Extensions
        parts.push('<th>Context</th>', '<th>Modifier</th>', '<th>Type</th>');
        break;
      case 'vs': // ValueSets
        parts.push('<th>Source(s)</th>');
        break;
      case 'cm': // ConceptMaps
        parts.push('<th>Source(s)</th>');
        break;
      case 'lm': // Logical Models
        parts.push('<th>Type</th>');
        break;
    }

    parts.push('</tr>');

    const resourceRows = await new Promise((resolve, reject) => {
      xigDb.all(resourceQuery, qp, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    // Determine resource type prefix for links
    let resourceTypePrefix = '';
    switch (type) {
      case 'cs':
        resourceTypePrefix = 'CodeSystem/';
        break;
      case 'rp':
      case 'dp':
      case 'ext':
      case 'lm':
        resourceTypePrefix = 'StructureDefinition/';
        break;
      case 'vs':
        resourceTypePrefix = 'ValueSet/';
        break;
      case 'cm':
        resourceTypePrefix = 'ConceptMap/';
        break;
      default:
        resourceTypePrefix = '';
        break;
    }

    // Render each row
    for (const row of resourceRows) {
      parts.push('<tr>');

      // Package column
      const packageObj = getPackage(row.PackageKey);
      if (packageObj && packageObj.Web) {
        parts.push(`<td><a href="${escapeHtml(packageObj.Web)}" target="_blank">${escapeHtml(packageObj.Id)}</a></td>`);
      } else if (packageObj) {
        parts.push(`<td>${escapeHtml(packageObj.Id)}</td>`);
      } else {
        parts.push(`<td>Package ${escapeHtml(String(row.PackageKey))}</td>`);
      }

      // Version column (if not filtered)
      if (!ver || ver === '') {
        parts.push(`<td>${escapeHtml(showVersion(row))}</td>`);
      }

      // Identity column with complex link logic
      let identityLink = '';
      if (packageObj && packageObj.PID) {
        const packagePid = packageObj.PID.replace(/#/g, '|'); // Convert # to | for URL
        identityLink = `/xig/resource/${encodeURIComponent(packagePid)}/${encodeURIComponent(row.ResourceType)}/${encodeURIComponent(row.Id)}`;
      } else {
        // Fallback for missing package info
        identityLink = `/xig/resource/unknown/${encodeURIComponent(row.ResourceType)}/${encodeURIComponent(row.Id)}`;
      }

      const identityText = (row.ResourceType + '/').replace(resourceTypePrefix, '') + row.Id;
      parts.push(`<td><a href="${identityLink}">${escapeHtml(identityText)}</a></td>`);

      // Name/Title column
      const displayName = row.Title || row.Name || '';
      parts.push(`<td>${escapeHtml(displayName)}</td>`);

      // Status column
      if (row.StandardsStatus) {
        parts.push(`<td>${escapeHtml(row.StandardsStatus || '')}</td>`);
      } else {
        parts.push(`<td>${escapeHtml(row.Status || '')}</td>`);
      }

      // FMM/WG Columns
      parts.push(`<td>${escapeHtml(row.FMM || '')}</td>`);
      parts.push(`<td>${escapeHtml(row.WG || '')}</td>`);

      // Date column
      parts.push(`<td>${formatDate(row.Date)}</td>`);

      // Realm column (if not filtered)
      if (!realm || realm === '') {
        parts.push(`<td>${escapeHtml(row.Realm || '')}</td>`);
      }

      // Authority column (if not filtered)
      if (!auth || auth === '') {
        parts.push(`<td>${escapeHtml(row.Authority || '')}</td>`);
      }

      // Type-specific columns
      switch (type) {
        case 'cs': // CodeSystem
          if (row.Supplements && row.Supplements !== '') {
            parts.push(`<td>Suppl: ${escapeHtml(row.Supplements)}</td>`);
          } else {
            parts.push(`<td>${escapeHtml(row.Content || '')}</td>`);
          }
          break;
        case 'rp': // Resource Profiles
          if (!rt || rt === '') {
            parts.push(`<td>${escapeHtml(row.Type || '')}</td>`);
          }
          break;
        case 'dp': // Datatype Profiles
          if (!rt || rt === '') {
            parts.push(`<td>${escapeHtml(row.Type || '')}</td>`);
          }
          break;
        case 'ext': // Extensions
          parts.push(renderExtension(row.Details));
          break;
        case 'vs': // ValueSets
        case 'cm': // ConceptMaps
          const details = (row.Details || '').replace(/,/g, ' ');
          parts.push(`<td>${escapeHtml(details)}</td>`);
          break;
        case 'lm': // Logical Models
          const packageCanonical = packageObj ? packageObj.Canonical : '';
          const typeText = (row.Type || '').replace(packageCanonical + 'StructureDefinition/', '');
          parts.push(`<td>${escapeHtml(typeText)}</td>`);
          break;
      }

      parts.push('</tr>');
    }

    parts.push('</table>');

    // Single join operation at the end
    return parts.join('');

  } catch (error) {
    xigLog.error(`Error building resource table: ${error.message}`);
    return `<p class="text-danger">Error loading resource list: ${escapeHtml(error.message)}</p>`;
  }
}

// Summary Statistics Functions

async function buildSummaryStats(queryParams, baseUrl) {
  const { ver, auth, realm } = queryParams;
  const currentFilter = buildSqlFilter(queryParams);
  let html = '';
  
  if (!xigDb) {
    return '<p class="text-warning">Database not available for summary statistics</p>';
  }
  
  try {
    html += '<div style="background-color:rgb(254, 250, 198); border: 1px black solid; padding: 6px; font-size: 12px; font-family: verdana;">';
    // Version breakdown (only if no version filter is applied)
    if (!ver || ver === '') {
      html += '<p><strong>By Version</strong></p>';
      html += '<ul style="columns: 4; -webkit-columns: 4; -moz-columns: 4">';
      
      const versions = getCachedSet('versions');
      for (const version of versions) {
        try {
          let sql;
          if (currentFilter === '') {
            sql = `SELECT COUNT(*) as count FROM Resources WHERE ${version} = 1`;
          } else {
            sql = `SELECT COUNT(*) as count FROM Resources ${currentFilter} AND ${version} = 1`;
          }
          
          const count = await new Promise((resolve, reject) => {
            xigDb.get(sql, [], (err, row) => {
              if (err) reject(err);
              else resolve(row ? row.count : 0);
            });
          });
          
          const linkUrl = buildVersionLinkUrl(baseUrl, queryParams, version);
          html += `<li><a href="${linkUrl}">${escapeHtml(version)}</a>: ${count.toLocaleString()}</li>`;
        } catch (error) {
          html += `<li>${escapeHtml(version)}: Error</li>`;
        }
      }
      html += '</ul>';
    }
    
    // Authority breakdown (only if no authority filter is applied)
    if (!auth || auth === '') {
      html += '<p><strong>By Authority</strong></p>';
      html += '<ul style="columns: 4; -webkit-columns: 4; -moz-columns: 4">';
      
      let sql;
      if (currentFilter === '') {
        sql = 'SELECT Authority, COUNT(*) as count FROM Resources GROUP BY Authority ORDER BY Authority';
      } else {
        sql = `SELECT Authority, COUNT(*) as count FROM Resources ${currentFilter} GROUP BY Authority ORDER BY Authority`;
      }
      
      const authorityResults = await new Promise((resolve, reject) => {
        xigDb.all(sql, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
      
      authorityResults.forEach(row => {
        const authority = row.Authority;
        const count = row.count;
        
        if (!authority || authority === '') {
          html += `<li>none: ${count.toLocaleString()}</li>`;
        } else {
          const linkUrl = buildAuthorityLinkUrl(baseUrl, queryParams, authority);
          html += `<li><a href="${linkUrl}">${escapeHtml(authority)}</a>: ${count.toLocaleString()}</li>`;
        }
      });
      html += '</ul>';
    }
    
    // Realm breakdown (only if no realm filter is applied)
    if (!realm || realm === '') {
      html += '<p><strong>By Realm</strong></p>';
      html += '<ul style="columns: 4; -webkit-columns: 4; -moz-columns: 4">';
      
      let sql;
      if (currentFilter === '') {
        sql = 'SELECT Realm, COUNT(*) as count FROM Resources GROUP BY Realm ORDER BY Realm';
      } else {
        sql = `SELECT Realm, COUNT(*) as count FROM Resources ${currentFilter} GROUP BY Realm ORDER BY Realm`;
      }
      
      const realmResults = await new Promise((resolve, reject) => {
        xigDb.all(sql, [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      var c = 0;
      realmResults.forEach(row => {
        const realmCode = row.Realm;
        const count = row.count;
        
        if (!realmCode || realmCode === '') {
          html += `<li>none: ${count.toLocaleString()}</li>`;
        } else  if (realmCode.length > 3) {
          c++;
        } else {
          const linkUrl = buildRealmLinkUrl(baseUrl, queryParams, realmCode);
          html += `<li><a href="${linkUrl}">${escapeHtml(realmCode)}</a>: ${count.toLocaleString()}</li>`;
        }
      });
      if (c > 0) {
          html += `<li>other: ${c}</li>`;
      }
      html += '</ul>';
    }
      html += '</div><p>&nbsp;</p>';
    
  } catch (error) {
    xigLog.error(`Error building summary stats: ${error.message}`);
    html += `<p class="text-warning">Error loading summary statistics: ${escapeHtml(error.message)}</p>`;
  }
  
  return html;
}

// Helper functions to build links for summary stats
function buildVersionLinkUrl(baseUrl, currentParams, version) {
  const params = { ...currentParams, ver: version };
  const queryString = Object.keys(params)
    .filter(key => params[key] && params[key] !== '')
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return baseUrl + (queryString ? '?' + queryString : '');
}

function buildAuthorityLinkUrl(baseUrl, currentParams, authority) {
  const params = { ...currentParams, auth: authority };
  const queryString = Object.keys(params)
    .filter(key => params[key] && params[key] !== '')
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return baseUrl + (queryString ? '?' + queryString : '');
}

function buildRealmLinkUrl(baseUrl, currentParams, realm) {
  const params = { ...currentParams, realm: realm };
  const queryString = Object.keys(params)
    .filter(key => params[key] && params[key] !== '')
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  return baseUrl + (queryString ? '?' + queryString : '');
}

// Form Building Functions

function makeSelect(selectedValue, optionsList, name = 'rt') {
  let html = `<select name="${name}" size="1">`;
  
  // Add empty option
  if (!selectedValue || selectedValue === '') {
    html += '<option value="" selected="true"></option>';
  } else {
    html += '<option value=""></option>';
  }
  
  // Add options from list
  optionsList.forEach(item => {
    let code, display;
    
    // Handle "code=display" format or just "code"
    if (item.includes('=')) {
      [code, display] = item.split('=', 2);
    } else {
      code = item;
      display = item;
    }
    
    if (selectedValue === code) {
      html += `<option value="${escapeHtml(code)}" selected="true">${escapeHtml(display)}</option>`;
    } else {
      html += `<option value="${escapeHtml(code)}">${escapeHtml(display)}</option>`;
    }
  });
  
  html += '</select>';
  return html;
}

function buildAdditionalForm(queryParams) {
  const { ver, realm, auth, type, rt, text } = queryParams;
  
  let html = '<form method="GET" action="" style="background-color: #eeeeee; border: 1px black solid; padding: 6px; font-size: 12px; font-family: verdana;">';
  
  // Add hidden inputs to preserve current filter state
  if (ver && ver !== '') {
    html += `<input type="hidden" name="ver" value="${escapeHtml(ver)}"/>`;
  }
  if (realm && realm !== '') {
    html += `<input type="hidden" name="realm" value="${escapeHtml(realm)}"/>`;
  }
  if (auth && auth !== '') {
    html += `<input type="hidden" name="auth" value="${escapeHtml(auth)}"/>`;
  }
  
  // Add type-specific fields
  switch (type) {
    case 'cs': // CodeSystem
      html += '<input type="hidden" name="type" value="cs"/>';
      break;
      
    case 'rp': // Resource Profiles
      html += '<input type="hidden" name="type" value="rp"/>';
      const profileResources = getCachedSet('profileResources');
      if (profileResources.length > 0) {
        html += 'Type: ' + makeSelect(rt, profileResources) + ' ';
      }
      break;
      
    case 'dp': // Datatype Profiles
      html += '<input type="hidden" name="type" value="dp"/>';
      const profileTypes = getCachedSet('profileTypes');
      if (profileTypes.length > 0) {
        html += 'Type: ' + makeSelect(rt, profileTypes) + ' ';
      }
      break;
      
    case 'lm': // Logical Models
      html += '<input type="hidden" name="type" value="lm"/>';
      break;
      
    case 'ext': // Extensions
      html += '<input type="hidden" name="type" value="ext"/>';
      const extensionContexts = getCachedSet('extensionContexts');
      if (extensionContexts.length > 0) {
        html += 'Context: ' + makeSelect(rt, extensionContexts) + ' ';
      }
      break;
      
    case 'vs': // ValueSets
      html += '<input type="hidden" name="type" value="vs"/>';
      const txSources = getCachedMap('txSources');
      if (Object.keys(txSources).length > 0) {
        // Convert txSources map to "code=display" format
        const sourceOptions = Object.keys(txSources).map(code => `${code}=${txSources[code]}`);
        html += 'Source: ' + makeSelect(rt, sourceOptions) + ' ';
      }
      break;
      
    case 'cm': // ConceptMaps
      html += '<input type="hidden" name="type" value="cm"/>';
      const txSourcesCM = getCachedMap('txSources');
      if (Object.keys(txSourcesCM).length > 0) {
        // Convert txSources map to "code=display" format
        const sourceOptionsCM = Object.keys(txSourcesCM).map(code => `${code}=${txSourcesCM[code]}`);
        html += 'Source: ' + makeSelect(rt, sourceOptionsCM) + ' ';
      }
      break;
      
    default:
      // Default case - show resource types
      const resourceTypes = getCachedSet('resourceTypes');
      if (resourceTypes.length > 0) {
        html += 'Type: ' + makeSelect(rt, resourceTypes);
      }
      break;
  }
  
  // Add text search field
  html += `Text: <input type="text" name="text" value="${escapeHtml(text || '')}" class="" style="width: 200px;"/> `;
  
  // Add submit button
  html += '<input type="submit" value="Search" style="color:rgb(89, 137, 241)"/>';
  
  html += '</form>';
  
  return html;
}

// Helper function to get cached map as object
function getCachedMap(tableName) {
  const cache = getCachedTable(tableName);
  if (cache instanceof Map) {
    const obj = {};
    cache.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }
  return {};
}

// Control Panel Functions

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function buildPageHeading(queryParams) {
  const { type, realm, auth, ver, rt } = queryParams;
  
  let heading = '<h2>';
  
  // Determine the main heading based on type
  switch (type) {
    case 'cs':
      heading += 'CodeSystems';
      break;
    case 'rp':
      heading += 'Resource Profiles';
      break;
    case 'dp':
      heading += 'Datatype Profiles';
      break;
    case 'lm':
      heading += 'Logical models';
      break;
    case 'ext':
      heading += 'Extensions';
      break;
    case 'vs':
      heading += 'ValueSets';
      break;
    case 'cm':
      heading += 'ConceptMaps';
      break;
    default:
      // No type selected or unknown type
      if (rt && rt !== '') {
        heading += `Resources - ${escapeHtml(rt)}`;
      } else {
        heading += 'Resources - All Kinds';
      }
      break;
  }
  
  // Add additional qualifiers
  if (realm && realm !== '') {
    heading += `, Realm ${escapeHtml(realm.toUpperCase())}`;
  }
  
  if (auth && auth !== '') {
    heading += `, Authority ${escapeHtml(capitalizeFirst(auth))}`;
  }
  
  if (ver && ver !== '') {
    heading += `, Version ${escapeHtml(ver)}`;
  }
  
  heading += '</h2>';
  
  return heading;
}

function buildBaseUrl(baseUrl, params, excludeParam) {
  const filteredParams = { ...params };
  delete filteredParams[excludeParam];
  
  const queryString = Object.keys(filteredParams)
    .filter(key => filteredParams[key] && filteredParams[key] !== '')
    .map(key => `${key}=${encodeURIComponent(filteredParams[key])}`)
    .join('&');
    
  return baseUrl + (queryString ? '?' + queryString : '');
}

function buildVersionBar(baseUrl, currentParams) {
  const { ver } = currentParams;
  const baseUrlWithoutVer = buildBaseUrl(baseUrl, currentParams, 'ver');
  
  let html = 'Version: ';
  
  // "All" link/bold
  if (!ver || ver === '') {
    html += '<b>All</b>';
  } else {
    html += `<a href="${baseUrlWithoutVer}">All</a>`;
  }
  
  // Version links
  const versions = getCachedSet('versions');
  versions.forEach(version => {
    if (version === ver) {
      html += ` | <b>${escapeHtml(version)}</b>`;
    } else {
      const separator = baseUrlWithoutVer.includes('?') ? '&' : '?';
      html += ` | <a href="${baseUrlWithoutVer}${separator}ver=${encodeURIComponent(version)}">${escapeHtml(version)}</a>`;
    }
  });
  
  return html;
}

function buildAuthorityBar(baseUrl, currentParams) {
  const { auth } = currentParams;
  const baseUrlWithoutAuth = buildBaseUrl(baseUrl, currentParams, 'auth');
  
  let html = 'Authority: ';
  
  // "All" link/bold
  if (!auth || auth === '') {
    html += '<b>All</b>';
  } else {
    html += `<a href="${baseUrlWithoutAuth}">All</a>`;
  }
  
  // Authority links
  const authorities = getCachedSet('authorities');
  authorities.forEach(authority => {
    if (authority === auth) {
      html += ` | <b>${escapeHtml(authority)}</b>`;
    } else {
      const separator = baseUrlWithoutAuth.includes('?') ? '&' : '?';
      html += ` | <a href="${baseUrlWithoutAuth}${separator}auth=${encodeURIComponent(authority)}">${escapeHtml(authority)}</a>`;
    }
  });
  
  return html;
}

function buildRealmBar(baseUrl, currentParams) {
  const { realm } = currentParams;
  const baseUrlWithoutRealm = buildBaseUrl(baseUrl, currentParams, 'realm');
  
  let html = 'Realm: ';
  
  // "All" link/bold
  if (!realm || realm === '') {
    html += '<b>All</b>';
  } else {
    html += `<a href="${baseUrlWithoutRealm}">All</a>`;
  }
  
  // Realm links
  const realms = getCachedSet('realms');
  realms.forEach(realmCode => {
    if (realmCode === realm) {
      html += ` | <b>${escapeHtml(realmCode)}</b>`;
    } else {
      const separator = baseUrlWithoutRealm.includes('?') ? '&' : '?';
      html += ` | <a href="${baseUrlWithoutRealm}${separator}realm=${encodeURIComponent(realmCode)}">${escapeHtml(realmCode)}</a>`;
    }
  });
  
  return html;
}

function buildTypeBar(baseUrl, currentParams) {
  const { type } = currentParams;
  const baseUrlWithoutType = buildBaseUrl(baseUrl, currentParams, 'type');
  
  let html = 'View: ';
  
  // "All" link/bold
  if (!type || type === '') {
    html += '<b>All</b>';
  } else {
    html += `<a href="${baseUrlWithoutType}">All</a>`;
  }
  
  // Type links - using the types map (rp=Resource Profiles, etc.)
  const typesMap = getCachedTable('types');
  if (typesMap instanceof Map) {
    typesMap.forEach((display, code) => {
      if (code === type) {
        html += ` | <b>${escapeHtml(display)}</b>`;
      } else {
        const separator = baseUrlWithoutType.includes('?') ? '&' : '?';
        html += ` | <a href="${baseUrlWithoutType}${separator}type=${encodeURIComponent(code)}">${escapeHtml(display)}</a>`;
      }
    });
  }
  
  return html;
}

function buildControlPanel(baseUrl, queryParams) {
  const versionBar = buildVersionBar(baseUrl, queryParams);
  const authorityBar = buildAuthorityBar(baseUrl, queryParams);
  const realmBar = buildRealmBar(baseUrl, queryParams);
  const typeBar = buildTypeBar(baseUrl, queryParams);
  
  return `
    <div class="control-panel mb-4 p-3 border rounded bg-light">
      <ul style="background-color: #eeeeee; border: 1px black solid; margin: 6px">
        <li>${versionBar}</li>
        <li>${authorityBar}</li>
        <li>${realmBar}</li>
        <li>${typeBar}</li>
      </ul>
    </div>
  `;
}

// Cache Functions

function getCachedSet(tableName) {
  const cache = getCachedTable(tableName);
  if (cache instanceof Set) {
    return Array.from(cache).sort(); // Sort for consistent order
  }
  return [];
}

function getCachedValue(tableName, key) {
  if (!configCache.loaded || !configCache.maps[tableName]) {
    return null;
  }
  
  const cache = configCache.maps[tableName];
  if (cache instanceof Map) {
    return cache.get(key);
  }
  return null;
}

function hasCachedValue(tableName, value) {
  if (!configCache.loaded || !configCache.maps[tableName]) {
    return false;
  }
  
  const cache = configCache.maps[tableName];
  if (cache instanceof Set) {
    return cache.has(value);
  }
  return false;
}

function getCachedTable(tableName) {
  if (!configCache.loaded || !configCache.maps[tableName]) {
    return null;
  }
  return configCache.maps[tableName];
}

function isCacheLoaded() {
  return configCache.loaded;
}

function getCacheStats() {
  if (!configCache.loaded) {
    return { loaded: false };
  }
  
  const stats = {
    loaded: true,
    lastUpdated: configCache.lastUpdated,
    tables: {}
  };
  
  Object.keys(configCache.maps).forEach(tableName => {
    const cache = configCache.maps[tableName];
    if (cache instanceof Map) {
      stats.tables[tableName] = { type: 'Map', size: cache.size };
    } else if (cache instanceof Set) {
      stats.tables[tableName] = { type: 'Set', size: cache.size };
    } else {
      stats.tables[tableName] = { type: 'Unknown', size: 0 };
    }
  });
  
  return stats;
}

function getMetadata(key) {
  return getCachedValue('metadata', key);
}

// Database Functions

function downloadFile(url, destination, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    xigLog.info(`Starting download from ${url}`);

    function attemptDownload(currentUrl, redirectCount = 0) {
      if (redirectCount > maxRedirects) {
        reject(new Error(`Too many redirects (${maxRedirects})`));
        return;
      }

      try {
        const validatedUrl = validateExternalUrl(currentUrl);
        const protocol = validatedUrl.protocol === 'https:' ? https : http;

        const request = protocol.get(validatedUrl, (response) => {
          // Handle redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (!redirectUrl.startsWith('http')) {
              const urlObj = new URL(currentUrl);
              if (redirectUrl.startsWith('/')) {
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
              } else {
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}/${redirectUrl}`;
              }
            }

            attemptDownload(redirectUrl, redirectCount + 1);
            return;
          }

          if (response.statusCode !== 200) {
            reject(new Error(`Download failed with status code: ${response.statusCode}`));
            return;
          }

          // Check content length
          const contentLength = parseInt(response.headers['content-length'] || '0');
          const maxSize = 10 * 1024 * 1024 * 1024; // 10GB limit
          if (contentLength > maxSize) {
            reject(new Error('File too large'));
            return;
          }

          const fileStream = fs.createWriteStream(destination);
          let downloadedBytes = 0;

          response.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (downloadedBytes > maxSize) {
              request.destroy();
              fs.unlink(destination, () => {}); // Clean up
              reject(new Error('File too large'));
              return;
            }
          });

          response.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            xigLog.info(`Download completed successfully. Downloaded ${downloadedBytes} bytes to ${destination}`);
            resolve();
          });

          fileStream.on('error', (err) => {
            fs.unlink(destination, () => {}); // Delete partial file
            reject(err);
          });
        });

        request.on('error', (err) => {
          reject(err);
        });

        request.setTimeout(300000, () => { // 5 minutes timeout
          request.destroy();
          reject(new Error('Download timeout'));
        });

      } catch (error) {
        reject(error);
      }
    }

    attemptDownload(url);
  });
}

function validateDatabaseFile(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      reject(new Error('Database file does not exist'));
      return;
    }
    
    // Try to open the SQLite database to validate it
    const testDb = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        reject(new Error(`Invalid SQLite database: ${err.message}`));
        return;
      }
      
      // Try a simple query to ensure the database is accessible
      testDb.get("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1", (err, row) => {
        testDb.close();
        
        if (err) {
          reject(new Error(`Database validation failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  });
}

async function loadConfigCache() {
  if (cacheLoadInProgress) {
    return;
  }
  
  if (!xigDb) {
    xigLog.error('No database connection available for cache loading');
    return;
  }
  
  cacheLoadInProgress = true;

  try {
    // Create new cache object (this will be atomically replaced)
    const newCache = {
      loaded: false,
      lastUpdated: new Date(),
      maps: {}
    };
    
    // Helper function for simple queries
    const executeQuery = (sql, params = []) => {
      return new Promise((resolve, reject) => {
        xigDb.all(sql, params, (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        });
      });
    };
    
    // Load metadata
    const metadataRows = await executeQuery('SELECT Name, Value FROM Metadata');
    newCache.maps.metadata = new Map();
    metadataRows.forEach(row => {
      newCache.maps.metadata.set(row.Name, row.Value);
    });

    // Load realms
    const realmRows = await executeQuery('SELECT Code FROM Realms');
    newCache.maps.realms = new Set();
    realmRows.forEach(row => {
      if (row.Code.length <= 3) {
        newCache.maps.realms.add(row.Code);
      }
    });

    // Load authorities
    const authRows = await executeQuery('SELECT Code FROM Authorities');
    newCache.maps.authorities = new Set();
    authRows.forEach(row => {
      newCache.maps.authorities.add(row.Code);
    });

    // Load packages
    const packageRows = await executeQuery('SELECT PackageKey, Id, PID, Web, Canonical FROM Packages');
    newCache.maps.packages = new Map();
    newCache.maps.packagesById = new Map();
    packageRows.forEach(row => {
      const packageObj = {
        PackageKey: row.PackageKey,
        Id: row.Id,
        PID: row.PID,
        Web: row.Web,
        Canonical: row.Canonical
      };
      
      // Index by PackageKey
      newCache.maps.packages.set(row.PackageKey, packageObj);
      
      // Index by PID with # replaced by |
      const pidKey = row.PID ? row.PID.replace(/#/g, '|') : row.PID;
      if (pidKey) {
        newCache.maps.packagesById.set(pidKey, packageObj);
      }
    });

    // Check if Resources table exists before querying it
    const tableCheckQuery = "SELECT name FROM sqlite_master WHERE type='table' AND name='Resources'";
    const resourcesTableExists = await executeQuery(tableCheckQuery);
    
    if (resourcesTableExists.length > 0) {
      // Load resource-related caches
      const profileResourceRows = await executeQuery(
        "SELECT DISTINCT Type FROM Resources WHERE ResourceType = 'StructureDefinition' AND Kind = 'resource'"
      ); 
      newCache.maps.profileResources = new Set();
      profileResourceRows.forEach(row => {
        if (row.Type && row.Type.trim() !== '') {  // Filter out null/undefined/empty values
          newCache.maps.profileResources.add(row.Type);
        }
      });
      
      const profileTypeRows = await executeQuery(
        "SELECT DISTINCT Type FROM Resources WHERE ResourceType = 'StructureDefinition' AND (Kind = 'complex-type' OR Kind = 'primitive-type')"
      );
      newCache.maps.profileTypes = new Set();
      profileTypeRows.forEach(row => {
        if (row.Type && row.Type.trim() !== '') {  // Filter out null/undefined/empty values
          newCache.maps.profileTypes.add(row.Type);
        }
      });
      
      const resourceTypeRows = await executeQuery('SELECT DISTINCT ResourceType FROM Resources');
      newCache.maps.resourceTypes = new Set();
      resourceTypeRows.forEach(row => {
        newCache.maps.resourceTypes.add(row.ResourceType);
      });
    } else {
      newCache.maps.profileResources = new Set();
      newCache.maps.profileTypes = new Set();
      newCache.maps.resourceTypes = new Set();
    }
    
    // Load categories
    const extensionContextRows = await executeQuery('SELECT DISTINCT Code FROM Categories WHERE Mode = 2');
    newCache.maps.extensionContexts = new Set();
    extensionContextRows.forEach(row => {
      newCache.maps.extensionContexts.add(row.Code);
    });
    
    const extensionTypeRows = await executeQuery('SELECT DISTINCT Code FROM Categories WHERE Mode = 3');
    newCache.maps.extensionTypes = new Set();
    extensionTypeRows.forEach(row => {
      newCache.maps.extensionTypes.add(row.Code);
    });
    
    // Load TX sources
    const txSourceRows = await executeQuery('SELECT Code, Display FROM TxSource');
    newCache.maps.txSources = new Map();
    txSourceRows.forEach(row => {
      newCache.maps.txSources.set(row.Code, row.Display);
    });
    
    // Add fixed dictionaries
    newCache.maps.versions = new Set(['R2', 'R2B', 'R3', 'R4', 'R4B', 'R5', 'R6']);
    
    newCache.maps.types = new Map([
      ['rp', 'Resource Profiles'],
      ['dp', 'Datatype Profiles'], 
      ['ext', 'Extensions'],
      ['lm', 'Logical Models'],
      ['cs', 'CodeSystems'],
      ['vs', 'ValueSets'],
      ['cm', 'ConceptMaps']
    ]);
    
    newCache.loaded = true;
    
    // ATOMIC REPLACEMENT
    const oldCache = configCache;
    configCache = newCache;
    

    // Emit event
    cacheEmitter.emit('cacheUpdated', newCache, oldCache);
    xigLog.info(`XIG Loaded from database`);

  } catch (error) {
    xigLog.error(`Config cache load failed: ${error.message}`);
  } finally {
    cacheLoadInProgress = false;
  }
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(XIG_DB_PATH)) {
      xigLog.error('XIG database file not found, will download on first update');
      resolve();
      return;
    }
    
    xigDb = new sqlite3.Database(XIG_DB_PATH, sqlite3.OPEN_READONLY, async (err) => {
      if (err) {
        xigLog.error(`Failed to open XIG database: ${err.message}`);
        reject(err);
      } else {

        try {
          await loadConfigCache();
        } catch (cacheError) {
          xigLog.warn(`Failed to load config cache: ${cacheError.message}`);
        }
        
        resolve();
      }
    });
  });
}

async function updateXigDatabase() {
  try {

    const tempPath = XIG_DB_PATH + '.tmp';
    
    await downloadFile(XIG_DB_URL, tempPath);
    await validateDatabaseFile(tempPath);
    
    if (xigDb) {
      await new Promise((resolve) => {
        xigDb.close((err) => {
          if (err) {
            xigLog.warn(`Warning: Error closing existing database: ${err.message}`);
          }
          xigDb = null;
          resolve();
        });
      });
    }
    
    if (fs.existsSync(XIG_DB_PATH)) {
      fs.unlinkSync(XIG_DB_PATH);
    }
    fs.renameSync(tempPath, XIG_DB_PATH);
    
    await initializeDatabase();

    xigLog.info('XIG database updated');
    
  } catch (error) {
    xigLog.error(`XIG database update failed: ${error.message}`);
    
    const tempPath = XIG_DB_PATH + '.tmp';
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    
    if (!xigDb) {
      await initializeDatabase();
    }
  }
}

// Request tracking middleware
function trackRequest(req, res, next) {
  requestStats.total++;
  
  const today = new Date().toISOString().split('T')[0];
  const currentCount = requestStats.dailyCounts.get(today) || 0;
  requestStats.dailyCounts.set(today, currentCount + 1);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
  
  for (const [date, count] of requestStats.dailyCounts.entries()) {
    if (date < cutoffDate) {
      requestStats.dailyCounts.delete(date);
    }
  }
  
  next();
}

router.use(trackRequest);

// Statistics functions
function getDatabaseTableCounts() {
  return new Promise((resolve, reject) => {
    if (!xigDb) {
      resolve({ packages: 0, resources: 0 });
      return;
    }
    
    const counts = {};
    let completedQueries = 0;
    const totalQueries = 2;
    
    xigDb.get('SELECT COUNT(*) as count FROM Packages', [], (err, row) => {
      if (err) {
        counts.packages = 0;
      } else {
        counts.packages = row.count;
      }
      
      completedQueries++;
      if (completedQueries === totalQueries) {
        resolve(counts);
      }
    });
    
    xigDb.get('SELECT COUNT(*) as count FROM Resources', [], (err, row) => {
      if (err) {
        counts.resources = 0;
      } else {
        counts.resources = row.count;
      }
      
      completedQueries++;
      if (completedQueries === totalQueries) {
        resolve(counts);
      }
    });
  });
}

function getRequestStats() {
  const now = new Date();
  const daysRunning = Math.max(1, Math.ceil((now - requestStats.startTime) / (1000 * 60 * 60 * 24)));
  const averagePerDay = Math.round(requestStats.total / daysRunning);
  
  return {
    total: requestStats.total,
    startTime: requestStats.startTime,
    daysRunning: daysRunning,
    averagePerDay: averagePerDay,
    dailyCounts: requestStats.dailyCounts
  };
}

function getDatabaseAgeInfo() {
  if (!fs.existsSync(XIG_DB_PATH)) {
    return {
      lastDownloaded: null,
      daysOld: null,
      status: 'No database file'
    };
  }
  
  const stats = fs.statSync(XIG_DB_PATH);
  const lastModified = stats.mtime;
  const now = new Date();
  const ageInDays = Math.floor((now - lastModified) / (1000 * 60 * 60 * 24));
  
  return {
    lastDownloaded: lastModified,
    daysOld: ageInDays,
    status: ageInDays === 0 ? 'Today' : 
            ageInDays === 1 ? '1 day ago' : 
            `${ageInDays} days ago`
  };
}

function buildStatsTable(statsData) {
  let html = '<table class="table table-striped table-bordered">';
  html += '<thead class="table-dark">';
  html += '<tr><th>Metric</th><th>Value</th><th>Details</th></tr>';
  html += '</thead>';
  html += '<tbody>';
  
  // Cache Statistics
  html += '<tr class="table-info"><td colspan="3"><strong>Cache Statistics</strong></td></tr>';
  
  if (statsData.cache.loaded) {
    Object.keys(statsData.cache.tables).forEach(tableName => {
      const tableInfo = statsData.cache.tables[tableName];
      html += `<tr>`;
      html += `<td>Cache: ${escapeHtml(tableName)}</td>`;
      html += `<td>${tableInfo.size.toLocaleString()}</td>`;
      html += `<td>${tableInfo.type}</td>`;
      html += `</tr>`;
    });
    
    html += `<tr>`;
    html += `<td>Cache Last Updated</td>`;
    html += `<td>${new Date(statsData.cache.lastUpdated).toLocaleString()}</td>`;
    html += `<td>Automatically updated when database changes</td>`;
    html += `</tr>`;
  } else {
    html += '<tr><td>Cache Status</td><td class="text-warning">Not Loaded</td><td>Cache is still initializing</td></tr>';
  }
  
  // Database Statistics
  html += '<tr class="table-info"><td colspan="3"><strong>Database Statistics</strong></td></tr>';
  
  html += `<tr>`;
  html += `<td>Database Size</td>`;
  html += `<td>${(statsData.database.fileSize / 1024 / 1024).toFixed(2)} MB</td>`;
  html += `<td>Downloaded from fhir.org</td>`;
  html += `</tr>`;
  
  html += `<tr>`;
  html += `<td>Last Downloaded</td>`;
  html += `<td>${statsData.databaseAge.status}</td>`;
  if (statsData.databaseAge.lastDownloaded) {
    html += `<td>${statsData.databaseAge.lastDownloaded.toLocaleString()}</td>`;
  } else {
    html += `<td>Never downloaded</td>`;
  }
  html += `</tr>`;
  
  // Table counts
  html += `<tr>`;
  html += `<td>Packages</td>`;
  html += `<td>${statsData.tableCounts.packages.toLocaleString()}</td>`;
  html += `<td>FHIR Implementation Guide packages</td>`;
  html += `</tr>`;
  
  html += `<tr>`;
  html += `<td>Resources</td>`;
  html += `<td>${statsData.tableCounts.resources.toLocaleString()}</td>`;
  html += `<td>FHIR resources across all packages</td>`;
  html += `</tr>`;
  
  // Request Statistics
  html += '<tr class="table-info"><td colspan="3"><strong>Request Statistics</strong></td></tr>';
  
  html += `<tr>`;
  html += `<td>Total Requests</td>`;
  html += `<td>${statsData.requests.total.toLocaleString()}</td>`;
  html += `<td>Since ${statsData.requests.startTime.toLocaleString()}</td>`;
  html += `</tr>`;
  
  html += `<tr>`;
  html += `<td>Average per Day</td>`;
  html += `<td>${statsData.requests.averagePerDay.toLocaleString()}</td>`;
  html += `<td>Based on ${statsData.requests.daysRunning} days running</td>`;
  html += `</tr>`;
  
  // Recent daily activity (last 7 days)
  const recentDays = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    const count = statsData.requests.dailyCounts.get(dateStr) || 0;
    recentDays.push(`${dateStr}: ${count}`);
  }
  
  html += `<tr>`;
  html += `<td>Recent Activity</td>`;
  html += `<td>Last 7 days</td>`;
  html += `<td>${recentDays.join('<br>')}</td>`;
  html += `</tr>`;
  
  html += '</tbody>';
  html += '</table>';
  
  return html;
}

function getDatabaseInfo() {
  return new Promise((resolve, reject) => {
    if (!xigDb) {
      resolve({
        connected: false,
        lastModified: fs.existsSync(XIG_DB_PATH) ? fs.statSync(XIG_DB_PATH).mtime : null,
        fileSize: fs.existsSync(XIG_DB_PATH) ? fs.statSync(XIG_DB_PATH).size : 0
      });
      return;
    }
    
    xigDb.get("SELECT COUNT(*) as tableCount FROM sqlite_master WHERE type='table'", (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          connected: true,
          tableCount: row.tableCount,
          lastModified: fs.existsSync(XIG_DB_PATH) ? fs.statSync(XIG_DB_PATH).mtime : null,
          fileSize: fs.existsSync(XIG_DB_PATH) ? fs.statSync(XIG_DB_PATH).size : 0
        });
      }
    });
  });
}

// Routes
router.get('/:packagePid/:resourceType/:resourceId', async (req, res) => {
  const { packagePid, resourceType, resourceId } = req.params;
  
  // Check if this looks like a package/resource pattern
  // Package PIDs typically contain dots and pipes: hl7.fhir.uv.extensions|current
  // Resource types are FHIR resource names: StructureDefinition, ValueSet, etc.
  
  const isPackagePidFormat = packagePid.includes('.') || packagePid.includes('|');
  const isFhirResourceType = /^[A-Z][a-zA-Z]+$/.test(resourceType);
  
  if (isPackagePidFormat && isFhirResourceType) {
    // This looks like a legacy resource URL, redirect to the proper format
    res.redirect(301, `/xig/resource/${packagePid}/${resourceType}/${resourceId}`);
  } else {
    // Not a resource URL pattern, return 404
    res.status(404).send('Not Found');
  }
});

// Resources list endpoint with control panel
router.get('/', async (req, res) => {
  const startTime = Date.now(); // Add this at the very beginning
  
  try {
    const title = 'FHIR Resources';
    
    // Parse query parameters
    const queryParams = {
      ver: req.query.ver || '',
      auth: req.query.auth || '',
      realm: req.query.realm || '',
      type: req.query.type || '',
      rt: req.query.rt || '',
      text: req.query.text || '',
      offset: req.query.offset || '0'
    };
    
    // Parse offset for pagination
    const offset = parseInt(queryParams.offset) || 0;
    
    // Build control panel
    const controlPanel = buildControlPanel('/xig', queryParams);
    
    // Build dynamic heading
    const pageHeading = buildPageHeading(queryParams);
    
    // Get resource count
    let resourceCount = 0;
    let countError = null;
    
    try {
      if (xigDb) {
        const countQuery = buildResourceCountQuery(queryParams);
        resourceCount = await new Promise((resolve, reject) => {
          xigDb.get(countQuery, [], (err, row) => {
            if (err) {
              reject(err);
            } else {
              resolve(row ? row.total : 0);
            }
          });
        });
      }
    } catch (error) {
      countError = error.message;
      xigLog.error(`Error getting resource count: ${error.message}`);
    }
    
    // Build resource count paragraph
    let countParagraph = '<p>';
    if (countError) {
      countParagraph += `<span class="text-warning">Unable to get resource count: ${escapeHtml(countError)}</span>`;
    } else {
      countParagraph += `${resourceCount.toLocaleString()} resources`;
    }
    countParagraph += '</p>';
    
    // Build additional form
    const additionalForm = buildAdditionalForm(queryParams);
    
    // Build summary statistics
    const summaryStats = await buildSummaryStats(queryParams, '/xig');
    
    // Build resource table
    const resourceTable = await buildResourceTable(queryParams, resourceCount, offset);
    
    // Build content
    let content = controlPanel;
    content += pageHeading;
    content += countParagraph;
    content += additionalForm;
    content += summaryStats;
    content += resourceTable;
    // Gather statistics and render
    const stats = await gatherPageStatistics();
    stats.processingTime = Date.now() - startTime;
    
    const html = renderPage(title, content, stats);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    xigLog.error(`Error rendering resources page: ${error.message}`);
    htmlServer.sendErrorResponse(res, 'xig', error);
  }
});

// Stats endpoint
router.get('/stats', async (req, res) => {
  const startTime = Date.now(); // Add this at the very beginning

  try {

    const [dbInfo, tableCounts] = await Promise.all([
      getDatabaseInfo(),
      getDatabaseTableCounts()
    ]);
    
    const statsData = {
      cache: getCacheStats(),
      database: dbInfo,
      databaseAge: getDatabaseAgeInfo(),
      tableCounts: tableCounts,
      requests: getRequestStats()
    };
    
    const content = buildStatsTable(statsData);
    
    let introContent = '';
    if (statsData.databaseAge.daysOld !== null && statsData.databaseAge.daysOld > 1) {
      introContent += `<div class="alert alert-warning">`;
      introContent += `<strong>Note:</strong> Database is ${statsData.databaseAge.daysOld} days old. `;
      introContent += `Automatic updates occur daily at 2 AM.`;
      introContent += `</div>`;
    }
    
    if (!statsData.cache.loaded) {
      introContent += `<div class="alert alert-info">`;
      introContent += `<strong>Info:</strong> Cache is still loading. Some statistics may be incomplete.`;
      introContent += `</div>`;
    }
    
    const fullContent = introContent + content;
    
   const stats = await gatherPageStatistics();
    stats.processingTime = Date.now() - startTime;
    
    const html = renderPage('FHIR IG Statistics Status', fullContent, stats);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    xigLog.error(`Error generating stats page: ${error.message}`);
    htmlServer.sendErrorResponse(res, 'xig', error);
  }
});

// Resource detail endpoint - handles individual resource pages
router.get('/resource/:packagePid/:resourceType/:resourceId', async (req, res) => {
 const startTime = Date.now(); // Add this at the very beginning
  try {
    const { packagePid, resourceType, resourceId } = req.params;
    
    // Convert URL-safe package PID back to database format (| to #)
    const dbPackagePid = packagePid.replace(/\|/g, '#');
    
    if (!xigDb) {
      throw new Error('Database not available');
    }
    
    // Get package information first
    const packageObj = getPackageByPid(dbPackagePid);
    if (!packageObj) {
      return res.status(404).send(renderPage('Resource Not Found', 
        `<div class="alert alert-danger">Unknown Package: ${escapeHtml(packagePid)}</div>`));
    }
    
    // Get resource details
    const resourceQuery = `
      SELECT * FROM Resources 
      WHERE PackageKey = ? AND ResourceType = ? AND Id = ?
    `;
    
    const resourceData = await new Promise((resolve, reject) => {
      xigDb.get(resourceQuery, [packageObj.PackageKey, resourceType, resourceId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!resourceData) {
      return res.status(404).send(renderPage('Resource Not Found', 
        `<div class="alert alert-danger">Unknown Resource: ${escapeHtml(resourceType)}/${escapeHtml(resourceId)} in package ${escapeHtml(packagePid)}</div>`));
    }
    
    // Build the resource detail page
    const content = await buildResourceDetailPage(packageObj, resourceData, req.secure);
    const title = `${resourceType}/${resourceId}`;
    const stats = await gatherPageStatistics();
    stats.processingTime = Date.now() - startTime;
    
    const html = renderPage(title, content, stats);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    xigLog.error(`Error rendering resource detail page: ${error.message}`);
    htmlServer.sendErrorResponse(res, 'xig', error);
  }
});

// Helper function to get package by PID
function getPackageByPid(pid) {
  if (!configCache.loaded || !configCache.maps.packagesById) {
    return null;
  }
  
  // Try with both # and | variants
  const pidWithPipe = pid.replace(/#/g, '|');
  return configCache.maps.packagesById.get(pid) || 
         configCache.maps.packagesById.get(pidWithPipe) || 
         null;
}

// Main function to build resource detail page content
async function buildResourceDetailPage(packageObj, resourceData, secure = false) {
  let html = '';
  
  try {
    // Build basic resource metadata table
    html += await buildResourceMetadataTable(packageObj, resourceData);
    
    // Build dependencies sections
    html += await buildResourceDependencies(resourceData, secure);
    
    // Build narrative section (if available)
    html += await buildResourceNarrative(resourceData.ResourceKey, packageObj);
    
    // Build source section
    html += await buildResourceSource(resourceData.ResourceKey);
    
  } catch (error) {
    xigLog.error(`Error building resource detail content: ${error.message}`);
    html += `<div class="alert alert-warning">Error loading some content: ${escapeHtml(error.message)}</div>`;
  }
  
  return html;
}

// Build the main resource metadata table
async function buildResourceMetadataTable(packageObj, resourceData) {
  let html = '<table class="table table-bordered">';
  
  // Package
  if (packageObj && packageObj.Web) {
    html += `<tr><td><strong>Package</strong></td><td><a href="${escapeHtml(packageObj.Web)}" target="_blank">${escapeHtml(packageObj.Id)}</a></td></tr>`;
  } else if (packageObj) {
    html += `<tr><td><strong>Package</strong></td><td>${escapeHtml(packageObj.Id)}</td></tr>`;
  }
  
  // Type
  html += `<tr><td><strong>Resource Type</strong></td><td>${escapeHtml(resourceData.ResourceType)}</td></tr>`;
  
  // Id
  html += `<tr><td><strong>Id</strong></td><td>${escapeHtml(resourceData.Id)}</td></tr>`;
  
  // FHIR Versions
  const versions = showVersion(resourceData);
  if (versions.includes(',')) {
    html += `<tr><td><strong>FHIR Versions</strong></td><td>${escapeHtml(versions)}</td></tr>`;
  } else {
    html += `<tr><td><strong>FHIR Version</strong></td><td>${escapeHtml(versions)}</td></tr>`;
  }
  
  // Source
  if (resourceData.Web) {
    html += `<tr><td><strong>Source</strong></td><td><a href="${escapeHtml(resourceData.Web)}" target="_blank">${escapeHtml(resourceData.Web)}</a></td></tr>`;
  }
  
  // Add all other non-empty fields
  const fields = [
    { key: 'Url', label: 'URL' },
    { key: 'Version', label: 'Version' },
    { key: 'Status', label: 'Status' },
    { key: 'Date', label: 'Date' },
    { key: 'Name', label: 'Name' },
    { key: 'Title', label: 'Title' },
    { key: 'Realm', label: 'Realm' },
    { key: 'Authority', label: 'Authority' },
    { key: 'Description', label: 'Description' },
    { key: 'Purpose', label: 'Purpose' },
    { key: 'Copyright', label: 'Copyright' },
    { key: 'CopyrightLabel', label: 'Copyright Label' },
    { key: 'Content', label: 'Content' },
    { key: 'Type', label: 'Type' },
    { key: 'Supplements', label: 'Supplements' },
    { key: 'valueSet', label: 'ValueSet' },
    { key: 'Kind', label: 'Kind' }
  ];
  
  fields.forEach(field => {
    const value = resourceData[field.key];
    if (value && value !== '') {
      if (field.key === 'Experimental') {
        const expValue = value === '1' ? 'True' : 'False';
        html += `<tr><td><strong>${field.label}</strong></td><td>${expValue}</td></tr>`;
      } else {
        html += `<tr><td><strong>${field.label}</strong></td><td>${escapeHtml(value)}</td></tr>`;
      }
    }
  });
  
  html += '</table>';
  return html;
}

// Build resources that use this resource (dependencies pointing TO this resource)
async function buildResourceDependencies(resourceData, secure = false) {
  let html = '<hr/><h3>Resources that use this resource</h3>';
  
  try {
    const dependenciesQuery = `
      SELECT Packages.PID, Resources.ResourceType, Resources.Id, Resources.Url, Resources.Web, Resources.Name, Resources.Title 
      FROM DependencyList, Resources, Packages 
      WHERE DependencyList.TargetKey = ? 
        AND DependencyList.SourceKey = Resources.ResourceKey  
        AND Resources.PackageKey = Packages.PackageKey 
      ORDER BY ResourceType
    `;
    
    const dependencies = await new Promise((resolve, reject) => {
      xigDb.all(dependenciesQuery, [resourceData.ResourceKey], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    if (dependencies.length === 0) {
      html += '<p style="color: #808080">No resources found</p>';
    } else {
      html += buildDependencyTable(dependencies, secure);
    }
    
    // Build resources that this resource uses (dependencies FROM this resource)
    html += '<hr/><h3>Resources that this resource uses</h3>';
    
    const usesQuery = `
      SELECT Packages.PID, Resources.ResourceType, Resources.Id, Resources.Url, Resources.Web, Resources.Name, Resources.Title 
      FROM DependencyList, Resources, Packages 
      WHERE DependencyList.SourceKey = ? 
        AND DependencyList.TargetKey = Resources.ResourceKey  
        AND Resources.PackageKey = Packages.PackageKey 
      ORDER BY ResourceType
    `;
    
    const uses = await new Promise((resolve, reject) => {
      xigDb.all(usesQuery, [resourceData.ResourceKey], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    if (uses.length === 0) {
      html += '<p style="color: #808080">No resources found</p>';
    } else {
      html += buildDependencyTable(uses, secure);
    }
    if (resourceData && resourceData.ResourceType === 'StructureDefinition' && resourceData.Type === 'Extension') {
      html += await buildExtensionExamplesSection(resourceData.Url);
    }
  } catch (error) {
    html += `<div class="alert alert-warning">Error loading dependencies: ${escapeHtml(error.message)}</div>`;
  }
  
  return html;
}
async function buildExtensionExamplesSection(resourceUrl) {
  let html = '<hr/><h3>Examples of Use for Extension</h3>';
  
  try {
    if (!xigDb) {
      html += '<p style="color: #808080"><em>Database not available</em></p>';
      return html;
    }
    
    // Query to find extension examples using the resource URL
    const extensionExamplesQuery = `
      SELECT eu.Url, eu.Name, eu.Version 
      FROM ExtensionDefns ed
      JOIN ExtensionUsages eusage ON ed.ExtensionDefnKey = eusage.ExtensionDefnKey
      JOIN ExtensionUsers eu ON eusage.ExtensionUserKey = eu.ExtensionUserKey
      WHERE ed.Url = ?
      ORDER BY eu.Name
    `;
    
    const extensionExamples = await new Promise((resolve, reject) => {
      xigDb.all(extensionExamplesQuery, [resourceUrl], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    if (extensionExamples.length === 0) {
      html += '<p style="color: #808080">No extension usage examples found</p>';
    } else {
      html += '<table class="table table-bordered table-striped">';
      html += '<thead><tr><th>Resource</th><th>Version</th></tr></thead>';
      html += '<tbody>';
      
      extensionExamples.forEach(example => {
        const versionMap = { 1: 'R2', 2: 'R2B', 3: 'R3', 4: 'R4', 5: 'R4B', 6: 'R5' };
        const versionName = example.Version ? (versionMap[example.Version] || example.Version.toString()) : '';

        html += '<tr>';
        html += `<td><a href="${escapeHtml(example.Url || '')}">${escapeHtml(example.Name || '')}</a></td>`;
        html += `<td>${escapeHtml(versionName)}</td>`;
        html += '</tr>';
      });
      
      html += '</tbody>';
      html += '</table>';
    }
    
  } catch (error) {
    xigLog.error(`Error loading extension examples: ${error.message}`);
    html += `<div class="alert alert-warning">Error loading extension examples: ${escapeHtml(error.message)}</div>`;
  }
  
  return html;
}
// Helper function to build dependency tables
function buildDependencyTable(dependencies, secure = false) {
  let html = '';
  let currentType = '';
  
  dependencies.forEach(dep => {
    if (currentType !== dep.ResourceType) {
      if (currentType !== '') {
        html += '</table>';
      }
      currentType = dep.ResourceType;
      html += '<table class="table table-bordered">';
      html += `<tr style="background-color: #eeeeee"><td colspan="2"><strong>${escapeHtml(currentType)}</strong></td></tr>`;
    }
    
    html += '<tr>';
    
    // Build the link to the resource detail page
    const protocol = secure ? 'https' : 'http';
    const packagePid = dep.PID.replace(/#/g, '|'); // Convert # to | for URL
    const resourceUrl = `/xig/resource/${encodeURIComponent(packagePid)}/${encodeURIComponent(dep.ResourceType)}/${encodeURIComponent(dep.Id)}`;
    
    // Resource link
    if (dep.Url && dep.Url !== '') {
      // Remove common prefix if present
      let displayUrl = dep.Url;
      // This is a simplified version - you might need more sophisticated prefix removal
      if (displayUrl.includes('/')) {
        const parts = displayUrl.split('/');
        displayUrl = parts[parts.length - 1];
      }
      html += `<td><a href="${resourceUrl}">${escapeHtml(displayUrl)}</a></td>`;
    } else {
      const displayId = dep.ResourceType + '/' + dep.Id;
      html += `<td><a href="${resourceUrl}">${escapeHtml(displayId)}</a></td>`;
    }
    
    // Title or Name
    const displayName = dep.Title || dep.Name || '';
    html += `<td>${escapeHtml(displayName)}</td>`;
    
    html += '</tr>';
  });
  
  if (currentType !== '') {
    html += '</table>';
  }
  
  return html;
}

// Build narrative section (simplified - full implementation would need BLOB decompression)
async function buildResourceNarrative(resourceKey, packageObj) {
  let html = '';
  
  try {
    html += '<hr/><h3>Narrative</h3>';
    
    if (!xigDb) {
      html += '<p style="color: #808080"><em>Database not available</em></p>';
      return html;
    }
    
    // Get the BLOB data from Contents table
    const contentsQuery = 'SELECT Json FROM Contents WHERE ResourceKey = ?';
    
    const blobData = await new Promise((resolve, reject) => {
      xigDb.get(contentsQuery, [resourceKey], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!blobData || !blobData.Json) {
      html += '<p style="color: #808080"><em>No content data available</em></p>';
      return html;
    }
    
    // Decompress the GZIP data
    const decompressedData = await new Promise((resolve, reject) => {
      zlib.gunzip(blobData.Json, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    // Parse as JSON
    const jsonData = JSON.parse(decompressedData.toString('utf8'));
    
    // Extract narrative from text.div
    if (jsonData.text && jsonData.text.div) {
      let narrativeDiv = jsonData.text.div;
      
      // Fix narrative links to be relative to the package canonical base
      if (packageObj && packageObj.Web) {
        const baseUrl = packageObj.Web.substring(0, packageObj.Web.lastIndexOf('/'));
        narrativeDiv = fixNarrative(narrativeDiv, baseUrl);
      }
      
      html += '<p style="color: maroon">Note: links and images are rebased to the (stated) source</p>';
      html += narrativeDiv;
    } else {
      html += '<p style="color: #808080"><em>No narrative content found in resource</em></p>';
    }
    
  } catch (error) {
    xigLog.error(`Error loading narrative: ${error.message}`);
    html += `<div class="alert alert-warning">Error loading narrative: ${escapeHtml(error.message)}</div>`;
  }
  
  return html;
}

// Build source section (simplified - full implementation would need BLOB decompression)
async function buildResourceSource(resourceKey) {
  let html = '';
  
  try {
    html += '<hr/><h3>Source</h3>';
    
    if (!xigDb) {
      html += '<p style="color: #808080"><em>Database not available</em></p>';
      return html;
    }
    
    // Get the BLOB data from Contents table
    const contentsQuery = 'SELECT Json FROM Contents WHERE ResourceKey = ?';
    
    const blobData = await new Promise((resolve, reject) => {
      xigDb.get(contentsQuery, [resourceKey], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    
    if (!blobData || !blobData.Json) {
      html += '<p style="color: #808080"><em>No content data available</em></p>';
      return html;
    }
    
    // Decompress the GZIP data
    const decompressedData = await new Promise((resolve, reject) => {
      zlib.gunzip(blobData.Json, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
    
    // Parse and format as JSON
    const jsonData = JSON.parse(decompressedData.toString('utf8'));
    if (jsonData.text && jsonData.text.div) {
      jsonData.text.div = "<!-- snip (see above) -->";
    }
    const formattedJson = JSON.stringify(jsonData, null, 2);
    
    html += '<pre>';
    html += escapeHtml(formattedJson);
    html += '</pre>';
    
  } catch (error) {
    xigLog.error(`Error loading source: ${error.message}`);
    html += `<div class="alert alert-warning">Error loading source: ${escapeHtml(error.message)}</div>`;
  }
  
  return html;
}

function fixNarrative(narrativeHtml, baseUrl) {
  if (!narrativeHtml || !baseUrl) {
    return narrativeHtml;
  }
  
  try {
    // Fix relative image sources (but not http/https/data: URLs)
    let fixed = narrativeHtml.replace(/src="(?!http|https|data:|#)([^"]+)"/g, `src="${baseUrl}/$1"`);
    
    // Fix relative links (but not http/https/data:/mailto:/# URLs)
    fixed = fixed.replace(/href="(?!http|https|data:|mailto:|#)([^"]+)"/g, `href="${baseUrl}/$1"`);
    
    return fixed;
  } catch (error) {
    xigLog.error(`Error fixing narrative links: ${error.message}`);
    return narrativeHtml; // Return original if fixing fails
  }
}

// JSON endpoints
router.get('/status', async (req, res) => {
  try {
    const dbInfo = await getDatabaseInfo();
    res.json({
      status: 'OK',
      database: dbInfo,
      downloadUrl: XIG_DB_URL,
      localPath: XIG_DB_PATH,
      cache: getCacheStats()
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      cache: getCacheStats()
    });
  }
});

router.get('/cache', (req, res) => {
  res.json(getCacheStats());
});

router.post('/update', async (req, res) => {
  try {
    xigLog.info('Manual update triggered via API');
    await updateXigDatabase();
    res.json({
      status: 'SUCCESS',
      message: 'XIG database updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Failed to update XIG database',
      error: error.message
    });
  }
});

// Initialize the XIG module
async function initializeXigModule() {
  try {

    loadTemplate();
    
    await initializeDatabase();
    
    if (!fs.existsSync(XIG_DB_PATH)) {
      xigLog.info('No existing XIG database found, triggering initial download');
      setTimeout(() => {
        updateXigDatabase();
      }, 5000);
    }
    
    // Check if auto-update is enabled
    // Note: This assumes we're called only when XIG is enabled
    cron.schedule('0 2 * * *', () => {
      updateXigDatabase();
    });

  } catch (error) {
    xigLog.error(`XIG module initialization failed: ${error.message}`);
    throw error; // Re-throw so caller knows about failure
  }
}

// Graceful shutdown
function shutdown() {
  return new Promise((resolve) => {
    if (xigDb) {
      xigDb.close((err) => {
        if (err) {
          xigLog.error(`Error closing XIG database: ${err.message}`);
        } else {
          xigLog.error('XIG database connection closed');
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// Export everything
module.exports = {
  router,
  updateXigDatabase,
  getDatabaseInfo,
  shutdown,
  initializeXigModule,
  
  // Cache functions
  getCachedValue,
  getCachedTable,
  hasCachedValue,
  getCachedSet,
  isCacheLoaded,
  getCacheStats,
  loadConfigCache,
  getMetadata,
  
  // Template functions
  renderPage,
  buildContentHtml,
  escapeHtml,
  loadTemplate,
  
  // Control panel functions
  buildControlPanel,
  buildVersionBar,
  buildAuthorityBar,
  buildRealmBar,
  buildTypeBar,
  buildBaseUrl,
  buildPageHeading,
  capitalizeFirst,
  
  // Form building functions
  buildAdditionalForm,
  makeSelect,
  getCachedMap,
  
  // Resource table functions
  buildResourceTable,
  buildPaginationControls,
  buildPaginationUrl,
  showVersion,
  formatDate,
  renderExtension,
  getPackageByPid,
  buildResourceDetailPage,
  buildResourceMetadataTable,
  buildResourceDependencies,
  buildDependencyTable,
  buildResourceNarrative,
  buildResourceSource,
  fixNarrative,

  // Summary statistics functions
  buildSummaryStats,
  buildVersionLinkUrl,
  buildAuthorityLinkUrl,
  buildRealmLinkUrl,
  
  // SQL filter functions
  buildSqlFilter,
  buildResourceListQuery,
  buildResourceCountQuery,
  sqlEscapeString,
  hasTerminologySource,
  gatherPageStatistics,
  
  // Statistics functions
  getDatabaseTableCounts,
  getRequestStats,
  getDatabaseAgeInfo,
  buildStatsTable,
  
  // Event emitter
  cacheEmitter
};