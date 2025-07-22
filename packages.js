const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const PackageCrawler = require('./package-crawler.js');

class PackagesModule {
  constructor() {
    this.router = express.Router();
    this.config = null;
    this.db = null;
    this.crawlerJob = null;
    this.crawler = null;
    this.lastRunTime = null;
    this.totalRuns = 0;
    this.lastCrawlerLog = {};
    this.setupRoutes();
  }

  async initialize(config) {
    this.config = config;
    
    // Set default masterUrl if not configured
    if (!this.config.masterUrl) {
      this.config.masterUrl = 'https://fhir.github.io/ig-registry/package-feeds.json';
      console.log('No masterUrl configured, using default:', this.config.masterUrl);
    }
    
    console.log('Initializing Packages module...');
    
    // Initialize database
    await this.initializeDatabase();
    
    // Ensure mirror directory exists
    await this.ensureMirrorDirectory();
    
    // Initialize the crawler
    this.crawler = new PackageCrawler(this.config, this.db);
    
    // Start the hourly web crawler if enabled
    if (config.crawler.enabled) {
      // Run crawler immediately on startup
      console.log('Running initial package crawler...');
      try {
        await this.runCrawler();
        console.log('Initial package crawler completed successfully');
      } catch (error) {
        console.error('Initial package crawler failed:', error.message);
        // Don't fail initialization if crawler fails
      }
      
      // Then start the scheduled job
      this.startCrawlerJob();
    }
    
    console.log('Packages module initialized successfully');
  }

  async runCrawler() {
    this.totalRuns++;
    console.log(`Running package crawler (run #${this.totalRuns})...`);
    
    try {
      this.lastCrawlerLog = await this.crawler.crawl();
      this.lastCrawlerLog.runNumber = this.totalRuns;
      this.lastRunTime = new Date().toISOString();
      
      console.log(`Package crawler completed successfully`);
      return this.lastCrawlerLog;
    } catch (error) {
      this.lastRunTime = new Date().toISOString();
      if (this.crawler.crawlerLog) {
        this.lastCrawlerLog = this.crawler.crawlerLog;
        this.lastCrawlerLog.runNumber = this.totalRuns;
      }
      console.error('Package crawler failed:', error.message);
      throw error;
    }
  }

  async initializeDatabase() {
    return new Promise((resolve, reject) => {
      // Use absolute path from config
      const dbPath = this.config.database;
      
      // Ensure directory exists
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      
      const dbExists = fs.existsSync(dbPath);
      
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error opening packages database:', err.message);
          reject(err);
        } else {
          console.log('Connected to packages SQLite database:', dbPath);
          
          if (!dbExists) {
            console.log('Database does not exist, creating tables...');
            this.createTables().then(resolve).catch(reject);
          } else {
            console.log('Packages database already exists');
            resolve();
          }
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const tables = [
        // Packages table
        `CREATE TABLE Packages (
          PackageKey INTEGER PRIMARY KEY AUTOINCREMENT,
          Id TEXT(64) NOT NULL,
          Canonical TEXT(128) NOT NULL,
          DownloadCount INTEGER NOT NULL,
          Security INTEGER,
          ManualToken TEXT(64),
          CurrentVersion INTEGER NOT NULL
        )`,
        
        // PackageVersions table
        `CREATE TABLE PackageVersions (
          PackageVersionKey INTEGER PRIMARY KEY AUTOINCREMENT,
          GUID TEXT(128) NOT NULL,
          PubDate DATETIME NOT NULL,
          Indexed DATETIME NOT NULL,
          Id TEXT(64) NOT NULL,
          Version TEXT(64) NOT NULL,
          Kind INTEGER NOT NULL,
          UploadCount INTEGER,
          DownloadCount INTEGER NOT NULL,
          ManualToken TEXT(64),
          Canonical TEXT(255) NOT NULL,
          FhirVersions TEXT(255) NOT NULL,
          Hash TEXT(128) NOT NULL,
          Author TEXT(128) NOT NULL,
          License TEXT(128) NOT NULL,
          HomePage TEXT(128) NOT NULL,
          Description BLOB,
          Content BLOB NOT NULL
        )`,
        
        // PackageFHIRVersions table
        `CREATE TABLE PackageFHIRVersions (
          PackageVersionKey INTEGER NOT NULL,
          Version TEXT(128) NOT NULL
        )`,
        
        // PackageDependencies table
        `CREATE TABLE PackageDependencies (
          PackageVersionKey INTEGER NOT NULL,
          Dependency TEXT(128) NOT NULL
        )`,
        
        // PackageURLs table
        `CREATE TABLE PackageURLs (
          PackageVersionKey INTEGER NOT NULL,
          URL TEXT(128) NOT NULL
        )`,
        
        // PackagePermissions table
        `CREATE TABLE PackagePermissions (
          PackagePermissionKey INTEGER PRIMARY KEY AUTOINCREMENT,
          ManualToken TEXT(64) NOT NULL,
          Email TEXT(128) NOT NULL,
          Mask TEXT(64)
        )`
      ];

      const indexes = [
        'CREATE INDEX SK_Packages_Id ON Packages (Id, PackageKey)',
        'CREATE INDEX SK_Packages_Canonical ON Packages (Canonical, PackageKey)',
        'CREATE INDEX SK_PackageVersions_Id ON PackageVersions (Id, Version, PackageVersionKey)',
        'CREATE INDEX SK_PackageVersions_Canonical ON PackageVersions (Canonical, PackageVersionKey)',
        'CREATE INDEX SK_PackageVersions_PubDate ON PackageVersions (Id, PubDate, PackageVersionKey)',
        'CREATE INDEX SK_PackageVersions_Indexed ON PackageVersions (Indexed, PackageVersionKey)',
        'CREATE INDEX SK_PackageVersions_GUID ON PackageVersions (GUID)',
        'CREATE INDEX SK_PackageFHIRVersions ON PackageFHIRVersions (PackageVersionKey)',
        'CREATE INDEX SK_PackageDependencies ON PackageDependencies (PackageVersionKey)',
        'CREATE INDEX SK_PackageURLs ON PackageURLs (PackageVersionKey)',
        'CREATE INDEX SK_PackagePermissions_Token ON PackagePermissions (ManualToken)'
      ];

      // First create all tables
      let tablesCompleted = 0;
      const totalTables = tables.length;

      const checkTablesComplete = () => {
        tablesCompleted++;
        if (tablesCompleted === totalTables) {
          console.log('All packages database tables created successfully');
          // Now create indexes
          createIndexes();
        }
      };

      const createIndexes = () => {
        let indexesCompleted = 0;
        const totalIndexes = indexes.length;

        const checkIndexesComplete = () => {
          indexesCompleted++;
          if (indexesCompleted === totalIndexes) {
            console.log('All packages database indexes created successfully');
            resolve();
          }
        };

        const handleIndexError = (err) => {
          console.error('Error creating packages database index:', err);
          reject(err);
        };

        // Create indexes
        indexes.forEach(sql => {
          this.db.run(sql, (err) => {
            if (err) {
              handleIndexError(err);
            } else {
              checkIndexesComplete();
            }
          });
        });
      };

      const handleTableError = (err) => {
        console.error('Error creating packages database table:', err);
        reject(err);
      };

      // Create tables first
      tables.forEach(sql => {
        this.db.run(sql, (err) => {
          if (err) {
            handleTableError(err);
          } else {
            checkTablesComplete();
          }
        });
      });
    });
  }

