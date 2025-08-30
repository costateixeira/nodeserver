/**
 * PackageManager - FHIR Package management with caching
 * Fetches and caches FHIR packages from package servers
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const zlib = require('zlib');
const tar = require('tar');
const axios = require('axios');
const { VersionUtilities } = require('../library/version-utilities');

class PackageManager {
    totalDownloaded = 0;

    /**
     * @param {string[]} packageServers - Ordered list of package server URLs
     * @param {string} cacheFolder - Local folder for cached content
     */
    constructor(packageServers, cacheFolder) {
        if (!packageServers || packageServers.length === 0) {
            throw new Error('At least one package server must be provided');
        }
        this.packageServers = packageServers;
        this.cacheFolder = cacheFolder;
    }

    /**
     * Fetch a package, either from cache or from servers
     * @param {string} packageId - Package identifier (e.g., 'hl7.fhir.us.core')
     * @param {string} version - Version string (may contain wildcards)
     * @returns {Promise<string>} Path to extracted package folder
     */
    async fetch(packageId, version) {
        // First, resolve the version if it contains wildcards
        const resolvedVersion = await this.resolveVersion(packageId, version);

        // Check cache first
        const cachedPath = await this.checkCache(packageId, resolvedVersion);
        if (cachedPath) {
            return cachedPath;
        }

        console.log("Fetch Package "+packageId+"#"+version);
        // Not in cache, fetch from servers
        const packageData = await this.fetchFromServers(packageId, resolvedVersion);

        this.totalDownloaded = this.totalDownloaded + packageData.length;
        // Extract to cache
        const extractedPath = await this.extractToCache(packageId, resolvedVersion, packageData);

        return extractedPath;
    }

    /**
     * Resolve version with wildcards to a specific version
     * @param {string} packageId - Package identifier
     * @param {string} version - Version string (may contain wildcards)
     * @returns {Promise<string>} Resolved specific version
     */
    async resolveVersion(packageId, version) {
        // If no wildcards, return as-is
        if (!VersionUtilities.versionHasWildcards(version) && version != null) {
            return version;
        }

        // Need to get version list and find best match
        for (const server of this.packageServers) {
            try {
                const versions = await this.getPackageVersions(server, packageId);
                const resolvedVersion = this.selectBestVersion(versions, version);
                if (resolvedVersion) {
                    return resolvedVersion;
                }
            } catch (error) {
                // Try next server
                continue;
            }
        }

        throw new Error(`Could not resolve version ${version} for package ${packageId}`);
    }

    /**
     * Get list of available versions for a package from a server
     * @param {string} server - Server URL
     * @param {string} packageId - Package identifier
     * @returns {Promise<string[]>} Array of version strings
     */
    async getPackageVersions(server, packageId) {
        const url = `${server}/${packageId}`;

        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const client = parsedUrl.protocol === 'https:' ? https : http;

            const req = client.get(url, {
                headers: {
                    'Accept': 'application/json'
                }
            }, (res) => {
                if (res.statusCode === 404) {
                    reject(new Error(`Package ${packageId} not found on ${server}`));
                    return;
                }

                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode} from ${server}`));
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        const versions = Object.keys(json.versions || {});
                        resolve(versions);
                    } catch (error) {
                        reject(new Error(`Invalid JSON from ${server}: ${error.message}`));
                    }
                });
            });

            req.on('error', reject);
            req.end();
        });
    }

    /**
     * Select the best matching version from available versions
     * @param {string[]} availableVersions - List of available versions
     * @param {string} criteria - Version criteria (may contain wildcards)
     * @returns {string|null} Best matching version or null if none match
     */
    selectBestVersion(availableVersions, criteria) {
        const sortedVersions = [...availableVersions].sort((a, b) => {
            try {
                return -VersionUtilities.compareVersions(a, b);
            } catch (error) {
                return 0;
            }
        });

        if (criteria == null) {
            return sortedVersions.length == 0 ? null : sortedVersions[0];
        }
        // Filter versions that match the criteria
        const matchingVersions = sortedVersions.filter(v => {
            try {
                return VersionUtilities.versionMatches(criteria, v);
            } catch (error) {
                return false;
            }
        });

        if (matchingVersions.length === 0) {
            return null;
        }

        // Sort by version (newest first) using compareVersions
        matchingVersions.sort((a, b) => {
            try {
                return -VersionUtilities.compareVersions(a, b);
            } catch (error) {
                return 0;
            }
        });

        return matchingVersions[0];
    }

    /**
     * Check if package exists in cache
     * @param {string} packageId - Package identifier
     * @param {string} version - Specific version
     * @returns {Promise<string|null>} Path to cached package or null if not found
     */
    async checkCache(packageId, version) {
        const packageName = `${packageId}#${version}`;
        const packagePath = path.join(this.cacheFolder, packageName);

        try {
            const stats = await fs.stat(packagePath);
            if (stats.isDirectory()) {
                return packageName;
            }
        } catch (error) {
            // Not found or not accessible
        }

        return null;
    }

    /**
     * Fetch package data from servers
     * @param {string} packageId - Package identifier
     * @param {string} version - Specific version
     * @returns {Promise<Buffer>} Package tar.gz data
     */
    async fetchFromServers(packageId, version) {
        let lastError = null;

        for (const server of this.packageServers) {
            try {
                const packageData = await this.fetchFromServer(server, packageId, version);
                return packageData;
            } catch (error) {
                lastError = error;
                // Try next server
                continue;
            }
        }

        throw new Error(`Failed to fetch ${packageId}#${version} from any server. Last error: ${lastError?.message}`);
    }

    /**
     * Fetch package data from a specific server
     * @param {string} server - Server URL
     * @param {string} packageId - Package identifier
     * @param {string} version - Specific version
     * @returns {Promise<Buffer>} Package tar.gz data
     */
    async fetchFromServer(server, packageId, version) {
        const url = `${server}/${packageId}/${version}`;

        try {
            const response = await axios.get(url, {
                headers: {
                    'Accept': 'application/tar+gzip'
                },
                responseType: 'arraybuffer',
                maxRedirects: 5
            });

            return Buffer.from(response.data);
        } catch (error) {
            if (error.response?.status === 404) {
                throw new Error(`Package ${packageId}#${version} not found on ${server}`);
            }
            throw new Error(`HTTP ${error.response?.status || 'error'} from ${server}: ${error.message}`);
        }
    }

    /**
     * Extract package to cache folder
     * @param {string} packageId - Package identifier
     * @param {string} version - Specific version
     * @param {Buffer} packageData - Package tar.gz data
     * @returns {Promise<string>} Path to extracted package
     */
    async extractToCache(packageId, version, packageData) {
        const packageName = `${packageId}#${version}`;
        const packagePath = path.join(this.cacheFolder, packageName);

        // Ensure cache folder exists
        await fs.mkdir(this.cacheFolder, { recursive: true });

        // Create package folder
        await fs.mkdir(packagePath, { recursive: true });

        // Extract tar.gz
        return new Promise((resolve, reject) => {
            const gunzip = zlib.createGunzip();
            const extract = tar.extract({
                cwd: packagePath,
                strict: true
            });

            gunzip.on('error', reject);
            extract.on('error', reject);
            extract.on('finish', () => resolve(packageName));

            // Create a readable stream from the buffer and pipe through gunzip to tar
            const stream = require('stream');
            const bufferStream = new stream.PassThrough();
            bufferStream.end(packageData);

            bufferStream
                .pipe(gunzip)
                .pipe(extract);
        });
    }
}

