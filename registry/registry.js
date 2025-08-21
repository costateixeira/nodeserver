// Enhanced registry.js with HTML rendering and resolver endpoints

const express = require('express');
const path = require('path');
const RegistryCrawler = require('./crawler');
const RegistryAPI = require('./api');
const htmlServer = require('../common/html-server');
const Logger = require('../common/logger');
const regLog = Logger.getInstance().child({ module: 'registry' });

class RegistryModule {
  constructor() {
    this.router = express.Router();
    this.logger = Logger.getInstance().child({ module: 'registry' });
    this.crawler = null;
    this.api = null;
    this.config = null;
    this.crawlInterval = null;
    this.isInitialized = false;
    this.lastCrawlTime = null;
    this.crawlInProgress = false;
    
    // Thread-safe data storage
    this.currentData = null;
    this.dataLock = false;
  }

  /**
   * Initialize the registry module
   */
  async initialize(config) {
    this.logger.info('Initializing Registry module...');
    this.config = config;

    try {
      // Initialize crawler with configuration
      const crawlerConfig = {
        masterUrl: config.masterUrl || 'https://fhir.github.io/ig-registry/tx-servers.json',
        timeout: config.timeout || 30000,
        userAgent: config.userAgent || 'FHIRRegistryServer/1.0',
        apiKeys: config.apiKeys || {}
      };

      this.crawler = new RegistryCrawler(crawlerConfig);
      this.crawler.useLog(regLog);
      
      // Initialize API with crawler
      this.api = new RegistryAPI(this.crawler);

      // Load saved data if available
      await this.loadSavedData();

      // Set up routes
      this.setupRoutes();

      // Start periodic crawling if configured
      if (config.crawlInterval && config.crawlInterval > 0) {
        this.startPeriodicCrawl(config.crawlInterval);
      }

      this.isInitialized = true;
      this.logger.info('Registry module initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize Registry module:', error);
      throw error;
    }
  }

  /**
   * Load saved registry data if available
   */
  async loadSavedData() {
    try {
      const fs = require('fs').promises;
      const dataPath = path.join(__dirname, 'registry-data.json');
      const data = await fs.readFile(dataPath, 'utf8');
      const jsonData = JSON.parse(data);
      
      // Thread-safe update
      await this.updateData(() => {
        this.crawler.loadData(jsonData);
        this.currentData = this.crawler.getData();
      });
      
      this.logger.info('Loaded saved registry data');
    } catch (error) {
      this.logger.info('No saved registry data found, will fetch fresh data');
    }
  }

  /**
   * Save registry data to disk
   */
  async saveData() {
    try {
      const fs = require('fs').promises;
      const dataPath = path.join(__dirname, 'registry-data.json');
      const data = this.crawler.saveData();
      await fs.writeFile(dataPath, JSON.stringify(data, null, 2));
      this.logger.debug('Saved registry data to disk');
    } catch (error) {
      this.logger.error('Failed to save registry data:', error);
    }
  }

  /**
   * Start periodic crawling
   */
  startPeriodicCrawl(intervalMinutes) {
    const intervalMs = intervalMinutes * 60 * 1000;
    
    // Run initial crawl after a short delay
    setTimeout(() => {
      this.performCrawl();
    }, 5000);

    // Set up periodic crawling
    this.crawlInterval = setInterval(() => {
      this.performCrawl();
    }, intervalMs);

    this.logger.info(`Started periodic crawl every ${intervalMinutes} minutes`);
  }

  /**
   * Perform a single crawl
   */
  async performCrawl() {
    if (this.crawlInProgress) {
      this.logger.info('Crawl already in progress, skipping...');
      return;
    }

    this.crawlInProgress = true;
    this.logger.info('Starting registry crawl...');
    const startTime = Date.now();

    try {
      // Perform the crawl
      const newData = await this.crawler.crawl(this.config.masterUrl);
      
      // Thread-safe update of current data
      await this.updateData(() => {
        this.currentData = newData;
      });

      this.lastCrawlTime = new Date();
      const elapsed = Date.now() - startTime;
      
      // Save to disk
      await this.saveData();
      
      // Get metadata
      const metadata = this.crawler.getMetadata();
      this.logger.info(`Crawl completed in ${(elapsed/1000).toFixed(1)}s. ` +
                      `Found ${newData.registries.length} registries, ` +
                      `${metadata.errors.length} errors, ` +
                      `downloaded ${this.crawler.formatBytes(metadata.totalBytes)}`);
      
    } catch (error) {
      this.logger.error('Crawl failed:', error);
    } finally {
      this.crawlInProgress = false;
    }
  }

  /**
   * Thread-safe data update
   */
  async updateData(updateFn) {
    // Simple lock mechanism - in production, consider using a proper mutex
    while (this.dataLock) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    this.dataLock = true;
    try {
      updateFn();
    } finally {
      this.dataLock = false;
    }
  }

  _normalizeQueryParams(query) {
    const normalized = {};

    // Process each parameter
    Object.keys(query).forEach(key => {
      const value = query[key];

      // If the value is an array, take the first element
      if (Array.isArray(value)) {
        normalized[key] = value.length > 0 ? String(value[0]) : '';
      } else {
        // Convert to string to ensure consistent type
        normalized[key] = value !== null && value !== undefined ? String(value) : '';
      }
    });

    return normalized;
  }

