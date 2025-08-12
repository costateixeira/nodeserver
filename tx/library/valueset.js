/**
 * Represents a FHIR ValueSet resource with version conversion support
 * @class
 */
class ValueSet {
  /**
   * The original JSON object (always stored in R5 format internally)
   * @type {Object}
   */
  jsonObj = null;

  /**
   * FHIR version of the loaded ValueSet
   * @type {string}
   */
  version = 'R5';

  /**
   * Map of system(#version)|code to expansion contains item for fast lookup
   * @type {Map<string, Object>}
   */
  codeMap = new Map();

  /**
   * Static factory method for convenience
   * @param {string} jsonString - JSON string representation of ValueSet
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {ValueSet} New ValueSet instance
   */
  static fromJSON(jsonString, version = 'R5') {
    return new ValueSet(JSON.parse(jsonString), version);
  }

  /**
   * Creates a new ValueSet instance
   * @param {Object} jsonObj - The JSON object containing ValueSet data
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @param {string} jsonObj.resourceType - Must be "ValueSet"
   * @param {string} jsonObj.url - Canonical URL for the value set
   * @param {string} [jsonObj.version] - Version of the value set
   * @param {string} jsonObj.name - Name for this value set
   * @param {string} jsonObj.status - Publication status (draft|active|retired|unknown)
   * @param {Object} [jsonObj.compose] - Content logical definition of the value set
   * @param {Object} [jsonObj.expansion] - Used when the value set is "expanded"
   */
  constructor(jsonObj, version = 'R5') {
    this.version = version;
    // Convert to R5 format internally (modifies input for performance)
    this.jsonObj = this._convertToR5(jsonObj, version);
    this.validate();
    this.buildMaps();
  }

  /**
   * Returns JSON string representation
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} JSON string
   */
  toJSONString(version = 'R5') {
    const outputObj = this._convertFromR5(this.jsonObj, version);
    return JSON.stringify(outputObj);
  }

  /**
   * Converts input ValueSet to R5 format (modifies input object for performance)
   * @param {Object} jsonObj - The input ValueSet object
   * @param {string} version - Source FHIR version
   * @returns {Object} The same object, potentially modified to R5 format
   * @private
   */
  _convertToR5(jsonObj, version) {
    if (version === 'R5') {
      return jsonObj; // Already R5, no conversion needed
    }

    if (version === 'R3') {
      // R3 to R5: Remove extensible field (we ignore it completely)
      if (jsonObj.extensible !== undefined) {
        delete jsonObj.extensible;
      }
      return jsonObj;
    }

    if (version === 'R4') {
      // R4 to R5: No structural conversion needed
      // R5 is backward compatible for the structural elements we care about
      return jsonObj;
    }

    throw new Error(`Unsupported FHIR version: ${version}`);
  }

  /**
   * Converts R5 ValueSet to target version format (clones object first)
   * @param {Object} r5Obj - The R5 format ValueSet object
   * @param {string} targetVersion - Target FHIR version
   * @returns {Object} New object in target version format
   * @private
   */
  _convertFromR5(r5Obj, targetVersion) {
    if (targetVersion === 'R5') {
      return r5Obj; // No conversion needed
    }

    // Clone the object to avoid modifying the original
    const cloned = JSON.parse(JSON.stringify(r5Obj));

    if (targetVersion === 'R4') {
      return this._convertR5ToR4(cloned);
    } else if (targetVersion === 'R3') {
      return this._convertR5ToR3(cloned);
    }

    throw new Error(`Unsupported target FHIR version: ${targetVersion}`);
  }

  /**
   * Converts R5 ValueSet to R4 format
   * @param {Object} r5Obj - Cloned R5 ValueSet object
   * @returns {Object} R4 format ValueSet
   * @private
   */
  _convertR5ToR4(r5Obj) {
    // Remove R5-specific elements that don't exist in R4
    if (r5Obj.versionAlgorithmString) {
      delete r5Obj.versionAlgorithmString;
    }
    if (r5Obj.versionAlgorithmCoding) {
      delete r5Obj.versionAlgorithmCoding;
    }

    // Filter out R5-only filter operators in compose
    if (r5Obj.compose && r5Obj.compose.include) {
      r5Obj.compose.include = r5Obj.compose.include.map(include => {
        if (include.filter && Array.isArray(include.filter)) {
          include.filter = include.filter.map(filter => {
            if (filter.op && this._isR5OnlyFilterOperator(filter.op)) {
              // Remove R5-only operators
              return null;
            }
            return filter;
          }).filter(filter => filter !== null);
        }
        return include;
      });
    }

    if (r5Obj.compose && r5Obj.compose.exclude) {
      r5Obj.compose.exclude = r5Obj.compose.exclude.map(exclude => {
        if (exclude.filter && Array.isArray(exclude.filter)) {
          exclude.filter = exclude.filter.map(filter => {
            if (filter.op && this._isR5OnlyFilterOperator(filter.op)) {
              // Remove R5-only operators
              return null;
            }
            return filter;
          }).filter(filter => filter !== null);
        }
        return exclude;
      });
    }

    return r5Obj;
  }

