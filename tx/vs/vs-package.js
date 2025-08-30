const path = require('path');
const { AbstractValueSetProvider } = require('./vs-api');
const { PackageContentLoader } = require('../../library/package-manager');
const { ValueSetDatabase } = require('./vs-database');
const { VersionUtilities } = require('../../library/version-utilities');
const {validateParameter} = require("../../library/utilities");

/**
 * Package-based ValueSet provider using shared database layer
 */
class PackageValueSetProvider extends AbstractValueSetProvider {
  /**
   * @param {PackageContentLoader} packageLoader - Path to the extracted package folder
   */
  constructor(packageLoader) {
    super();
    validateParameter(packageLoader, "packageLoader", PackageContentLoader);
    this.packageLoader = packageLoader;
    this.dbPath = path.join(packageLoader.packageFolder, '.valuesets.db');
    this.database = new ValueSetDatabase(this.dbPath);
    this.valueSetMap = new Map();
    this.initialized = false;
    this.count = 0;
  }

  /**
   * Initialize the provider - check/create database and load value sets into memory
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    const dbExists = await this.database.exists();

    if (!dbExists) {
      await this.database.create();
      await this._populateDatabase();
    }

    this.valueSetMap = await this.database.loadAllValueSets();
    this.initialized = true;
  }

  /**
   * Populate the database with value sets from the package
   * @returns {Promise<void>}
   * @private
   */
  async _populateDatabase() {
    // Get all ValueSet resources
    const valueSetEntries = await this.packageLoader.getResourcesByType('ValueSet');

    if (valueSetEntries.length === 0) {
      return; // No value sets in this package
    }

    const valueSets = [];
    for (const entry of valueSetEntries) {
      const valueSet = await this.packageLoader.loadFile(entry);
      if (valueSet.url) {
        valueSets.push(valueSet);
      }
    }

    if (valueSets.length > 0) {
      await this.database.batchUpsertValueSets(valueSets);
    }
  }

  /**
   * Fetches a value set by URL and version
   * @param {string} url - The canonical URL of the value set
   * @param {string} version - The version of the value set
   * @returns {Promise<Object>} The requested value set
   */
  async fetchValueSet(url, version) {
    await this.initialize();
    this._validateFetchParams(url, version);

    // Try exact match first: url|version
    let key = `${url}|${version}`;
    if (this.valueSetMap.has(key)) {
      return this.valueSetMap.get(key);
    }

    // If version is semver, try url|major.minor
    try {
      if (VersionUtilities.isSemVer(version)) {
        const majorMinor = VersionUtilities.getMajMin(version);
        if (majorMinor) {
          key = `${url}|${majorMinor}`;
          if (this.valueSetMap.has(key)) {
            return this.valueSetMap.get(key);
          }
        }
      }
    } catch (error) {
      // Ignore version parsing errors
    }

    // Finally try just the URL
    if (this.valueSetMap.has(url)) {
      return this.valueSetMap.get(url);
    }

    throw new Error(`Value set not found: ${url} version ${version}`);
  }

  /**
   * Searches for value sets based on criteria
   * @param {Array<{name: string, value: string}>} searchParams - Search criteria
   * @returns {Promise<Array<Object>>} List of matching value sets
   */
  async searchValueSets(searchParams) {
    await this.initialize();
    this._validateSearchParams(searchParams);

    if (searchParams.length === 0) {
      return [];
    }

    return await this.database.search(searchParams);
  }

  /**
   * Get statistics about the loaded value sets
   * @returns {Promise<Object>} Statistics object
   */
  async getStatistics() {
    await this.initialize();
    return await this.database.getStatistics();
  }

  /**
   * Get the number of value sets loaded into memory
   * @returns {number} Number of unique value sets in map
   */
  getMapSize() {
    const uniqueUrls = new Set();
    for (const [key, valueSet] of this.valueSetMap.entries()) {
      if (!key.includes('|')) { // Only count base URL keys
        uniqueUrls.add(valueSet.url);
      }
    }
    return uniqueUrls.size;
  }
}

module.exports = {
  PackageValueSetProvider
};