  setupSecurityMiddleware() {
    this.router.use((req, res, next) => {
      // Basic security headers
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

      // Content Security Policy
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'");

      next();
    });
  }

  /**
   * Set up Express routes
   */
  setupRoutes() {
    this.setupSecurityMiddleware();

    // Attach API to all routes
    this.router.use((req, res, next) => {
      req.registryAPI = this.api;
      next();
    });

    // Main registry page
    this.router.get('/', this.handleMainPage.bind(this));
    this.router.get('/resolve', this.handleResolveEndpoint.bind(this));
    this.router.get('/log', this.handleLogEndpoint.bind(this));
  }

  /**
   * Render HTML page for code system or value set query
   * Combines functionality from sendHtmlCS and sendHtmlVS
   */
  renderHtmlPage(req, res, jsonResult, basePath, registry, server, fhirVersion, codeSystem, valueSet) {
    // Generate path with query parameters
    let path = basePath;
    if (registry) path += `&registry=${encodeURIComponent(registry)}`;
    if (server) path += `&server=${encodeURIComponent(server)}`;
    if (fhirVersion) path += `&fhirVersion=${encodeURIComponent(fhirVersion)}`;
    if (codeSystem) path += `&url=${encodeURIComponent(codeSystem)}`;
    if (valueSet) path += `&valueSet=${encodeURIComponent(valueSet)}`;

    // Get registry documentation and info
    const data = this.api.getData();
    const registryInfo = data && data.doco ? data.doco : '';

    // Get status text
    const statusText = this.getStatusText();

    // Render matches table
    const matchesTable = this.api.renderJsonToHtml(
      jsonResult, path, registry, server, fhirVersion
    );

    // Render registry info
    const registryInfoHtml = this.api.renderInfoToHtml();

    // Assemble template variables
    const templateVars = {
      path,
      matches: matchesTable,
      count: jsonResult.results.length,
      registry: registry || '',
      server: server || '',
      fhirVersion: fhirVersion || '',
      url: codeSystem || '',
      valueSet: valueSet || '',
      status: statusText,
      'tx-reg-doco': registryInfo,
      'tx-reg-view': registryInfoHtml
    };

    // Use HTML server to render the page
    try {
      if (!htmlServer.hasTemplate('registry')) {
        const templatePath = path.join(__dirname, 'tx-registry-template.html');
        htmlServer.loadTemplate('registry', templatePath);
      }

      return htmlServer.renderPage(
        'registry',
        'FHIR Terminology Server Registry',
        this.buildHtmlContent(),
        this.api.getStatistics()
      );
    } catch (error) {
      this.logger.error('Error rendering page:', error);
      return `<html><body><h1>Error rendering page</h1><p>${error.message}</p></body></html>`;
    }
  }

  /**
   * Get status text about crawling
   * Based on Pascal status function
   */
  getStatusText() {
    if (this.crawlInProgress) {
      return 'Scanning for updates now';
    } else if (!this.lastCrawlTime) {
      const nextScan = this.crawlInterval ? 
        new Date(Date.now() + this.crawlInterval) : null;
      
      if (nextScan) {
        const timeUntil = this.describePeriod(nextScan - Date.now());
        return `First Scan in ${timeUntil}`;
      } else {
        return 'No automatic scanning configured';
      }
    } else {
      const nextScan = this.crawlInterval ? 
        new Date(this.lastCrawlTime.getTime() + (this.config.crawlInterval * 60 * 1000)) : null;
      
      if (nextScan) {
        const timeUntil = this.describePeriod(nextScan - Date.now());
        const timeSince = this.describePeriod(Date.now() - this.lastCrawlTime);
        return `Next Scan in ${timeUntil}. Last scan was ${timeSince} ago`;
      } else {
        const timeSince = this.describePeriod(Date.now() - this.lastCrawlTime);
        return `Last scan was ${timeSince} ago. No automatic scanning configured`;
      }
    }
  }