  /**
   * Converts R5 ValueSet to R3 format
   * @param {Object} r5Obj - Cloned R5 ValueSet object
   * @returns {Object} R3 format ValueSet
   * @private
   */
  _convertR5ToR3(r5Obj) {
    // First apply R4 conversions
    const r4Obj = this._convertR5ToR4(r5Obj);

    // R3 has more limited filter operator support
    if (r4Obj.compose && r4Obj.compose.include) {
      r4Obj.compose.include = r4Obj.compose.include.map(include => {
        if (include.filter && Array.isArray(include.filter)) {
          include.filter = include.filter.map(filter => {
            if (filter.op && !this._isR3CompatibleFilterOperator(filter.op)) {
              // Remove non-R3-compatible operators
              return null;
            }
            return filter;
          }).filter(filter => filter !== null);
        }
        return include;
      });
    }

    if (r4Obj.compose && r4Obj.compose.exclude) {
      r4Obj.compose.exclude = r4Obj.compose.exclude.map(exclude => {
        if (exclude.filter && Array.isArray(exclude.filter)) {
          exclude.filter = exclude.filter.map(filter => {
            if (filter.op && !this._isR3CompatibleFilterOperator(filter.op)) {
              // Remove non-R3-compatible operators
              return null;
            }
            return filter;
          }).filter(filter => filter !== null);
        }
        return exclude;
      });
    }

    return r4Obj;
  }

  /**
   * Checks if a filter operator is R5-only
   * @param {string} operator - Filter operator code
   * @returns {boolean} True if operator is R5-only
   * @private
   */
  _isR5OnlyFilterOperator(operator) {
    const r5OnlyOperators = [
      'generalizes',  // Added in R5
      // Add other R5-only operators as they're identified
    ];
    return r5OnlyOperators.includes(operator);
  }

  /**
   * Checks if a filter operator is compatible with R3
   * @param {string} operator - Filter operator code
   * @returns {boolean} True if operator is R3-compatible
   * @private
   */
  _isR3CompatibleFilterOperator(operator) {
    const r3CompatibleOperators = [
      '=',           // Equal
      'is-a',        // Is-A relationship
      'descendent-of', // Descendant of (note: R3 spelling)
      'is-not-a',    // Is-Not-A relationship
      'regex',       // Regular expression
      'in',          // In set
      'not-in',      // Not in set
      'exists',      // Property exists
    ];
    return r3CompatibleOperators.includes(operator);
  }

  /**
   * Gets the FHIR version this ValueSet was loaded from
   * @returns {string} FHIR version ('R3', 'R4', or 'R5')
   */
  getFHIRVersion() {
    return this.version;
  }

  /**
   * Validates that this is a proper ValueSet resource
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.jsonObj || typeof this.jsonObj !== 'object') {
      throw new Error('Invalid ValueSet: expected object');
    }

    if (this.jsonObj.resourceType !== 'ValueSet') {
      throw new Error(`Invalid ValueSet: resourceType must be "ValueSet", got "${this.jsonObj.resourceType}"`);
    }

    if (!this.jsonObj.url || typeof this.jsonObj.url !== 'string') {
      throw new Error('Invalid ValueSet: url is required and must be a string');
    }

    if (!this.jsonObj.name || typeof this.jsonObj.name !== 'string') {
      throw new Error('Invalid ValueSet: name is required and must be a string');
    }

    if (!this.jsonObj.status || typeof this.jsonObj.status !== 'string') {
      throw new Error('Invalid ValueSet: status is required and must be a string');
    }

    const validStatuses = ['draft', 'active', 'retired', 'unknown'];
    if (!validStatuses.includes(this.jsonObj.status)) {
      throw new Error(`Invalid ValueSet: status must be one of ${validStatuses.join(', ')}, got "${this.jsonObj.status}"`);
    }

    // Validate identifier - should always be array (no conversion needed for ValueSet)
    if (this.jsonObj.identifier && !Array.isArray(this.jsonObj.identifier)) {
      throw new Error('Invalid ValueSet: identifier should be an array');
    }

    // Validate compose structure if present
    if (this.jsonObj.compose) {
      if (this.jsonObj.compose.include && !Array.isArray(this.jsonObj.compose.include)) {
        throw new Error('Invalid ValueSet: compose.include must be an array if present');
      }
      if (this.jsonObj.compose.exclude && !Array.isArray(this.jsonObj.compose.exclude)) {
        throw new Error('Invalid ValueSet: compose.exclude must be an array if present');
      }
    }

    // Validate expansion structure if present
    if (this.jsonObj.expansion) {
      if (this.jsonObj.expansion.contains && !Array.isArray(this.jsonObj.expansion.contains)) {
        throw new Error('Invalid ValueSet: expansion.contains must be an array if present');
      }
    }
  }

  /**
   * Builds internal maps for fast expansion lookup
   * @private
   */
  buildMaps() {
    this.codeMap.clear();

    if (!this.jsonObj.expansion || !this.jsonObj.expansion.contains) {
      return;
    }

    // Build map of system(#version)|code -> expansion contains item
    this._buildExpansionMap(this.jsonObj.expansion.contains);
  }