class PackageContentLoader {
    /**
     * @param {string} packageFolder - Path to the extracted NPM package folder
     */
    constructor(packageFolder) {
        this.packageFolder = packageFolder;
        this.packageSubfolder = path.join(packageFolder, 'package');
        this.indexPath = path.join(this.packageSubfolder, '.index.json');
        this.index = null;
        this.indexByTypeAndId = new Map();
        this.indexByCanonical = new Map();
        this.loaded = false;
    }

    /**
     * Initialize the loader by reading and parsing the index
     * @returns {Promise<void>}
     */
    async initialize() {
        if (this.loaded) {
            return;
        }

        const packageSource = path.join(this.packageFolder, 'package', 'package.json');
        const packageContent = await fs.readFile(packageSource, 'utf8');
        this.package = JSON.parse(packageContent);

        try {
            const indexContent = await fs.readFile(this.indexPath, 'utf8');
            this.index = JSON.parse(indexContent);

            if (!this.index.files || !Array.isArray(this.index.files)) {
                throw new Error('Invalid index file: missing or invalid files array');
            }

            // Build lookup structures
            this.buildIndexes();
            this.loaded = true;
        } catch (error) {
            throw new Error(`Failed to load package index from ${this.indexPath}: ${error.message}`);
        }
    }

    /**
     * Build internal indexes for efficient lookups
     */
    buildIndexes() {
        for (const entry of this.index.files) {
            // Index by resourceType and id
            if (entry.resourceType && entry.id) {
                const key = `${entry.resourceType}/${entry.id}`;
                this.indexByTypeAndId.set(key, entry);
            }

            // Index by canonical URL (with and without version)
            if (entry.url) {
                // Index without version
                this.indexByCanonical.set(entry.url, entry);

                // Index with version if present
                if (entry.version) {
                    const versionedUrl = `${entry.url}|${entry.version}`;
                    this.indexByCanonical.set(versionedUrl, entry);
                }
            }
        }
    }

