/**
 * Represents a FHIR ConceptMap resource with version conversion support
 * @class
 */
class ConceptMap {
  /**
   * The original JSON object (always stored in R5 format internally)
   * @type {Object}
   */
  jsonObj = null;

  /**
   * FHIR version of the loaded ConceptMap
   * @type {string}
   */
  version = 'R5';

  /**
   * Static factory method for convenience
   * @param {string} jsonString - JSON string representation of ConceptMap
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {ConceptMap} New ConceptMap instance
   */
  static fromJSON(jsonString, version = 'R5') {
    return new ConceptMap(JSON.parse(jsonString), version);
  }

  /**
   * Creates a new ConceptMap instance
   * @param {Object} jsonObj - The JSON object containing ConceptMap data
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @param {string} jsonObj.resourceType - Must be "ConceptMap"
   * @param {string} jsonObj.url - Canonical URL for the concept map
   * @param {string} jsonObj.name - Name for this concept map
   * @param {string} jsonObj.status - Publication status (draft|active|retired|unknown)
   * @param {Object[]} [jsonObj.group] - Group of mappings
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
   * Converts input ConceptMap to R5 format (modifies input object for performance)
   * @param {Object} jsonObj - The input ConceptMap object
   * @param {string} version - Source FHIR version
   * @returns {Object} The same object, potentially modified to R5 format
   * @private
   */
  _convertToR5(jsonObj, version) {
    if (version === 'R5') {
      return jsonObj; // Already R5, no conversion needed
    }

    if (version === 'R3' || version === 'R4') {
      // Convert identifier from single object to array
      if (jsonObj.identifier && !Array.isArray(jsonObj.identifier)) {
        jsonObj.identifier = [jsonObj.identifier];
      }

      // Convert source/target to sourceScope/targetScope
      if (jsonObj.source !== undefined) {
        // Combine source + sourceVersion if both exist
        if (jsonObj.sourceVersion) {
          jsonObj.sourceScope = `${jsonObj.source}|${jsonObj.sourceVersion}`;
          delete jsonObj.sourceVersion;
        } else {
          jsonObj.sourceScope = jsonObj.source;
        }
        delete jsonObj.source;
      }

      if (jsonObj.target !== undefined) {
        // Combine target + targetVersion if both exist
        if (jsonObj.targetVersion) {
          jsonObj.targetScope = `${jsonObj.target}|${jsonObj.targetVersion}`;
          delete jsonObj.targetVersion;
        } else {
          jsonObj.targetScope = jsonObj.target;
        }
        delete jsonObj.target;
      }

      // Convert equivalence to relationship in group.element.target
      if (jsonObj.group && Array.isArray(jsonObj.group)) {
        jsonObj.group.forEach(group => {
          if (group.element && Array.isArray(group.element)) {
            group.element.forEach(element => {
              if (element.target && Array.isArray(element.target)) {
                element.target.forEach(target => {
                  if (target.equivalence && !target.relationship) {
                    // Convert equivalence to relationship and keep both
                    target.relationship = this._convertEquivalenceToRelationship(target.equivalence);
                    // Keep equivalence for backward compatibility
                  }
                });
              }
            });
          }
        });
      }

      return jsonObj;
    }

    throw new Error(`Unsupported FHIR version: ${version}`);
  }

  /**
   * Converts R5 ConceptMap to target version format (clones object first)
   * @param {Object} r5Obj - The R5 format ConceptMap object
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
   * Converts R5 ConceptMap to R4 format
   * @param {Object} r5Obj - Cloned R5 ConceptMap object
   * @returns {Object} R4 format ConceptMap
   * @private
   */
  _convertR5ToR4(r5Obj) {
    // Remove R5-specific elements
    if (r5Obj.versionAlgorithmString) {
      delete r5Obj.versionAlgorithmString;
    }
    if (r5Obj.versionAlgorithmCoding) {
      delete r5Obj.versionAlgorithmCoding;
    }
    if (r5Obj.property) {
      delete r5Obj.property;
    }
    if (r5Obj.additionalAttribute) {
      delete r5Obj.additionalAttribute;
    }

    // Convert identifier array back to single object
    if (r5Obj.identifier && Array.isArray(r5Obj.identifier)) {
      if (r5Obj.identifier.length > 0) {
        r5Obj.identifier = r5Obj.identifier[0]; // Take first identifier
      } else {
        delete r5Obj.identifier;
      }
    }

    // Convert sourceScope/targetScope back to source/target + version
    if (r5Obj.sourceScope) {
      const parts = r5Obj.sourceScope.split('|');
      r5Obj.source = parts[0];
      if (parts.length > 1) {
        r5Obj.sourceVersion = parts[1];
      }
      delete r5Obj.sourceScope;
    }

    if (r5Obj.targetScope) {
      const parts = r5Obj.targetScope.split('|');
      r5Obj.target = parts[0];
      if (parts.length > 1) {
        r5Obj.targetVersion = parts[1];
      }
      delete r5Obj.targetScope;
    }

    // Convert relationship back to equivalence in group.element.target
    if (r5Obj.group && Array.isArray(r5Obj.group)) {
      r5Obj.group.forEach(group => {
        if (group.element && Array.isArray(group.element)) {
          group.element.forEach(element => {
            if (element.target && Array.isArray(element.target)) {
              element.target.forEach(target => {
                // If we have both equivalence and relationship, prefer equivalence for R4
                if (target.relationship && !target.equivalence) {
                  target.equivalence = this._convertRelationshipToEquivalence(target.relationship);
                }
                // Remove R5-only relationship field
                delete target.relationship;
              });
            }
          });
        }
      });
    }

    return r5Obj;
  }