  async ensureMirrorDirectory() {
    try {
      const mirrorPath = this.config.mirrorPath;
      
      if (!fs.existsSync(mirrorPath)) {
        fs.mkdirSync(mirrorPath, { recursive: true });
        console.log('Created mirror directory:', mirrorPath);
      } else {
        console.log('Mirror directory exists:', mirrorPath);
      }
    } catch (error) {
      console.error('Error creating mirror directory:', error);
      throw error;
    }
  }

  startCrawlerJob() {
    if (this.config.crawler && this.config.crawler.schedule) {
      this.crawlerJob = cron.schedule(this.config.crawler.schedule, async () => {
        console.log('Starting scheduled package crawler...');
        try {
          await this.runCrawler();
          console.log('Scheduled package crawler completed successfully');
        } catch (error) {
          console.error('Scheduled package crawler failed:', error.message);
        }
      });
      console.log(`Package crawler scheduled job started: ${this.config.crawler.schedule}`);
    }
  }

  stopCrawlerJob() {
    if (this.crawlerJob) {
      this.crawlerJob.stop();
      this.crawlerJob = null;
      console.log('Package crawler job stopped');
    }
  }

  async runWebCrawler() {
    const startTime = Date.now();
    this.totalRuns++;
    this.crawlerLog = {
      runNumber: this.totalRuns,
      startTime: new Date().toISOString(),
      master: this.config.masterUrl,
      feeds: [],
      totalBytes: 0,
      errors: ''
    };
    
    console.log(`Running web crawler for packages (run #${this.totalRuns})...`);
    console.log('Fetching master URL:', this.config.masterUrl);
    
    try {
      // Fetch the master JSON file
      const masterResponse = await this.fetchJson(this.config.masterUrl);
      
      if (!masterResponse.feeds || !Array.isArray(masterResponse.feeds)) {
        throw new Error('Invalid master JSON: missing feeds array');
      }
      
      // Process package restrictions if available
      const packageRestrictions = masterResponse['package-restrictions'] || [];
      
      // Process each feed
      for (const feedConfig of masterResponse.feeds) {
        if (!feedConfig.url) {
          console.log('Skipping feed with no URL:', feedConfig);
          continue;
        }
        
        try {
          await this.updateTheFeed(
            this.fixUrl(feedConfig.url),
            this.config.masterUrl,
            feedConfig.errors ? feedConfig.errors.replace(/\|/g, '@').replace(/_/g, '.') : '',
            packageRestrictions
          );
        } catch (feedError) {
          console.error(`Failed to process feed ${feedConfig.url}:`, feedError.message);
          // Continue with next feed even if this one fails
        }
      }
      
      const runTime = Date.now() - startTime;
      this.crawlerLog.runTime = `${runTime}ms`;
      this.crawlerLog.endTime = new Date().toISOString();
      this.crawlerLog.totalBytes = this.totalBytes;
      this.lastRunTime = new Date().toISOString();
      
      console.log(`Web crawler completed successfully in ${runTime}ms`);
      console.log(`Total bytes processed: ${this.totalBytes}`);
      
    } catch (error) {
      const runTime = Date.now() - startTime;
      this.crawlerLog.runTime = `${runTime}ms`;
      this.crawlerLog.fatalException = error.message;
      this.crawlerLog.endTime = new Date().toISOString();
      this.lastRunTime = new Date().toISOString();
      
      console.error('Web crawler failed:', error);
      throw error;
    }
  }

  fixUrl(url) {
    return url.replace(/^http:/, 'https:');
  }