    /**
     * Load a resource by reference
     * @param {Object} reference - Reference object
     * @param {string} [reference.resourceType] - Resource type
     * @param {string} [reference.id] - Resource id
     * @param {string} [reference.url] - Canonical URL
     * @param {string} [reference.version] - Version (optional)
     * @returns {Promise<Object|null>} Loaded resource or null if not found
     */
    async loadByReference(reference) {
        await this.initialize();

        let entry = null;

        // Try to find by resourceType and id
        if (reference.resourceType && reference.id) {
            const key = `${reference.resourceType}/${reference.id}`;
            entry = this.indexByTypeAndId.get(key);
        }

        // Try to find by canonical URL
        if (!entry && reference.url) {
            if (reference.version) {
                // Try with version first
                const versionedUrl = `${reference.url}|${reference.version}`;
                entry = this.indexByCanonical.get(versionedUrl);
            }

            // Try without version if not found
            if (!entry) {
                entry = this.indexByCanonical.get(reference.url);
            }
        }

        if (!entry) {
            return null;
        }

        return await this.loadFile(entry);
    }

    /**
     * Get a list of resources of a given type
     * @param {string} resourceType - The resource type to filter by
     * @returns {Promise<Array>} Array of index entries for the given type
     */
    async getResourcesByType(resourceType) {
        await this.initialize();

        return this.index.files.filter(entry => entry.resourceType === resourceType);
    }

    /**
     * Load all files that pass a given filter
     * @param {Function} filterFn - Filter function that takes an index entry and returns boolean
     * @returns {Promise<Array>} Array of loaded resources that pass the filter
     */
    async loadByFilter(filterFn) {
        await this.initialize();

        const filteredEntries = this.index.files.filter(filterFn);
        const loadPromises = filteredEntries.map(entry => this.loadFile(entry));

        return await Promise.all(loadPromises);
    }

    /**
     * Load a single file based on its index entry
     * @param {Object} entry - Index entry
     * @returns {Promise<Object>} Loaded resource
     */
    async loadFile(entry) {
        if (!entry.filename) {
            throw new Error('Index entry missing filename');
        }

        const filePath = path.join(this.packageSubfolder, entry.filename);

        try {
            const content = await fs.readFile(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            throw new Error(`Failed to load file ${entry.filename}: ${error.message}`);
        }
    }

    /**
     * Get the raw index data
     * @returns {Promise<Object>} The index object
     */
    async getIndex() {
        await this.initialize();
        return this.index;
    }

    /**
     * Get all resources (index entries only, not loaded)
     * @returns {Promise<Array>} All index entries
     */
    async getAllResources() {
        await this.initialize();
        return this.index.files;
    }

    /**
     * Check if a resource exists by reference
     * @param {Object} reference - Reference object (same as loadByReference)
     * @returns {Promise<boolean>} True if resource exists
     */
    async exists(reference) {
        await this.initialize();

        // Check by resourceType and id
        if (reference.resourceType && reference.id) {
            const key = `${reference.resourceType}/${reference.id}`;
            if (this.indexByTypeAndId.has(key)) {
                return true;
            }
        }

        // Check by canonical URL
        if (reference.url) {
            if (reference.version) {
                const versionedUrl = `${reference.url}|${reference.version}`;
                if (this.indexByCanonical.has(versionedUrl)) {
                    return true;
                }
            }

            if (this.indexByCanonical.has(reference.url)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Get statistics about the package content
     * @returns {Promise<Object>} Statistics object
     */
    async getStatistics() {
        await this.initialize();

        const stats = {
            totalResources: this.index.files.length,
            indexVersion: this.index['index-version'],
            resourceTypes: {}
        };

        for (const entry of this.index.files) {
            if (entry.resourceType) {
                stats.resourceTypes[entry.resourceType] =
                    (stats.resourceTypes[entry.resourceType] || 0) + 1;
            }
        }

        return stats;
    }

    fhirVersion() {
        return this.package.fhirVersions[0];
    }

    id() {
        return this.package.name;
    }

    version() {
        return this.package.version;
    }
}


module.exports = { PackageManager, PackageContentLoader };