  /**
   * Recursively builds expansion map from contains items
   * @param {Object[]} contains - Array of expansion contains items
   * @private
   */
  _buildExpansionMap(contains) {
    contains.forEach(item => {
      if (item.system && item.code) {
        const key = this._buildCodeKey(item.system, item.version, item.code);
        this.codeMap.set(key, item);
      }

      // Handle nested contains (hierarchical expansions)
      if (item.contains && Array.isArray(item.contains)) {
        this._buildExpansionMap(item.contains);
      }
    });
  }

  /**
   * Builds a lookup key for system(#version)|code
   * @param {string} system - Code system URL
   * @param {string} [version] - Code system version
   * @param {string} code - Code value
   * @returns {string} Lookup key
   * @private
   */
  _buildCodeKey(system, version, code) {
    if (version) {
      return `${system}#${version}|${code}`;
    }
    return `${system}|${code}`;
  }

  /**
   * Gets an expansion item by system and code
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @param {string} [version] - Code system version
   * @returns {Object|undefined} The expansion contains item or undefined if not found
   */
  getCode(system, code, version = null) {
    const key = this._buildCodeKey(system, version, code);
    return this.codeMap.get(key);
  }

  /**
   * Checks if a code exists in this value set expansion
   * @param {string} system - Code system URL
   * @param {string} code - Code value
   * @param {string} [version] - Code system version
   * @returns {boolean} True if the code exists in expansion
   */
  hasCode(system, code, version = null) {
    const key = this._buildCodeKey(system, version, code);
    return this.codeMap.has(key);
  }

  /**
   * Gets all codes in this value set expansion
   * @returns {Object[]} Array of {system, version, code, display} objects
   */
  getAllCodes() {
    return Array.from(this.codeMap.values()).map(item => ({
      system: item.system,
      version: item.version,
      code: item.code,
      display: item.display
    }));
  }

  /**
   * Gets all codes from a specific system
   * @param {string} system - Code system URL
   * @param {string} [version] - Code system version
   * @returns {Object[]} Array of expansion contains items from the system
   */
  getCodesFromSystem(system, version = null) {
    return Array.from(this.codeMap.values()).filter(item => {
      if (version) {
        return item.system === system && item.version === version;
      }
      return item.system === system;
    });
  }

  /**
   * Gets all unique systems in this value set expansion
   * @returns {string[]} Array of system URLs
   */
  getSystems() {
    const systems = new Set();
    this.codeMap.forEach(item => {
      if (item.system) {
        systems.add(item.system);
      }
    });
    return Array.from(systems);
  }

  /**
   * Checks if the value set is expanded (has expansion.contains)
   * @returns {boolean} True if the value set has an expansion
   */
  isExpanded() {
    return !!(this.jsonObj.expansion && this.jsonObj.expansion.contains && this.jsonObj.expansion.contains.length > 0);
  }

  /**
   * Gets the total count from expansion, if available
   * @returns {number|undefined} Total count or undefined if not available
   */
  getExpansionTotal() {
    return this.jsonObj.expansion?.total;
  }

  /**
   * Gets basic info about this value set
   * @returns {Object} Basic information object
   */
  getInfo() {
    return {
      resourceType: this.jsonObj.resourceType,
      url: this.jsonObj.url,
      version: this.jsonObj.version,
      name: this.jsonObj.name,
      title: this.jsonObj.title,
      status: this.jsonObj.status,
      fhirVersion: this.version,
      isExpanded: this.isExpanded(),
      expansionTotal: this.getExpansionTotal(),
      codeCount: this.codeMap.size,
      systemCount: this.getSystems().length
    };
  }
}

module.exports = ValueSet;