  async fetchJson(url) {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'FHIR Package Crawler/1.0'
        }
      });
      return response.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        throw new Error(`RATE_LIMITED: Server returned 429 Too Many Requests for ${url}`);
      }
      throw new Error(`Failed to fetch JSON from ${url}: ${error.message}`);
    }
  }

  async fetchXml(url) {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'FHIR Package Crawler/1.0'
        }
      });
      
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text'
      });
      
      return parser.parse(response.data);
    } catch (error) {
      if (error.response && error.response.status === 429) {
        throw new Error(`RATE_LIMITED: Server returned 429 Too Many Requests for ${url}`);
      }
      throw new Error(`Failed to fetch XML from ${url}: ${error.message}`);
    }
  }

  async fetchUrl(url, expectedContentType = null) {
    try {
      const response = await axios.get(url, {
        timeout: 60000,
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'FHIR Package Crawler/1.0'
        }
      });
      
      this.totalBytes += response.data.byteLength;
      return Buffer.from(response.data);
    } catch (error) {
      if (error.response && error.response.status === 429) {
        throw new Error(`RATE_LIMITED: Server returned 429 Too Many Requests for ${url}`);
      }
      throw new Error(`Failed to fetch ${url}: ${error.message}`);
    }
  }

  async updateTheFeed(url, source, email, packageRestrictions) {
    const feedLog = {
      url: url,
      items: []
    };
    this.crawlerLog.feeds.push(feedLog);
    
    console.log('Processing feed:', url);
    const startTime = Date.now();
    
    try {
      const xmlData = await this.fetchXml(url);
      feedLog.fetchTime = `${Date.now() - startTime}ms`;
      
      // Navigate the RSS structure
      let items = [];
      if (xmlData.rss && xmlData.rss.channel) {
        const channel = xmlData.rss.channel;
        items = Array.isArray(channel.item) ? channel.item : [channel.item].filter(Boolean);
      }
      
      console.log(`Found ${items.length} items in feed`);
      
      for (let i = 0; i < items.length; i++) {
        try {
          await this.updateItem(url, items[i], i, packageRestrictions, feedLog);
        } catch (itemError) {
          // Check if this is a 429 error on package download
          if (itemError.message.includes('RATE_LIMITED')) {
            console.log(`Rate limited while downloading package from ${url}, stopping feed processing`);
            feedLog.rateLimited = true;
            feedLog.rateLimitedAt = `item ${i}`;
            feedLog.rateLimitMessage = itemError.message;
            break; // Stop processing this feed
          }
          // For other errors, log and continue with next item
          console.error(`Error processing item ${i} from ${url}:`, itemError.message);
        }
      }
      
      // TODO: Send email if there were errors and email is provided
      if (this.errors && email && !feedLog.rateLimited) {
        console.log(`Would send error email to ${email} for feed ${url}`);
      }
      
    } catch (error) {
      // Check if this is a 429 error on feed fetch
      if (error.message.includes('RATE_LIMITED')) {
        console.log(`Rate limited while fetching feed ${url}, skipping this feed`);
        feedLog.rateLimited = true;
        feedLog.rateLimitMessage = error.message;
        feedLog.failTime = `${Date.now() - startTime}ms`;
        return; // Skip this feed entirely
      }
      
      feedLog.exception = error.message;
      feedLog.failTime = `${Date.now() - startTime}ms`;
      console.error(`Exception processing feed ${url}:`, error.message);
      
      // TODO: Send email notification for non-rate-limit errors
      if (email) {
        console.log(`Would send exception email to ${email} for feed ${url}`);
      }
    }
  }

  async updateItem(source, item, index, packageRestrictions, feedLog) {
    const itemLog = {
      status: '??'
    };
    feedLog.items.push(itemLog);
    
    try {
      // Extract GUID
      if (!item.guid || !item.guid['#text']) {
        const error = `Error processing item from ${source}#item[${index}]: no guid provided`;
        console.log(error);
        itemLog.error = 'no guid provided';
        itemLog.status = 'error';
        return;
      }
      
      const guid = item.guid['#text'];
      itemLog.guid = guid;
      
      // Extract title (package ID)
      const id = item.title && item.title['#text'] ? item.title['#text'] : '';
      itemLog.id = id;
      
      if (!id) {
        itemLog.error = 'no title/id provided';
        itemLog.status = 'error';
        return;
      }
      
      // Check if not for publication
      if (item.notForPublication && item.notForPublication['#text'] === 'true') {
        itemLog.status = 'not for publication';
        itemLog.error = 'not for publication';
        return;
      }
      
      // Check package restrictions (simplified for now)
      if (!this.isPackageAllowed(id, source, packageRestrictions)) {
        if (!source.includes('simplifier.net')) {
          const error = `The package ${id} is not allowed to come from ${source}`;
          console.log(error);
          itemLog.error = error;
          itemLog.status = 'prohibited source';
        } else {
          itemLog.status = 'ignored';
          itemLog.error = `The package ${id} is published through another source`;
        }
        return;
      }
      
      // Check if already processed
      if (await this.hasStored(guid)) {
        itemLog.status = 'Already Processed';
        return;
      }
      
      // Parse publication date
      let pubDate;
      try {
        pubDate = this.parsePubDate(item.pubDate && item.pubDate['#text'] ? item.pubDate['#text'] : '');
      } catch (error) {
        itemLog.error = `Invalid date format: ${error.message}`;
        itemLog.status = 'error';
        return;
      }
      
      // Extract URL and fetch package
      const url = this.fixUrl(item.link && item.link['#text'] ? item.link['#text'] : '');
      if (!url) {
        itemLog.error = 'no link provided';
        itemLog.status = 'error';
        return;
      }
      
      itemLog.url = url;
      console.log('Fetching package:', url);
      
      const packageContent = await this.fetchUrl(url, 'application/tar+gzip');
      await this.store(source, url, guid, pubDate, packageContent, id, itemLog);
      
      itemLog.status = 'Fetched';
      
    } catch (error) {
      console.error(`Exception processing item ${itemLog.guid || index}:`, error.message);
      itemLog.status = 'Exception';
      itemLog.error = error.message;
    }
  }

  isPackageAllowed(packageId, source, restrictions) {
    // Simplified package restriction logic
    // TODO: Implement proper restriction checking based on the restrictions array
    return true;
  }

  async hasStored(guid) {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT COUNT(*) as count FROM PackageVersions WHERE GUID = ?', [guid], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count > 0);
        }
      });
    });
  }

  parsePubDate(dateStr) {
    // Handle various RSS date formats
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, ' ').trim();
    
    // Remove day of week if present
    if (cleanDate.includes(',')) {
      cleanDate = cleanDate.substring(cleanDate.indexOf(',') + 1).trim();
    } else if (/^(mon|tue|wed|thu|fri|sat|sun)/.test(cleanDate)) {
      cleanDate = cleanDate.substring(cleanDate.indexOf(' ') + 1).trim();
    }
    
    // Pad single digit day
    if (cleanDate.length > 2 && cleanDate[1] === ' ' && /^\d$/.test(cleanDate[0])) {
      cleanDate = '0' + cleanDate;
    }
    
    // Try to parse the date
    const date = new Date(cleanDate);
    if (isNaN(date.getTime())) {
      throw new Error(`Cannot parse date: ${dateStr}`);
    }
    
    return date;
  }

  async store(source, url, guid, date, packageBuffer, idver, itemLog) {
    try {
      // Extract and parse the NPM package
      const npmPackage = await this.extractNpmPackage(packageBuffer, `${source}#${guid}`);
      
      const { id, version } = npmPackage;
      
      if (`${id}#${version}` !== idver) {
        const warning = `Warning processing ${idver}: actually found ${id}#${version} in the package`;
        console.log(warning);
        itemLog.warning = warning;
      }
      
      // Save to mirror if configured
      if (this.config.mirrorPath) {
        const filename = `${id}-${version}.tgz`;
        const filepath = path.join(this.config.mirrorPath, filename);
        fs.writeFileSync(filepath, packageBuffer);
      }
      
      // Validate package data
      if (!this.isValidPackageId(id)) {
        throw new Error(`NPM Id "${id}" is not valid from ${source}`);
      }
      
      if (!this.isValidSemVersion(version)) {
        throw new Error(`NPM Version "${version}" is not valid from ${source}`);
      }
      
      let canonical = npmPackage.canonical || `http://simplifier.net/packages/${id}`;
      if (!this.isAbsoluteUrl(canonical)) {
        throw new Error(`NPM Canonical "${canonical}" is not valid from ${source}`);
      }
      
      // Extract URLs from package (simplified)
      const urls = this.processPackageUrls(npmPackage);
      
      // Commit to database
      await this.commit(packageBuffer, npmPackage, date, guid, id, version, canonical, urls);
      
    } catch (error) {
      console.error(`Error storing package ${guid}:`, error.message);
      throw error;
    }
  }

  async extractNpmPackage(packageBuffer, source) {
    try {
      const files = {};
      
      // Extract .tgz to memory
      await new Promise((resolve, reject) => {
        const stream = tar.extract({
          gzip: true,
          onentry: (entry) => {
            // Only extract files we need
            const fileName = entry.path.replace(/^package\//, ''); // Remove package/ prefix
            
            if (fileName === 'package.json' || fileName === '.index.json' || fileName === 'ig.ini') {
              const chunks = [];
              
              entry.on('data', (chunk) => {
                chunks.push(chunk);
              });
              
              entry.on('end', () => {
                files[fileName] = Buffer.concat(chunks).toString('utf8');
              });
              
              entry.resume();
            } else {
              entry.resume(); // Skip other files
            }
          }
        });
        
        stream.on('error', reject);
        stream.on('end', resolve);
        
        // Write the package buffer to the stream
        stream.write(packageBuffer);
        stream.end();
      });
      
      // Parse package.json (required)
      if (!files['package.json']) {
        throw new Error('package.json not found in extracted package');
      }
      
      const packageJson = JSON.parse(files['package.json']);
      
      // Extract basic NPM fields
      const id = packageJson.name || '';
      const version = packageJson.version || '';
      const description = packageJson.description || '';
      const author = this.extractAuthor(packageJson.author);
      const license = packageJson.license || '';
      const homepage = packageJson.homepage || packageJson.url || '';
      
      // Extract dependencies
      const dependencies = [];
      if (packageJson.dependencies) {
        for (const [dep, ver] of Object.entries(packageJson.dependencies)) {
          dependencies.push(`${dep}@${ver}`);
        }
      }
      
      // Extract FHIR-specific metadata
      let fhirVersion = '';
      let fhirVersionList = '';
      let canonical = '';
      let kind = 1; // Default to IG
      let notForPublication = false;
      
      // Check for FHIR metadata in package.json
      if (packageJson.fhirVersions) {
        if (Array.isArray(packageJson.fhirVersions)) {
          fhirVersionList = packageJson.fhirVersions.join(',');
          fhirVersion = packageJson.fhirVersions[0] || '';
        } else {
          fhirVersion = packageJson.fhirVersions;
          fhirVersionList = packageJson.fhirVersions;
        }
      } else if (packageJson['fhir-version']) {
        fhirVersion = packageJson['fhir-version'];
        fhirVersionList = packageJson['fhir-version'];
      }
      
      if (packageJson.canonical) {
        canonical = packageJson.canonical;
      }
      
      if (packageJson.type === 'fhir.core') {
        kind = 0; // Core
      } else if (packageJson.type === 'fhir.template') {
        kind = 2; // Template
      } else {
        kind = 1; // IG (Implementation Guide)
      }
      
      if (packageJson.notForPublication === true) {
        notForPublication = true;
      }
      
      // Parse .index.json if present
      if (files['.index.json']) {
        try {
          const indexJson = JSON.parse(files['.index.json']);
          
          // Extract additional metadata from .index.json
          if (indexJson['fhir-version'] && !fhirVersion) {
            fhirVersion = indexJson['fhir-version'];
            fhirVersionList = indexJson['fhir-version'];
          }
          
          if (indexJson.canonical && !canonical) {
            canonical = indexJson.canonical;
          }
        } catch (indexError) {
          console.log(`Warning: Could not parse .index.json for ${id}: ${indexError.message}`);
        }
      }
      
      // Parse ig.ini if present
      if (files['ig.ini']) {
        try {
          const iniData = this.parseIniFile(files['ig.ini']);
          
          if (iniData.IG && iniData.IG.canonical && !canonical) {
            canonical = iniData.IG.canonical;
          }
          
          if (iniData.IG && iniData.IG['fhir-version'] && !fhirVersion) {
            fhirVersion = iniData.IG['fhir-version'];
            fhirVersionList = iniData.IG['fhir-version'];
          }
        } catch (iniError) {
          console.log(`Warning: Could not parse ig.ini for ${id}: ${iniError.message}`);
        }
      }
      
      // Default fhirVersion if not found
      if (!fhirVersion) {
        fhirVersion = '4.0.1'; // Default to R4
        fhirVersionList = '4.0.1';
      }
      
      return {
        id,
        version,
        description,
        canonical,
        fhirVersion,
        fhirVersionList,
        author,
        license,
        url: homepage,
        dependencies,
        kind,
        notForPublication
      };
      
    } catch (error) {
      throw new Error(`Failed to extract NPM package from ${source}: ${error.message}`);
    }
  }

  extractAuthor(author) {
    if (typeof author === 'string') {
      return author;
    } else if (typeof author === 'object' && author.name) {
      return author.name;
    }
    return '';
  }

  parseIniFile(content) {
    const result = {};
    let currentSection = null;
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
        continue;
      }
      
      // Check for section header
      const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        result[currentSection] = {};
        continue;
      }
      
      // Check for key=value pair
      const keyValueMatch = trimmed.match(/^([^=]+)=(.*)$/);
      if (keyValueMatch && currentSection) {
        const key = keyValueMatch[1].trim();
        const value = keyValueMatch[2].trim();
        result[currentSection][key] = value;
      }
    }
    
    return result;
  }

  isValidPackageId(id) {
    // Simple package ID validation
    return /^[a-z0-9][a-z0-9._-]*$/.test(id);
  }

  isValidSemVersion(version) {
    // Simple semantic version validation
    return /^\d+\.\d+\.\d+/.test(version);
  }

  isAbsoluteUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  processPackageUrls(npmPackage) {
    // Extract URLs from package - simplified implementation
    const urls = [];
    if (npmPackage.url) {
      urls.push(npmPackage.url);
    }
    return urls;
  }

  genHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  async commit(packageBuffer, npmPackage, date, guid, id, version, canonical, urls) {
    return new Promise((resolve, reject) => {
      // Get next version key
      this.db.get('SELECT MAX(PackageVersionKey) as maxKey FROM PackageVersions', (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        const vkey = (row?.maxKey || 0) + 1;
        const hash = this.genHash(packageBuffer);
        
        // Insert package version
        const insertVersionSql = `
          INSERT INTO PackageVersions 
          (PackageVersionKey, GUID, PubDate, Indexed, Id, Version, Kind, DownloadCount, 
           Canonical, FhirVersions, UploadCount, Description, ManualToken, Hash, 
           Author, License, HomePage, Content) 
          VALUES (?, ?, ?, datetime('now'), ?, ?, ?, 0, ?, ?, 1, ?, '', ?, ?, ?, ?)
        `;
        
        this.db.run(insertVersionSql, [
          vkey, guid, date.toISOString(), id, version, npmPackage.kind,
          canonical, npmPackage.fhirVersionList, npmPackage.description,
          hash, npmPackage.author, npmPackage.license, npmPackage.url,
          packageBuffer
        ], (err) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Insert FHIR versions, dependencies, and URLs
          this.insertRelatedData(vkey, npmPackage, urls).then(() => {
            // Handle package table (insert or update)
            this.upsertPackage(id, vkey, canonical).then(resolve).catch(reject);
          }).catch(reject);
        });
      });
    });
  }

  async insertRelatedData(vkey, npmPackage, urls) {
    const promises = [];
    
    // Insert FHIR versions
    if (npmPackage.fhirVersionList) {
      const fhirVersions = npmPackage.fhirVersionList.split(',');
      for (const fver of fhirVersions) {
        promises.push(new Promise((resolve, reject) => {
          this.db.run('INSERT INTO PackageFHIRVersions (PackageVersionKey, Version) VALUES (?, ?)', 
            [vkey, fver.trim()], (err) => err ? reject(err) : resolve());
        }));
      }
    }
    
    // Insert dependencies
    for (const dep of npmPackage.dependencies) {
      promises.push(new Promise((resolve, reject) => {
        this.db.run('INSERT INTO PackageDependencies (PackageVersionKey, Dependency) VALUES (?, ?)', 
          [vkey, dep], (err) => err ? reject(err) : resolve());
      }));
    }
    
    // Insert URLs
    for (const url of urls) {
      promises.push(new Promise((resolve, reject) => {
        this.db.run('INSERT INTO PackageURLs (PackageVersionKey, URL) VALUES (?, ?)', 
          [vkey, url], (err) => err ? reject(err) : resolve());
      }));
    }
    
    return Promise.all(promises);
  }

  async upsertPackage(id, vkey, canonical) {
    return new Promise((resolve, reject) => {
      // Check if package exists
      this.db.get('SELECT MAX(PackageKey) as pkey FROM Packages WHERE Id = ?', [id], (err, row) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row?.pkey) {
          // Insert new package
          this.db.get('SELECT MAX(PackageKey) as maxKey FROM Packages', (err, maxRow) => {
            if (err) {
              reject(err);
              return;
            }
            
            const pkey = (maxRow?.maxKey || 0) + 1;
            this.db.run('INSERT INTO Packages (PackageKey, Id, CurrentVersion, DownloadCount, Canonical) VALUES (?, ?, ?, 0, ?)', 
              [pkey, id, vkey, canonical], (err) => err ? reject(err) : resolve());
          });
        } else {
          // Update existing package - check if this is the most recent version
          this.db.get(`
            SELECT PackageVersionKey FROM PackageVersions 
            WHERE Id = ? AND Version != 'current' 
            ORDER BY PubDate DESC, Version DESC LIMIT 1
          `, [id], (err, latestRow) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (latestRow?.PackageVersionKey === vkey) {
              // This is the most recent version, update the package
              this.db.run('UPDATE Packages SET Canonical = ?, CurrentVersion = ? WHERE Id = ?', 
                [canonical, vkey, id], (err) => err ? reject(err) : resolve());
            } else {
              resolve(); // Not the most recent, no update needed
            }
          });
        }
      });
    });
  }

  setupRoutes() {
    // Main packages endpoint
    this.router.get('/', (req, res) => {
      res.json({
        message: 'Packages module',
        version: '1.0.0',
        config: {
          database: this.config.database,
          mirrorPath: this.config.mirrorPath,
          masterUrl: this.config.masterUrl,
          crawlerEnabled: this.config.crawler.enabled,
          crawlerSchedule: this.config.crawler.schedule,
          runsImmediatelyOnStartup: true
        },
        endpoints: [
          'GET / - This information',
          'GET /status - Module status (includes last run info)',
          'POST /crawl - Trigger manual crawl',
          'GET /stats - Crawler statistics (database counts + crawler stats)',
          'GET /log - Latest crawler log',
          'GET /packages - List packages (TODO)',
          'GET /package/:id - Get package details (TODO)'
        ],
        behavior: [
          'Crawler runs immediately on server startup',
          'Then runs on scheduled interval (hourly by default)', 
          'Manual crawler can be triggered anytime via POST /crawl',
          'Respects 429 (Too Many Requests) - stops processing that feed but continues with others',
          'Individual feed failures do not stop the entire crawler'
        ],
        dependencies: {
          required: [
            'npm install axios fast-xml-parser tar'
          ],
          note: 'NPM package extraction is fully implemented - extracts to memory buffers without disk I/O'
        }
      });
    });

    // Module status endpoint
    this.router.get('/status', (req, res) => {
      const status = this.getStatus();
      res.json(status);
    });

    // Manual crawler trigger
    this.router.post('/crawl', async (req, res) => {
      try {
        console.log('Manual crawler triggered via API');
        await this.runWebCrawler();
        res.json({
          message: 'Crawler completed successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Manual crawler failed:', error);
        res.status(500).json({
          error: 'Crawler failed',
          message: error.message
        });
      }
    });

    // Crawler statistics endpoint
    this.router.get('/stats', (req, res) => {
      // Get database statistics
      this.db.get('SELECT COUNT(*) as packageCount FROM Packages', (err, row) => {
        if (err) {
          res.status(500).json({ error: 'Database error', message: err.message });
          return;
        }
        
        this.db.get('SELECT COUNT(*) as versionCount FROM PackageVersions', (err2, row2) => {
          if (err2) {
            res.status(500).json({ error: 'Database error', message: err2.message });
            return;
          }
          
          res.json({
            database: {
              packages: row ? row.packageCount : 0,
              versions: row2 ? row2.versionCount : 0
            },
            crawler: {
              enabled: this.config.crawler.enabled,
              schedule: this.config.crawler.schedule,
              lastRun: this.lastRunTime,
              totalRuns: this.totalRuns,
              lastLog: this.crawlerLog || null
            },
            paths: {
              database: this.config.database,
              mirror: this.config.mirrorPath
            },
            config: {
              masterUrl: this.config.masterUrl
            }
          });
        });
      });
    });

    // Get latest crawler log
    this.router.get('/log', (req, res) => {
      if (this.crawlerLog && this.crawlerLog.feeds) {
        // Add summary statistics
        const summary = {
          totalFeeds: this.crawlerLog.feeds.length,
          successfulFeeds: this.crawlerLog.feeds.filter(f => !f.exception && !f.rateLimited).length,
          failedFeeds: this.crawlerLog.feeds.filter(f => f.exception && !f.rateLimited).length,
          rateLimitedFeeds: this.crawlerLog.feeds.filter(f => f.rateLimited).length,
          totalItems: this.crawlerLog.feeds.reduce((sum, f) => sum + (f.items ? f.items.length : 0), 0)
        };
        
        res.json({
          log: this.crawlerLog,
          summary: summary,
          note: 'This shows the log from the most recent crawler run'
        });
      } else {
        res.json({
          log: this.crawlerLog || null,
          note: 'This shows the log from the most recent crawler run'
        });
      }
    });

    // TODO: Add more endpoints for package management
    // this.router.get('/packages', this.listPackages.bind(this));
    // this.router.get('/package/:id', this.getPackage.bind(this));
  }
  async serveSearch(req, res) {
  const {
    name = '',
    dependson = '',
    canonicalPkg = '',
    canonicalUrl = '',
    fhirVersion = '',
    dependency = '',
    sort = '',
    objWrapper = false
  } = req.query;

  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';

  try {
    const results = await this.searchPackages({
      name,
      dependson,
      canonicalPkg,
      canonicalUrl,
      fhirVersion,
      dependency,
      sort
    });

    // Check if client wants HTML response
    const acceptsHtml = req.headers.accept && req.headers.accept.includes('text/html');
    
    if (acceptsHtml) {
      // Return HTML response (simplified - you'd want a proper template engine)
      const html = this.generateSearchHtml(req, results, {
        name, dependson, canonicalPkg, canonicalUrl, fhirVersion, secure
      });
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } else {
      // Return JSON response
      let responseData;
      
      if (objWrapper) {
        responseData = {
          objects: results.map(pkg => ({ package: pkg }))
        };
      } else {
        responseData = results;
      }
      
      res.json(responseData);
    }
  } catch (error) {
    console.error('Error in search:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
}

async searchPackages(params) {
  const {
    name = '',
    dependson = '',
    canonicalPkg = '',
    canonicalUrl = '',
    fhirVersion = '',
    dependency = '',
    sort = ''
  } = params;

  return new Promise((resolve, reject) => {
    const results = [];
    const deps = [];
    const depsDone = new Set();
    let versioned = false;

    const processSearch = () => {
      let filter = '';
      
      // Build name filter
      if (name) {
        versioned = name.includes('#');
        if (name.includes('#')) {
          const [packageId, version] = name.split('#');
          filter += ` AND PackageVersions.Id LIKE '%${this.escapeSql(packageId)}%' AND PackageVersions.Version LIKE '${this.escapeSql(version)}%'`;
        } else {
          filter += ` AND PackageVersions.Id LIKE '%${this.escapeSql(name)}%'`;
        }
      }

      // Build dependency filters
      if (deps.length > 0) {
        const depList = deps.map(d => `'${this.escapeSql(d)}'`).join(',');
        filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageDependencies.PackageVersionKey FROM PackageDependencies WHERE PackageDependencies.Dependency IN (${depList}))`;
      } else if (dependson) {
        filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageDependencies.PackageVersionKey FROM PackageDependencies WHERE PackageDependencies.Dependency LIKE '%${this.escapeSql(dependson)}%')`;
        versioned = dependson.includes('#');
      }

      // Build canonical package filter
      if (canonicalPkg) {
        if (canonicalPkg.endsWith('%')) {
          filter += ` AND PackageVersions.Canonical LIKE '${this.escapeSql(canonicalPkg)}'`;
        } else {
          filter += ` AND PackageVersions.Canonical = '${this.escapeSql(canonicalPkg)}'`;
        }
      }

      // Build canonical URL filter
      if (canonicalUrl) {
        filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageVersionKey FROM PackageURLs WHERE URL LIKE '${this.escapeSql(canonicalUrl)}%')`;
      }

      // Build FHIR version filter
      if (fhirVersion) {
        const version = this.getVersion(fhirVersion);
        filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageVersionKey FROM PackageFHIRVersions WHERE Version LIKE '${this.escapeSql(version)}%')`;
      }

      // Build dependency filter
      if (dependency) {
        if (dependency.includes('#')) {
          filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageVersionKey FROM PackageDependencies WHERE Dependency LIKE '${this.escapeSql(dependency)}%')`;
        } else if (dependency.includes('|')) {
          const normalizedDep = dependency.replace('|', '#');
          filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageVersionKey FROM PackageDependencies WHERE Dependency LIKE '${this.escapeSql(normalizedDep)}%')`;
        } else {
          filter += ` AND PackageVersions.PackageVersionKey IN (SELECT PackageVersionKey FROM PackageDependencies WHERE Dependency LIKE '${this.escapeSql(dependency)}#%')`;
        }
      }

      // Build SQL query
      let sql;
      if (versioned) {
        sql = `SELECT Id, Version, PubDate, FhirVersions, Kind, Canonical, Description 
               FROM PackageVersions 
               WHERE PackageVersions.PackageVersionKey > 0 ${filter} 
               ORDER BY PubDate`;
      } else {
        sql = `SELECT Packages.Id, Version, PubDate, FhirVersions, Kind, PackageVersions.Canonical, Packages.DownloadCount, Description 
               FROM Packages, PackageVersions 
               WHERE Packages.CurrentVersion = PackageVersions.PackageVersionKey ${filter} 
               ORDER BY PubDate`;
      }

      console.log('Executing search SQL:', sql);

      this.db.all(sql, (err, rows) => {
        if (err) {
          reject(err);
          return;
        }

        deps.length = 0; // Clear deps array

        for (const row of rows) {
          const dep = `${row.Id}#${row.Version}`;
          
          if (!versioned || !depsDone.has(dep)) {
            if (versioned) {
              depsDone.add(dep);
              if (dependson) {
                deps.push(`'${dep}'`);
              }
            }

            const packageInfo = {
              name: row.Id,
              version: row.Version,
              fhirVersion: this.interpretVersion(row.FhirVersions),
              canonical: row.Canonical,
              kind: this.codeForKind(row.Kind),
              url: this.buildPackageUrl(row.Id, row.Version, false) // secure parameter would come from request
            };

            if (row.PubDate) {
              packageInfo.date = new Date(row.PubDate).toISOString();
            }

            if (!versioned && row.DownloadCount) {
              packageInfo.count = row.DownloadCount;
            }

            if (row.Description) {
              packageInfo.description = row.Description;
            }

            results.push(packageInfo);
          }
        }

        // Continue processing if there are more dependencies to resolve
        if (deps.length > 0) {
          setImmediate(processSearch);
        } else {
          // Apply sorting if specified
          const sortedResults = this.applySorting(results, sort);
          resolve(sortedResults);
        }
      });
    };

    processSearch();
  });
}