  /**
   * Format a time period in milliseconds to a human-readable string
   * Based on Pascal DescribePeriod function
   */
  describePeriod(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    
    if (seconds < 60) {
      return `${seconds} seconds`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)} minutes`;
    } else if (seconds < 86400) {
      return `${Math.floor(seconds / 3600)} hours`;
    } else {
      return `${Math.floor(seconds / 86400)} days`;
    }
  }

  /**
   * Handle main registry page
   */
  async handleMainPage(req, res) {
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
    
    if (!acceptsHtml) {
      // Return JSON overview
      return res.json({
        name: 'FHIR Terminology Server Registry',
        description: 'Registry and discovery service for FHIR terminology servers',
        endpoints: {
          status: '/registry/api/status',
          statistics: '/registry/api/stats',
          registries: '/registry/api/registries',
          queryCodeSystem: '/registry/api/query/codesystem',
          queryValueSet: '/registry/api/query/valueset',
          bestServer: '/registry/api/best-server/{type}',
          errors: '/registry/api/errors'
        },
        documentation: 'https://github.com/your-org/fhir-registry'
      });
    }

    // Render HTML page
    try {
      const startTime = Date.now();
      
      // Load template if needed
      if (!htmlServer.hasTemplate('registry')) {
        const templatePath = path.join(__dirname, 'registry-template.html');
        htmlServer.loadTemplate('registry', templatePath);
      }

      const content = await this.buildHtmlContent();
      const stats = this.api.getStatistics();
      stats.processingTime = Date.now() - startTime;
      stats.crawlInProgress = this.crawlInProgress;
      stats.lastCrawl = this.lastCrawlTime;

      const html = htmlServer.renderPage(
        'registry',
        'FHIR Terminology Server Registry',
        content,
        stats
      );
      
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
      
    } catch (error) {
      this.logger.error('Error rendering registry page:', error);
      htmlServer.sendErrorResponse(res, 'registry', error);
    }
  }

  /**
   * Build HTML content for main page
   */
  /**
   * Build HTML content for main page - simplified version
   */
  async buildHtmlContent() {
    const stats = this.api.getStatistics();
    let html = '';

    // Skip the overview card and search forms

    // Gather all server versions into a flat list
    const serverVersions = [];
    const data = this.api.getData();

    data.registries.forEach(registry => {
      const authority = registry.authority || '';

      registry.servers.forEach(server => {
        const usageTags = server.usageList || [];

        server.versions.forEach(version => {
          serverVersions.push({
            serverName: server.name,
            serverUrl: version.address,
            software: version.software || 'Unknown',
            authority: authority,
            version: version.version,
            security: version.security,
            usage: usageTags,
            codeSystems: version.codeSystems.length,
            valueSets: version.valueSets.length,
            lastSuccess: version.lastSuccess,
            error: version.error
          });
        });
      });
    });

    // Sort by server name
    serverVersions.sort((a, b) => a.serverName.localeCompare(b.serverName));

    // Servers list with last updated time

    html += '<h3 class="card-title mb-0">Terminology Servers</h3>';

    // Format the last updated date/time
    let lastUpdatedText = 'Never updated';
    if (stats.lastRun) {
      const lastRunDate = new Date(stats.lastRun);
      lastUpdatedText = `Last Updated: ${lastRunDate.toLocaleString()}`;
    }
    html += `<p>${lastUpdatedText}. <a href="https://github.com/FHIR/ig-registry/blob/master/tx-registry-doco.md">Register your own server</a>`+
      ` - see <a href="https://build.fhir.org/ig/HL7/fhir-tx-ecosystem-ig/ecosystem.html">Documentation</a></p>`;

    html += '<table class="grid">';
    html += '<thead><tr>';
    html += '<th>URL</th>';
    html += '<th>Software</th>';
    html += '<th>Authority</th>';
    html += '<th>Version</th>';
    html += '<th>Security</th>';
    html += '<th>Usage</th>';
    html += '<th>CS#</th>';
    html += '<th>VS#</th>';
    html += '<th>Status</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    for (const server of serverVersions) {
      html += '<tr>';
      html += `<td><a href="${server.serverUrl}" target="_blank">${this._escapeHtml(server.serverUrl)}</a></td>`;
      html += `<td>${this._escapeHtml(server.software.replace("Reference Server", "HealthIntersections"))}</td>`;
      html += `<td>${this._escapeHtml(server.authority.replace("Published by", ""))}</td>`;
      html += `<td>${this._escapeHtml(server.version)}</td>`;
      html += `<td>${this._escapeHtml(server.security || '')}</td>`;
      html += '<td>';
      if (server.usage && server.usage.length > 0) {
        const badges = server.usage.map(tag =>
          (tag == 'public' ? '' : `<span class="badge badge-info mr-1">${this._escapeHtml(tag)}</span>`)
        );
        html += badges.join(' ');
      }
      html += '</td>';
      html += `<td>${server.codeSystems}</td>`;
      html += `<td>${server.valueSets}</td>`;

      // Status column
      if (server.error) {
        html += `<td><span class="text-danger">Error</span>`;
        if (server.lastSuccess) {
          const minutesSinceLastSuccess = Math.floor((Date.now() - server.lastSuccess) / 60000);
          html += ` (${minutesSinceLastSuccess} min ago)`;
        }
        html += `</td>`;
      } else {
        html += `<td><span class="text-success">OK</span></td>`;
      }

      html += '</tr>';
    }

    html += '</tbody>';
    html += '</table>';

    // Add the authoritative code systems table
    html += '<div class="mb-5">';
    html += this._renderAuthoritativeCodeSystemsTable();
    html += '</div>';

    // Add the authoritative value sets table
    html += '<div class="mb-5">';
    html += this._renderAuthoritativeValueSetsTable();
    html += '</div>';

    return html;
  }

  /**
   * Helper function to escape HTML special characters
   */
  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Gather information about authoritative code systems
   * @returns {Array} Array of objects with code system information
   */
  _getAuthoritativeCodeSystems() {
    const data = this.crawler.getData();
    const authCSMap = new Map();

    // Gather all authoritative code systems
    data.registries.forEach(registry => {
      registry.servers.forEach(server => {
        server.authCSList.forEach(csMask => {
          // Create or update entry for this code system mask
          if (!authCSMap.has(csMask)) {
            authCSMap.set(csMask, {
              mask: csMask,
              servers: new Map()
            });
          }

          // Add server info
          const csEntry = authCSMap.get(csMask);
          if (!csEntry.servers.has(server.name)) {
            csEntry.servers.set(server.name, {
              name: server.name,
              url: server.address,
              versions: new Set()
            });
          }

          // Add version info for this server
          const serverEntry = csEntry.servers.get(server.name);
          server.versions.forEach(version => {
            if (!version.error) {
              serverEntry.versions.add(version.version);
            }
          });
        });
      });
    });

    // Convert map to array and sort
    const authCSList = Array.from(authCSMap.values())
      .map(entry => {
        // Convert servers map to array
        entry.servers = Array.from(entry.servers.values())
          .map(server => {
            // Convert versions set to sorted array
            server.versions = Array.from(server.versions)
              .sort(this._compareVersionsForSort);
            return server;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return entry;
      })
      .sort((a, b) => a.mask.localeCompare(b.mask));

    return authCSList;
  }

  /**
   * Gather information about authoritative value sets
   * @returns {Array} Array of objects with value set information
   */
  _getAuthoritativeValueSets() {
    const data = this.crawler.getData();
    const authVSMap = new Map();

    // Gather all authoritative value sets
    data.registries.forEach(registry => {
      registry.servers.forEach(server => {
        server.authVSList.forEach(vsMask => {
          // Create or update entry for this value set mask
          if (!authVSMap.has(vsMask)) {
            authVSMap.set(vsMask, {
              mask: vsMask,
              servers: new Map()
            });
          }

          // Add server info
          const vsEntry = authVSMap.get(vsMask);
          if (!vsEntry.servers.has(server.name)) {
            vsEntry.servers.set(server.name, {
              name: server.name,
              url: server.address,
              versions: new Set()
            });
          }

          // Add version info for this server
          const serverEntry = vsEntry.servers.get(server.name);
          server.versions.forEach(version => {
            if (!version.error) {
              serverEntry.versions.add(version.version);
            }
          });
        });
      });
    });

    // Convert map to array and sort
    const authVSList = Array.from(authVSMap.values())
      .map(entry => {
        // Convert servers map to array
        entry.servers = Array.from(entry.servers.values())
          .map(server => {
            // Convert versions set to sorted array
            server.versions = Array.from(server.versions)
              .sort(this._compareVersionsForSort);
            return server;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return entry;
      })
      .sort((a, b) => a.mask.localeCompare(b.mask));

    return authVSList;
  }

  /**
   * Comparison function for sorting versions
   * @param {string} a - First version
   * @param {string} b - Second version
   * @returns {number} Comparison result
   */
  _compareVersionsForSort(a, b) {
    // Compare semantic versions
    const aParts = a.split('.').map(p => parseInt(p) || 0);
    const bParts = b.split('.').map(p => parseInt(p) || 0);

    // Compare in reverse order (newest first)
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) {
        return bVal - aVal; // Reverse order (descending)
      }
    }

    return 0;
  }

  /**
   * Format FHIR version for display (convert to R3/R4/R5 format)
   * @param {string} version - Full version string (e.g., "4.0.1")
   * @returns {string} Simplified version (e.g., "R4")
   */
  _formatFhirVersion(version) {
    if (!version) return '';

    // Extract the major version number
    const majorMatch = /^(\d+)\./.exec(version);
    if (majorMatch) {
      return `R${majorMatch[1]}`;
    }

    return version;
  }

  /**
   * Describe SNOMED CT edition based on code
   * @param {string} url - SNOMED CT URL or mask
   * @returns {string} Formatted URL with edition description
   */
  _describeSnomedEdition(url) {
    if (!url.startsWith('http://snomed.info/sct')) {
      return url;
    }

    // For wildcards, just return as is
    if (url.endsWith('*')) {
      url = url.substring(0, url.length-1);
    }

    const parts = url.split('/');
    let edition = '';

    // Get the last non-empty part
    let editionCode = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i] && parts[i] !== 'version') {
        editionCode = parts[i];
        break;
      }
    }

    // Match edition code to description
    switch (editionCode) {
      case '900000000000207008': edition = 'Intl'; break;
      case '731000124108': edition = 'US'; break;
      case '32506021000036107': edition = 'AU'; break;
      case '449081005': edition = 'ES/Intl'; break;
      case '554471000005108': edition = 'DK'; break;
      case '11000146104': edition = 'NL'; break;
      case '45991000052106': edition = 'SE'; break;
      case '83821000000107': edition = 'UK'; break;
      case '11000172109': edition = 'BE'; break;
      case '11000221109': edition = 'AR'; break;
      case '11000234105': edition = 'AT'; break;
      case '20621000087109': edition = 'CA-EN'; break;
      case '20611000087101': edition = 'CA'; break;
      case '11000181102': edition = 'EE'; break;
      case '11000229106': edition = 'FI'; break;
      case '11000274103': edition = 'DE'; break;
      case '1121000189102': edition = 'IN'; break;
      case '11000220105': edition = 'IE'; break;
      case '21000210109': edition = 'NZ'; break;
      case '51000202101': edition = 'NO'; break;
      case '11000267109': edition = 'KR'; break;
      case '900000001000122104': edition = 'ES-ES'; break;
      case '2011000195101': edition = 'CH'; break;
      case '11000279109': edition = 'CX'; break;
      case '999000021000000109': edition = 'UK+Clinical'; break;
      case '5631000179106': edition = 'UY'; break;
      case '5991000124107': edition = 'US+ICD10CM'; break;
      default: edition = editionCode ? '??' : ''; break;
    }

    if (edition) {
      // For masks, add edition in parentheses
      if (url.endsWith(editionCode)) {
        return `${url} (${edition})`;
      } else {
        // For wildcards, just return as is
        return url;
      }
    }

    return url;
  }

  /**
   * Highlight wildcards in masks
   * @param {string} text - The text to process
   * @returns {string} HTML with wildcards highlighted
   */
  _highlightWildcard(text) {
    return text.replace(/\*/g, '<strong class="text-primary">*</strong>');
  }

  /**
   * Render HTML table for authoritative code systems
   * @returns {string} HTML string
   */
  _renderAuthoritativeCodeSystemsTable() {
    const authCSList = this._getAuthoritativeCodeSystems();

    let html = '<h3 class="card-title mb-3">Authoritative Code Systems</h3>';

    if (authCSList.length === 0) {
      html += '<p>No authoritative code systems defined.</p>';
      return html;
    }

    html += '<div class="table-responsive">';
    html += '<table class="table table-striped table-bordered">';
    html += '<thead class="thead-light">';
    html += '<tr>';
    html += '<th>Code System Mask</th>';
    html += '<th>Server</th>';
    html += '<th>FHIR Versions</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    authCSList.forEach(cs => {
      // Format mask with SNOMED CT edition if applicable
      const formattedMask = this._describeSnomedEdition(cs.mask);

      // First row for this code system
      const rowspan = cs.servers.length;
      html += '<tr>';
      html += `<td rowspan="${rowspan}">${this._highlightWildcard(this._escapeHtml(formattedMask))}</td>`;
      html += `<td><a href="${this._escapeHtml(cs.servers[0].url)}" target="_blank">${this._escapeHtml(cs.servers[0].url)}</a></td>`;

      // Format versions as R3/R4/R5
      const formattedVersions = cs.servers[0].versions.map(v => this._formatFhirVersion(v));
      html += `<td>${formattedVersions.join(',')}</td>`;
      html += '</tr>';

      // Additional rows for this code system (if any)
      for (let i = 1; i < cs.servers.length; i++) {
        html += '<tr>';
        html += `<td><a href="${this._escapeHtml(cs.servers[i].url)}" target="_blank">${this._escapeHtml(cs.servers[i].url)}</a></td>`;

        // Format versions as R3/R4/R5
        const formattedVersions = cs.servers[i].versions.map(v => this._formatFhirVersion(v));
        html += `<td>${formattedVersions.join(',')}</td>`;
        html += '</tr>';
      }
    });

    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    return html;
  }

  /**
   * Render HTML table for authoritative value sets
   * @returns {string} HTML string
   */
  _renderAuthoritativeValueSetsTable() {
    const authVSList = this._getAuthoritativeValueSets();

    let html = '<h3 class="card-title mb-3">Authoritative Value Sets</h3>';

    if (authVSList.length === 0) {
      html += '<p>No authoritative value sets defined.</p>';
      return html;
    }

    html += '<div class="table-responsive">';
    html += '<table class="table table-striped table-bordered">';
    html += '<thead class="thead-light">';
    html += '<tr>';
    html += '<th>Value Set Mask</th>';
    html += '<th>Server</th>';
    html += '<th>FHIR Versions</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    authVSList.forEach(vs => {
      // First row for this value set
      const rowspan = vs.servers.length;
      html += '<tr>';
      html += `<td rowspan="${rowspan}">${this._highlightWildcard(this._escapeHtml(vs.mask))}</td>`;
      html += `<td><a href="${this._escapeHtml(vs.servers[0].url)}" target="_blank">${this._escapeHtml(vs.servers[0].url)}</a></td>`;

      // Format versions as R3/R4/R5
      const formattedVersions = vs.servers[0].versions.map(v => this._formatFhirVersion(v));
      html += `<td>${formattedVersions.join(',')}</td>`;
      html += '</tr>';

      // Additional rows for this value set (if any)
      for (let i = 1; i < vs.servers.length; i++) {
        html += '<tr>';
        html += `<td><a href="${this._escapeHtml(vs.servers[i].url)}" target="_blank">${this._escapeHtml(vs.servers[i].url)}</a></td>`;

        // Format versions as R3/R4/R5
        const formattedVersions = vs.servers[i].versions.map(v => this._formatFhirVersion(v));
        html += `<td>${formattedVersions.join(',')}</td>`;
        html += '</tr>';
      }
    });

    html += '</tbody>';
    html += '</table>';
    html += '</div>';

    return html;
  }


  /**
   * Get module status for health check
   */
  getStatus() {
    const metadata = this.crawler ? this.crawler.getMetadata() : null;
    const stats = this.api ? this.api.getStatistics() : null;
    
    return {
      enabled: true,
      initialized: this.isInitialized,
      crawling: this.crawlInProgress,
      lastCrawl: this.lastCrawlTime,
      registries: stats?.registryCount || 0,
      servers: stats?.serverCount || 0,
      errors: metadata?.errors?.length || 0
    };
  }

  /**
   * Shutdown the module
   */
  async shutdown() {
    this.logger.info('Shutting down Registry module...');
    
    // Stop periodic crawling
    if (this.crawlInterval) {
      clearInterval(this.crawlInterval);
      this.crawlInterval = null;
    }

    // Save current data
    if (this.crawler && this.currentData) {
      await this.saveData();
    }

    this.logger.info('Registry module shut down');
  }


  /**
   * Validate a URL string for safety
   * @param {string} url - URL to validate
   * @param {Array} allowedProtocols - Array of allowed protocols (default: ['http:', 'https:'])
   * @returns {boolean} True if URL is valid and safe
   */
  _isValidUrl(url, allowedProtocols = ['http:', 'https:']) {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      const urlObj = new URL(url);
      return allowedProtocols.includes(urlObj.protocol);
    } catch (e) {
      // URL parsing failed
      return false;
    }
  }

  /**
   * Handle resolve endpoint for browser users
   * Serves a form when accessed directly from a browser
   */
  handleResolveEndpoint(req, res) {
    try {
      const params = this._normalizeQueryParams(req.query);
      const { fhirVersion, url, valueSet, usage } = params;

      // Convert authoritativeOnly to boolean
      const authoritativeOnly = params.authoritativeOnly === 'true';

      // Validate URL parameters if provided
      if (url && !this._isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid code system URL format' });
      }

      if (valueSet && !this._isValidUrl(valueSet)) {
        return res.status(400).json({ error: 'Invalid value set URL format' });
      }


      // Check if this is a browser request (based on Accept header)
      const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
      const hasRequiredParams = fhirVersion && (url || valueSet);

      // If it's a browser and missing required params, show the form
      if (acceptsHtml && !hasRequiredParams) {
        // Use the HTML template system
        try {
          const startTime = Date.now();

          // Load template if needed
          if (!htmlServer.hasTemplate('registry')) {
            const templatePath = path.join(__dirname, 'registry-template.html');
            htmlServer.loadTemplate('registry', templatePath);
          }

          const content = this.buildResolveFormContent(req.query);
          const stats = this.api.getStatistics();
          stats.processingTime = Date.now() - startTime;

          const html = htmlServer.renderPage(
            'registry',
            'FHIR Terminology Server Resolver',
            content,
            stats
          );

          res.setHeader('Content-Type', 'text/html');
          return res.send(html);
        } catch (error) {
          this.logger.error('Error rendering form page:', error);
          return res.send(this.buildStandaloneResolveForm(req.query));
        }
      }

      // Otherwise, process the API request normally
      let result, matches;

      // Validate required parameters
      if (!fhirVersion) {
        return res.status(400).json({ error: 'A FHIR version is required' });
      }

      if (!url && !valueSet) {
        return res.status(400).json({ error: 'Either url or valueSet parameter is required' });
      }

      if (valueSet) {
        // Value set resolve
        const resolveResult = this.api.resolveValueSet(fhirVersion, valueSet, authoritativeOnly, usage);
        result = resolveResult.result;
        matches = resolveResult.matches;
        this.logger.info(`Resolved ValueSet ${valueSet} for FHIR ${fhirVersion} (usage=${usage}): ${matches}`);
      } else {
        // Code system resolve
        const resolveResult = this.api.resolveCodeSystem(fhirVersion, url, authoritativeOnly, usage);
        result = resolveResult.result;
        matches = resolveResult.matches;
        this.logger.info(`Resolved CodeSystem ${url} for FHIR ${fhirVersion} (usage=${usage}): ${matches}`);
      }

      // If only authoritative servers are requested, filter results
      if (authoritativeOnly === 'true' && result) {
        result.candidates = [];
      }
      if (acceptsHtml) {
        try {
          const startTime = Date.now();

          // Load template if needed
          if (!htmlServer.hasTemplate('registry')) {
            const templatePath = path.join(__dirname, 'registry-template.html');
            htmlServer.loadTemplate('registry', templatePath);
          }

          const content = this.buildResolveResultContent(result, fhirVersion, url || valueSet, usage);
          const stats = this.api.getStatistics();
          stats.processingTime = Date.now() - startTime;

          const html = htmlServer.renderPage(
            'registry',
            'FHIR Terminology Server Resolution Results',
            content,
            stats
          );

          res.setHeader('Content-Type', 'text/html');
          return res.send(html);
        } catch (error) {
          this.logger.error('Error rendering resolve result page:', error);
          // Fall back to JSON if template rendering fails
        }
      }
      res.json(result);
    } catch (error) {
      this.logger.error('Error in resolve endpoint:', error);
      res.status(400).json({ error: error.message });
    }
  }

  buildResolveResultContent(result, fhirVersion, resourceUrl, usage) {
    let html = '';

    // Query information section
    html += '<div class="card mb-4">';
    html += '<div class="card-header">';
    html += '<h2 class="card-title">Query Information</h2>';
    html += '</div>';
    html += '<div class="card-body">';
    html += `<p><strong>FHIR Version:</strong> ${this._escapeHtml(fhirVersion)}</p>`;
    html += `<p><strong>Resource URL:</strong> ${this._escapeHtml(resourceUrl)}</p>`;
    html += `<p><strong>Registry URL:</strong> <a href="${result['registry-url']}" target="_blank">${this._escapeHtml(result['registry-url'])}</a></p>`;
    if (usage) {
      html += `<p><strong>Usage:</strong> ${this._escapeHtml(usage)}</p>`;
    }
    html += '</div>';
    html += '</div>';

    // Authoritative servers section
    html += '<div class="card mb-4">';
    html += '<div class="card-header">';
    html += '<h2 class="card-title">Authoritative Servers</h2>';
    html += '</div>';
    html += '<div class="card-body">';

    if (result.authoritative && result.authoritative.length > 0) {
      html += '<table class="table table-bordered table-striped">';
      html += '<thead>';
      html += '<tr>';
      html += '<th>Server Name</th>';
      html += '<th>URL</th>';
      html += '<th>Security</th>';
      html += '<th>Access Info</th>';
      html += '</tr>';
      html += '</thead>';
      html += '<tbody>';

      result.authoritative.forEach(server => {
        html += '<tr>';
        html += `<td>${this._escapeHtml(server['server-name'])}</td>`;
        html += `<td><a href="${server.url}" target="_blank">${this._escapeHtml(server.url)}</a></td>`;
        html += `<td>${this.renderSecurityTags(server)}</td>`;
        html += `<td>${server.access_info ? this._escapeHtml(server.access_info) : ''}</td>`;
        html += '</tr>';
      });

      html += '</tbody>';
      html += '</table>';
    } else {
      html += '<p>No authoritative servers found.</p>';
    }

    html += '</div>';
    html += '</div>';

    // Candidate servers section
    html += '<div class="card mb-4">';
    html += '<div class="card-header">';
    html += '<h2 class="card-title">Candidate Servers</h2>';
    html += '</div>';
    html += '<div class="card-body">';

    if (result.candidates && result.candidates.length > 0) {
      html += '<table class="table table-bordered table-striped">';
      html += '<thead>';
      html += '<tr>';
      html += '<th>Server Name</th>';
      html += '<th>URL</th>';
      html += '<th>Security</th>';
      html += '<th>Access Info</th>';
      html += '</tr>';
      html += '</thead>';
      html += '<tbody>';

      result.candidates.forEach(server => {
        html += '<tr>';
        html += `<td>${this._escapeHtml(server['server-name'])}</td>`;
        html += `<td><a href="${server.url}" target="_blank">${this._escapeHtml(server.url)}</a></td>`;
        html += `<td>${this.renderSecurityTags(server)}</td>`;
        html += `<td>${server.access_info ? this._escapeHtml(server.access_info) : ''}</td>`;
        html += '</tr>';
      });

      html += '</tbody>';
      html += '</table>';
    } else {
      html += '<p>No candidate servers found.</p>';
    }

    html += '</div>';
    html += '</div>';

    // Back button
    html += '<div class="mb-4">';
    html += '<a href="/registry/resolve" class="btn btn-primary">« Back to Resolver Form</a>';
    html += '</div>';

    return html;
  }

// Add this helper method to render security tags

  renderSecurityTags(server) {
    const tags = [];

    if (server.open) tags.push('<span class="badge bg-success me-1">Open</span>');
    if (server.password) tags.push('<span class="badge bg-danger me-1">Password</span>');
    if (server.token) tags.push('<span class="badge bg-primary me-1">Token</span>');
    if (server.oauth) tags.push('<span class="badge bg-warning me-1">OAuth</span>');
    if (server.smart) tags.push('<span class="badge bg-info me-1">Smart</span>');
    if (server.cert) tags.push('<span class="badge bg-secondary me-1">Certificate</span>');

    return tags.length > 0 ? tags.join(' ') : 'None';
  }

  /**
   * Build content for the resolve form, to be used with the HTML template
   */
  buildResolveFormContent(queryParams = {}) {
    const fhirVersion = queryParams.fhirVersion || '';
    const url = queryParams.url || '';
    const valueSet = queryParams.valueSet || '';
    const authoritativeOnly = queryParams.authoritativeOnly === 'true';
    const usage = queryParams.usage || '';

    let html = '';

    html += '<p>This tool helps you find the most appropriate terminology server for a given code system or value set.</p>';
    html += '<p class="text-muted small">Fields marked with * are required.</p>';

    // Form
    html += '<form action="/tx-reg/resolve" method="get">';

    // FHIR Version field
    html += '<p>';
    html += '<label for="fhirVersion" class="form-label fw-bold">FHIR Version <span class="text-danger">*</span></label>';
    html += `<input type="text" class="form-control" id="fhirVersion" name="fhirVersion" size="8" 
           value="${this._escapeHtml(fhirVersion)}" required>`;
    html += '</p>';
    html += '<p class="text-muted small">Examples: R4, 4.0.1, 5.0.0, etc.</p>';

    html += '<div class="alert alert-info">Either Code System URL or Value Set URL must be provided:</div>';
    html += '<p>';
    html += '<label for="url" class="form-label fw-bold">Code System URL</label>';
    html += `<input type="url" class="form-control" id="url" name="url" 
           value="${this._escapeHtml(url)}">`;
    html += '</p>';
    html += '<p class="text-muted small">Example: http://loinc.org</p>';

    // ValueSet URL field - now vertical
    html += '<p>';
    html += '<label for="valueSet" class="form-label fw-bold">Value Set URL</label>';
    html += `<input type="url" class="form-control" id="valueSet" name="valueSet" 
           value="${this._escapeHtml(valueSet)}">`;
    html += '</p>';
    html += '<p class="text-muted small">Example: http://hl7.org/fhir/ValueSet/observation-codes</p>';


    // Authoritative Only checkbox
    html += '<p>';
    html += `<input type="checkbox" class="form-check-input" id="authoritativeOnly" 
           name="authoritativeOnly" value="true" ${authoritativeOnly ? 'checked' : ''}>`;
    html += '<label class="form-check-label" for="authoritativeOnly">&nbsp;Show only authoritative servers</label>';
    html += '</p>';

    // Submit button
    html += '<p>';
    html += '<button type="submit" class="btn btn-primary">Find Servers</button>';
    html += '</p>';

    html += '</form>';

    // Client-side validation script
    html += `
  <script>
    // Client-side validation to ensure either url or valueSet is provided
    document.querySelector('form').addEventListener('submit', function(e) {
      const url = document.getElementById('url').value.trim();
      const valueSet = document.getElementById('valueSet').value.trim();
      
      if (!url && !valueSet) {
        e.preventDefault();
        alert('You must provide either a Code System URL or a Value Set URL');
      }
    });
  </script>`;

    return html;
  }

  handleLogEndpoint(req, res) {
    try {
      const params = this._normalizeQueryParams(req.query);
      const requestedLimit = parseInt(params.limit, 10);
      const limit = isNaN(requestedLimit) ? 100 : Math.min(requestedLimit, 1000);

      // Get logs from crawler
      const logs = this.crawler.getLogs(limit);

      // Determine response format based on Accept header
      const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');

      if (acceptsHtml) {
        try {
          const startTime = Date.now();

          // Load template if needed
          if (!htmlServer.hasTemplate('registry')) {
            const templatePath = path.join(__dirname, 'registry-template.html');
            htmlServer.loadTemplate('registry', templatePath);
          }

          const content = this.buildLogContent(logs);
          const stats = this.api.getStatistics();
          stats.processingTime = Date.now() - startTime;

          const html = htmlServer.renderPage(
            'registry',
            'FHIR Terminology Server Registry - Logs',
            content,
            stats
          );

          res.setHeader('Content-Type', 'text/html');
          res.send(html);
        } catch (error) {
          this.logger.error('Error rendering log page:', error);
          res.status(500).send(`<pre>Error rendering log page: ${error.message}</pre>`);
        }
      } else {
        // Return JSON logs
        res.json({
          count: logs.length,
          logs: logs
        });
      }
    } catch (error) {
      this.logger.error('Error in log endpoint:', error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Build log content for template
   * @param {Array} logs - Array of log entries
   * @returns {string} HTML content
   */
  buildLogContent(logs) {
    let html = '';

    // Create a pre tag for logs
    html += '<pre class="p-3 bg-light border rounded" style="overflow: auto; white-space: pre-wrap;">';

    if (logs.length === 0) {
      html += 'No logs available';
    } else {
      // Get the first log timestamp as a reference point
      const firstTimestamp = new Date(logs[0].timestamp).getTime();

      // Format each log entry
      logs.forEach((log, index) => {
        const currentTime = new Date(log.timestamp);

        // For the first entry, show the full timestamp
        let timeDisplay;
        if (index === 0) {
          timeDisplay = currentTime.toISOString().replace('T', ' ').substr(0, 19);
        } else {
          // For subsequent entries, show milliseconds relative to the first entry
          const timeDiff = (currentTime.getTime() - firstTimestamp) / 1000;
          timeDisplay = `+${timeDiff.toFixed(3)}s`;
        }

        // Color code by level
        let levelStyle = '';
        switch (log.level.toLowerCase()) {
          case 'error': levelStyle = 'color: #d9534f; font-weight: bold;'; break;
          case 'warn': levelStyle = 'color: #f0ad4e;'; break;
          case 'debug': levelStyle = 'color: #5cb85c;'; break;
          default: levelStyle = 'color: #0275d8;'; // info
        }

        // Format: [time] [LEVEL] message
        html += `<span style="color: #666;">[${timeDisplay}]</span> <span style="${levelStyle}">[${log.level.toUpperCase()}]</span> ${this._escapeHtml(log.message)}\n`;
      });
    }

    html += '</pre>';

    return html;
  }
}

module.exports = RegistryModule;