/**
 * Represents a FHIR NamingSystem resource with version conversion support
 * @class
 */
class NamingSystem {
  /**
   * The original JSON object (always stored in R5 format internally)
   * @type {Object}
   */
  jsonObj = null;

  /**
   * FHIR version of the loaded NamingSystem
   * @type {string}
   */
  version = 'R5';

  /**
   * Static factory method for convenience
   * @param {string} jsonString - JSON string representation of NamingSystem
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {NamingSystem} New NamingSystem instance
   */
  static fromJSON(jsonString, version = 'R5') {
    return new NamingSystem(JSON.parse(jsonString), version);
  }

  /**
   * Creates a new NamingSystem instance
   * @param {Object} jsonObj - The JSON object containing NamingSystem data
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @param {string} jsonObj.resourceType - Must be "NamingSystem"
   * @param {string} jsonObj.name - Name for this naming system
   * @param {string} jsonObj.status - Publication status (draft|active|retired|unknown)
   * @param {string} jsonObj.kind - Identifies the purpose of the naming system
   * @param {Object[]} jsonObj.uniqueId - Unique identifiers used for system
   */
  constructor(jsonObj, version = 'R5') {
    this.version = version;
    // Convert to R5 format internally (modifies input for performance)
    this.jsonObj = this._convertToR5(jsonObj, version);
    this.validate();
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
   * Converts input NamingSystem to R5 format (modifies input object for performance)
   * @param {Object} jsonObj - The input NamingSystem object
   * @param {string} version - Source FHIR version
   * @returns {Object} The same object, potentially modified to R5 format
   * @private
   */
  _convertToR5(jsonObj, version) {
    if (version === 'R5') {
      return jsonObj; // Already R5, no conversion needed
    }

    if (version === 'R3') {
      // R3 to R5: Remove replacedBy field (we ignore it completely)
      if (jsonObj.replacedBy !== undefined) {
        delete jsonObj.replacedBy;
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
   * Converts R5 NamingSystem to target version format (clones object first)
   * @param {Object} r5Obj - The R5 format NamingSystem object
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
   * Converts R5 NamingSystem to R4 format
   * @param {Object} r5Obj - Cloned R5 NamingSystem object
   * @returns {Object} R4 format NamingSystem
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

    return r5Obj;
  }

  /**
   * Converts R5 NamingSystem to R3 format
   * @param {Object} r5Obj - Cloned R5 NamingSystem object
   * @returns {Object} R3 format NamingSystem
   * @private
   */
  _convertR5ToR3(r5Obj) {
    // First apply R4 conversions
    const r4Obj = this._convertR5ToR4(r5Obj);

    // R3 doesn't have some R4/R5 fields, but we'll just let them through
    // since most additions are backward compatible in JSON

    return r4Obj;
  }

  /**
   * Gets the FHIR version this NamingSystem was loaded from
   * @returns {string} FHIR version ('R3', 'R4', or 'R5')
   */
  getFHIRVersion() {
    return this.version;
  }

  /**
   * Validates that this is a proper NamingSystem resource
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.jsonObj || typeof this.jsonObj !== 'object') {
      throw new Error('Invalid NamingSystem: expected object');
    }

    if (this.jsonObj.resourceType !== 'NamingSystem') {
      throw new Error(`Invalid NamingSystem: resourceType must be "NamingSystem", got "${this.jsonObj.resourceType}"`);
    }

    if (!this.jsonObj.name || typeof this.jsonObj.name !== 'string') {
      throw new Error('Invalid NamingSystem: name is required and must be a string');
    }

    if (!this.jsonObj.status || typeof this.jsonObj.status !== 'string') {
      throw new Error('Invalid NamingSystem: status is required and must be a string');
    }

    const validStatuses = ['draft', 'active', 'retired', 'unknown'];
    if (!validStatuses.includes(this.jsonObj.status)) {
      throw new Error(`Invalid NamingSystem: status must be one of ${validStatuses.join(', ')}, got "${this.jsonObj.status}"`);
    }

    if (!this.jsonObj.kind || typeof this.jsonObj.kind !== 'string') {
      throw new Error('Invalid NamingSystem: kind is required and must be a string');
    }

    const validKinds = ['codesystem', 'identifier', 'root'];
    if (!validKinds.includes(this.jsonObj.kind)) {
      throw new Error(`Invalid NamingSystem: kind must be one of ${validKinds.join(', ')}, got "${this.jsonObj.kind}"`);
    }

    if (!this.jsonObj.uniqueId || !Array.isArray(this.jsonObj.uniqueId)) {
      throw new Error('Invalid NamingSystem: uniqueId is required and must be an array');
    }

    if (this.jsonObj.uniqueId.length === 0) {
      throw new Error('Invalid NamingSystem: uniqueId array cannot be empty');
    }

    // Validate individual uniqueId entries
    this.jsonObj.uniqueId.forEach((uid, index) => {
      if (!uid.type || typeof uid.type !== 'string') {
        throw new Error(`Invalid NamingSystem: uniqueId[${index}].type is required and must be a string`);
      }

      const validTypes = ['oid', 'uuid', 'uri', 'other'];
      if (!validTypes.includes(uid.type)) {
        throw new Error(`Invalid NamingSystem: uniqueId[${index}].type must be one of ${validTypes.join(', ')}, got "${uid.type}"`);
      }

      if (!uid.value || typeof uid.value !== 'string') {
        throw new Error(`Invalid NamingSystem: uniqueId[${index}].value is required and must be a string`);
      }
    });
  }

  /**
   * Gets unique identifiers of a specific type
   * @param {string} type - Type of identifier ('oid', 'uuid', 'uri', 'other')
   * @returns {Object[]} Array of uniqueId objects of the specified type
   */
  getUniqueIdsByType(type) {
    return this.jsonObj.uniqueId.filter(uid => uid.type === type);
  }

  /**
   * Gets all unique identifier values of a specific type
   * @param {string} type - Type of identifier ('oid', 'uuid', 'uri', 'other')
   * @returns {string[]} Array of identifier values
   */
  getUniqueIdValues(type) {
    return this.getUniqueIdsByType(type).map(uid => uid.value);
  }

  /**
   * Checks if the naming system has a unique identifier of a specific type and value
   * @param {string} type - Type of identifier ('oid', 'uuid', 'uri', 'other')
   * @param {string} value - Identifier value to check
   * @returns {boolean} True if the identifier exists
   */
  hasUniqueId(type, value) {
    return this.jsonObj.uniqueId.some(uid => uid.type === type && uid.value === value);
  }

  /**
   * Gets the preferred unique identifier (marked as preferred=true)
   * @returns {Object|undefined} Preferred uniqueId object or undefined if none marked as preferred
   */
  getPreferredUniqueId() {
    return this.jsonObj.uniqueId.find(uid => uid.preferred === true);
  }

  /**
   * Gets all unique identifiers, optionally filtered by preferred status
   * @param {boolean} [preferredOnly=false] - If true, return only preferred identifiers
   * @returns {Object[]} Array of uniqueId objects
   */
  getAllUniqueIds(preferredOnly = false) {
    if (preferredOnly) {
      return this.jsonObj.uniqueId.filter(uid => uid.preferred === true);
    }
    return [...this.jsonObj.uniqueId];
  }

  /**
   * Gets the naming system kind
   * @returns {string} The kind ('codesystem', 'identifier', 'root')
   */
  getKind() {
    return this.jsonObj.kind;
  }

  /**
   * Checks if this is a code system naming system
   * @returns {boolean} True if kind is 'codesystem'
   */
  isCodeSystem() {
    return this.jsonObj.kind === 'codesystem';
  }

  /**
   * Checks if this is an identifier naming system
   * @returns {boolean} True if kind is 'identifier'
   */
  isIdentifier() {
    return this.jsonObj.kind === 'identifier';
  }

  /**
   * Checks if this is a root naming system
   * @returns {boolean} True if kind is 'root'
   */
  isRoot() {
    return this.jsonObj.kind === 'root';
  }

  /**
   * Gets usage information if available
   * @returns {string|undefined} Usage information or undefined if not present
   */
  getUsage() {
    return this.jsonObj.usage;
  }

  /**
   * Gets basic info about this naming system
   * @returns {Object} Basic information object
   */
  getInfo() {
    const preferred = this.getPreferredUniqueId();
    return {
      resourceType: this.jsonObj.resourceType,
      name: this.jsonObj.name,
      title: this.jsonObj.title,
      status: this.jsonObj.status,
      kind: this.jsonObj.kind,
      fhirVersion: this.version,
      uniqueIdCount: this.jsonObj.uniqueId.length,
      preferredId: preferred ? `${preferred.type}:${preferred.value}` : null,
      types: [...new Set(this.jsonObj.uniqueId.map(uid => uid.type))],
      usage: this.getUsage()
    };
  }
}


module.exports = { NamingSystem };