  /**
   * Converts R5 ConceptMap to R3 format
   * @param {Object} r5Obj - Cloned R5 ConceptMap object
   * @returns {Object} R3 format ConceptMap
   * @private
   */
  _convertR5ToR3(r5Obj) {
    // First apply R4 conversions
    const r4Obj = this._convertR5ToR4(r5Obj);

    // R3 has the same structure as R4 for the elements we care about
    return r4Obj;
  }

  /**
   * Converts R3/R4 equivalence to R5 relationship
   * @param {string} equivalence - R3/R4 equivalence value
   * @returns {string} R5 relationship value
   * @private
   */
  _convertEquivalenceToRelationship(equivalence) {
    const equivalenceToRelationship = {
      'relatedto': 'related-to',
      'equivalent': 'equivalent',
      'equal': 'equivalent',
      'wider': 'source-is-broader-than-target',
      'subsumes': 'source-is-broader-than-target',
      'narrower': 'source-is-narrower-than-target',
      'specializes': 'source-is-narrower-than-target',
      'inexact': 'not-related-to',
      'unmatched': 'not-related-to',
      'disjoint': 'not-related-to'
    };
    return equivalenceToRelationship[equivalence] || 'related-to';
  }

  /**
   * Converts R5 relationship back to R3/R4 equivalence
   * @param {string} relationship - R5 relationship value
   * @returns {string} R3/R4 equivalence value
   * @private
   */
  _convertRelationshipToEquivalence(relationship) {
    const relationshipToEquivalence = {
      'related-to': 'relatedto',
      'equivalent': 'equivalent',
      'source-is-broader-than-target': 'wider',
      'source-is-narrower-than-target': 'narrower',
      'not-related-to': 'unmatched'
    };
    return relationshipToEquivalence[relationship] || 'relatedto';
  }

  /**
   * Gets the FHIR version this ConceptMap was loaded from
   * @returns {string} FHIR version ('R3', 'R4', or 'R5')
   */
  getFHIRVersion() {
    return this.version;
  }

  /**
   * Validates that this is a proper ConceptMap resource
   * @throws {Error} If validation fails
   */
  validate() {
    if (!this.jsonObj || typeof this.jsonObj !== 'object') {
      throw new Error('Invalid ConceptMap: expected object');
    }

    if (this.jsonObj.resourceType !== 'ConceptMap') {
      throw new Error(`Invalid ConceptMap: resourceType must be "ConceptMap", got "${this.jsonObj.resourceType}"`);
    }

    if (!this.jsonObj.url || typeof this.jsonObj.url !== 'string') {
      throw new Error('Invalid ConceptMap: url is required and must be a string');
    }

    if (!this.jsonObj.name || typeof this.jsonObj.name !== 'string') {
      throw new Error('Invalid ConceptMap: name is required and must be a string');
    }

    if (!this.jsonObj.status || typeof this.jsonObj.status !== 'string') {
      throw new Error('Invalid ConceptMap: status is required and must be a string');
    }

    const validStatuses = ['draft', 'active', 'retired', 'unknown'];
    if (!validStatuses.includes(this.jsonObj.status)) {
      throw new Error(`Invalid ConceptMap: status must be one of ${validStatuses.join(', ')}, got "${this.jsonObj.status}"`);
    }

    // Validate identifier - should be array in R5 after conversion
    if (this.jsonObj.identifier && !Array.isArray(this.jsonObj.identifier)) {
      throw new Error('Invalid ConceptMap: identifier should be an array (converted from R3/R4 format)');
    }

    // Validate group structure if present
    if (this.jsonObj.group && !Array.isArray(this.jsonObj.group)) {
      throw new Error('Invalid ConceptMap: group must be an array if present');
    }

    // Validate group elements
    if (this.jsonObj.group) {
      this.jsonObj.group.forEach((group, groupIndex) => {
        if (group.element && !Array.isArray(group.element)) {
          throw new Error(`Invalid ConceptMap: group[${groupIndex}].element must be an array if present`);
        }

        if (group.element) {
          group.element.forEach((element, elementIndex) => {
            if (!element.code || typeof element.code !== 'string') {
              throw new Error(`Invalid ConceptMap: group[${groupIndex}].element[${elementIndex}].code is required and must be a string`);
            }

            if (element.target && !Array.isArray(element.target)) {
              throw new Error(`Invalid ConceptMap: group[${groupIndex}].element[${elementIndex}].target must be an array if present`);
            }
          });
        }
      });
    }
  }