escapeSql(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

getVersion(fhirVersion) {
  // Map common FHIR version aliases to actual versions
  const versionMap = {
    'R2': '1.0.2',
    'R3': '3.0.2', 
    'R4': '4.0.1',
    'R5': '5.0.0'
  };
  
  return versionMap[fhirVersion] || fhirVersion;
}

interpretVersion(fhirVersions) {
  if (!fhirVersions) return '';
  
  // Handle comma-separated versions
  const versions = fhirVersions.split(',').map(v => v.trim());
  
  // Return the primary version or join multiple versions
  return versions.length === 1 ? versions[0] : versions.join(', ');
}

codeForKind(kind) {
  const kindMap = {
    0: 'fhir.core',
    1: 'fhir.ig', 
    2: 'fhir.template'
  };
  
  return kindMap[kind] || 'fhir.ig';
}

buildPackageUrl(id, version, secure = false) {
  const protocol = secure ? 'https:' : 'http:';
  const baseUrl = this.config.baseUrl || `${protocol}//localhost:${this.config.port || 3000}`;
  return `${baseUrl}/packages/${id}/${version}`;
}

applySorting(results, sort) {
  if (!sort) return results;
  
  const descending = sort.startsWith('-');
  const sortField = descending ? sort.substring(1) : sort;
  
  return results.sort((a, b) => {
    let comparison = 0;
    
    switch (sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'version':
        comparison = this.compareVersions(a.version, b.version);
        break;
      case 'date':
        comparison = new Date(a.date || 0) - new Date(b.date || 0);
        break;
      case 'count':
        comparison = (a.count || 0) - (b.count || 0);
        break;
      default:
        return 0;
    }
    
    return descending ? -comparison : comparison;
  });
}

compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    
    if (aPart !== bPart) {
      return aPart - bPart;
    }
  }
  
  return 0;
}