  /**
   * Gets the source scope (R5) or source system (R3/R4)
   * @returns {string|undefined} Source scope/system
   */
  getSourceScope() {
    return this.jsonObj.sourceScope;
  }

  /**
   * Gets the target scope (R5) or target system (R3/R4)
   * @returns {string|undefined} Target scope/system
   */
  getTargetScope() {
    return this.jsonObj.targetScope;
  }

  /**
   * Gets all mapping groups
   * @returns {Object[]} Array of group objects
   */
  getGroups() {
    return this.jsonObj.group || [];
  }

  /**
   * Gets all source concepts across all groups
   * @returns {Object[]} Array of {system, code, display} objects
   */
  getSourceConcepts() {
    const concepts = [];
    this.getGroups().forEach(group => {
      const system = group.source;
      if (group.element) {
        group.element.forEach(element => {
          concepts.push({
            system: system,
            code: element.code,
            display: element.display
          });
        });
      }
    });
    return concepts;
  }

  /**
   * Gets all target concepts across all groups
   * @returns {Object[]} Array of {system, code, display, equivalence/relationship} objects
   */
  getTargetConcepts() {
    const concepts = [];
    this.getGroups().forEach(group => {
      const system = group.target;
      if (group.element) {
        group.element.forEach(element => {
          if (element.target) {
            element.target.forEach(target => {
              concepts.push({
                system: system,
                code: target.code,
                display: target.display,
                equivalence: target.equivalence,
                relationship: target.relationship
              });
            });
          }
        });
      }
    });
    return concepts;
  }

  /**
   * Finds mappings for a source concept
   * @param {string} sourceSystem - Source system URL
   * @param {string} sourceCode - Source concept code
   * @returns {Object[]} Array of target mappings
   */
  findMappings(sourceSystem, sourceCode) {
    const mappings = [];
    this.getGroups().forEach(group => {
      if (group.source === sourceSystem && group.element) {
        const element = group.element.find(el => el.code === sourceCode);
        if (element && element.target) {
          element.target.forEach(target => {
            mappings.push({
              targetSystem: group.target,
              targetCode: target.code,
              targetDisplay: target.display,
              equivalence: target.equivalence,
              relationship: target.relationship,
              comment: target.comment
            });
          });
        }
      }
    });
    return mappings;
  }

  /**
   * Finds reverse mappings for a target concept
   * @param {string} targetSystem - Target system URL
   * @param {string} targetCode - Target concept code
   * @returns {Object[]} Array of source mappings
   */
  findReverseMappings(targetSystem, targetCode) {
    const mappings = [];
    this.getGroups().forEach(group => {
      if (group.target === targetSystem && group.element) {
        group.element.forEach(element => {
          if (element.target) {
            const targetMatch = element.target.find(t => t.code === targetCode);
            if (targetMatch) {
              mappings.push({
                sourceSystem: group.source,
                sourceCode: element.code,
                sourceDisplay: element.display,
                equivalence: targetMatch.equivalence,
                relationship: targetMatch.relationship,
                comment: targetMatch.comment
              });
            }
          }
        });
      }
    });
    return mappings;
  }

  /**
   * Gets all unique source systems
   * @returns {string[]} Array of source system URLs
   */
  getSourceSystems() {
    const systems = new Set();
    this.getGroups().forEach(group => {
      if (group.source) {
        systems.add(group.source);
      }
    });
    return Array.from(systems);
  }

  /**
   * Gets all unique target systems
   * @returns {string[]} Array of target system URLs
   */
  getTargetSystems() {
    const systems = new Set();
    this.getGroups().forEach(group => {
      if (group.target) {
        systems.add(group.target);
      }
    });
    return Array.from(systems);
  }

  /**
   * Gets basic info about this concept map
   * @returns {Object} Basic information object
   */
  getInfo() {
    const groups = this.getGroups();
    const totalMappings = groups.reduce((sum, group) => {
      return sum + (group.element ? group.element.reduce((elSum, el) => {
        return elSum + (el.target ? el.target.length : 0);
      }, 0) : 0);
    }, 0);

    return {
      resourceType: this.jsonObj.resourceType,
      url: this.jsonObj.url,
      version: this.jsonObj.version,
      name: this.jsonObj.name,
      title: this.jsonObj.title,
      status: this.jsonObj.status,
      fhirVersion: this.version,
      sourceScope: this.getSourceScope(),
      targetScope: this.getTargetScope(),
      groupCount: groups.length,
      sourceSystems: this.getSourceSystems(),
      targetSystems: this.getTargetSystems(),
      totalMappings: totalMappings
    };
  }
}


module.exports = { ConceptMap };