generateSearchHtml(req, results, params) {
  // Simplified HTML generation - you'd want to use a proper template engine
  const { name, dependson, canonicalPkg, canonicalUrl, fhirVersion, secure } = params;
  
  const baseUrl = this.buildPackageUrl('', '', secure).replace('/packages/', '');
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>FHIR Package Search</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .search-form { background: #f5f5f5; padding: 20px; margin-bottom: 20px; }
        .search-form input, .search-form select { margin: 5px; padding: 5px; }
        .results { margin-top: 20px; }
        .package { border: 1px solid #ddd; margin: 10px 0; padding: 15px; }
        .package-name { font-weight: bold; font-size: 1.2em; }
        .package-details { color: #666; margin-top: 5px; }
      </style>
    </head>
    <body>
      <h1>FHIR Package Search</h1>
      
      <form class="search-form" method="GET">
        <input type="text" name="name" placeholder="Package name" value="${this.escapeHtml(name)}">
        <input type="text" name="dependson" placeholder="Depends on" value="${this.escapeHtml(dependson)}">
        <input type="text" name="canonicalPkg" placeholder="Canonical package" value="${this.escapeHtml(canonicalPkg)}">
        <input type="text" name="canonicalUrl" placeholder="Canonical URL" value="${this.escapeHtml(canonicalUrl)}">
        <select name="fhirVersion">
          <option value="">Any FHIR version</option>
          <option value="R2" ${fhirVersion === 'R2' ? 'selected' : ''}>R2</option>
          <option value="R3" ${fhirVersion === 'R3' ? 'selected' : ''}>R3</option>
          <option value="R4" ${fhirVersion === 'R4' ? 'selected' : ''}>R4</option>
          <option value="R5" ${fhirVersion === 'R5' ? 'selected' : ''}>R5</option>
        </select>
        <button type="submit">Search</button>
      </form>
      
      <div class="results">
        <h2>Results (${results.length} packages found)</h2>
        ${results.map(pkg => `
          <div class="package">
            <div class="package-name">
              <a href="${pkg.url}">${this.escapeHtml(pkg.name)}</a> v${this.escapeHtml(pkg.version)}
            </div>
            <div class="package-details">
              <strong>FHIR Version:</strong> ${this.escapeHtml(pkg.fhirVersion)}<br>
              <strong>Type:</strong> ${this.escapeHtml(pkg.kind)}<br>
              <strong>Canonical:</strong> ${this.escapeHtml(pkg.canonical)}<br>
              ${pkg.description ? `<strong>Description:</strong> ${this.escapeHtml(pkg.description)}<br>` : ''}
              ${pkg.date ? `<strong>Published:</strong> ${new Date(pkg.date).toLocaleDateString()}<br>` : ''}
              ${pkg.count ? `<strong>Downloads:</strong> ${pkg.count}<br>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </body>
    </html>
  `;
}

escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

  async shutdown() {
    console.log('Shutting down Packages module...');
    
    this.stopCrawlerJob();
    
    // Close database connection
    if (this.db) {
      return new Promise((resolve) => {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing packages database:', err.message);
          } else {
            console.log('Packages database connection closed');
          }
          resolve();
        });
      });
    }
    
    console.log('Packages module shut down');
  }

  getStatus() {
    return {
      enabled: true,
      database: {
        connected: this.db ? true : false,
        path: this.config.database
      },
      mirror: {
        path: this.config.mirrorPath,
        exists: fs.existsSync(this.config.mirrorPath)
      },
      crawler: {
        enabled: this.config.crawler.enabled,
        running: this.crawlerJob ? true : false,
        schedule: this.config.crawler.schedule,
        lastRun: this.lastRunTime,
        totalRuns: this.totalRuns
      }
    };
  }
}

module.exports = PackagesModule;