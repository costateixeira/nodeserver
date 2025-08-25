const { CodeSystem, CodeSystemContentMode}  = require("../library/codesystem");
const { CodeSystemFactoryProvider, CodeSystemProvider}  = require( "./cs-api");
const { VersionUtilities }  = require("../../library/version-utilities");
const { Language }  = require ("../../library/languages");

class FhirCodeSystemProvider extends CodeSystemProvider {
  /**
   * @param {CodeSystem} codeSystem - The primary CodeSystem
   * @param {CodeSystem[]} supplements - Array of supplement CodeSystems
   */
  constructor(codeSystem, supplements = []) {
    super(supplements);

    this.codeSystem = codeSystem;
    this.hasHierarchyFlag = codeSystem.hasHierarchy();

    // Parse the default language if specified
    this.defaultLanguage = codeSystem.language();
  }

  // ============ Metadata Methods ============

  /**
   * @returns {string} URI and version identifier for the code system
   */
  name() {
    return this.codeSystem.jsonObj.name || '';
  }

  /**
   * @returns {string} URI for the code system
   */
  system() {
    return this.codeSystem.jsonObj.url || '';
  }

  /**
   * @returns {string|null} Version for the code system
   */
  version() {
    return this.codeSystem.jsonObj.version || null;
  }

  /**
   * @returns {string} Default language for the code system
   */
  defLang() {
    return this.defaultLanguage?.toString() || 'en';
  }

  /**
   * @returns {string} Content mode for the CodeSystem
   */
  contentMode() {
    return this.codeSystem.contentMode();
  }

  /**
   * @returns {string} Description for the code system
   */
  description() {
    return this.codeSystem.jsonObj.description || this.codeSystem.jsonObj.title || this.codeSystem.jsonObj.name || '';
  }

  /**
   * @returns {string|null} Source package for the code system, if known
   */
  sourcePackage() {
    // FHIR CodeSystems don't typically have package information
    return this.codeSystem.sourcePackage;
  }

  /**
   * @returns {number} Total number of concepts in the code system
   */
  totalCount() {
    return this.codeSystem.codeMap.size;
  }

  /**
   * @returns {Object[]|null} Defined properties for the code system
   */
  propertyDefinitions() {
    return this.codeSystem.jsonObj.property || null;
  }

  /**
   * @param {Languages} languages - Language specification
   * @returns {boolean} Whether any displays are available for the languages
   */
  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);

    // Check supplements first
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }

    // Check if we have English or if no specific languages requested
    if (langs.isEnglishOrNothing()) {
      return true; // We always have displays for concepts
    }

    // Check if the CodeSystem's language matches requested languages
    if (this.defaultLanguage) {
      for (const requestedLang of langs) {
        if (this.defaultLanguage.matchesForDisplay(requestedLang)) {
          return true;
        }
      }
    }

    // Check concept designations for matching languages
    for (const concept of this.codeSystem.getAllConcepts()) {
      if (concept.designation && Array.isArray(concept.designation)) {
        for (const designation of concept.designation) {
          if (designation.language) {
            const designationLang = new Language(designation.language);
            for (const requestedLang of langs) {
              if (designationLang.matchesForDisplay(requestedLang)) {
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * @returns {boolean} True if there's a hierarchy
   */
  hasParents() {
    return this.hasHierarchyFlag;
  }

  /**
   * @param {string} v1 - First version
   * @param {string} v2 - Second version
   * @returns {boolean} True if v1 is more detailed than v2
   */
  versionIsMoreDetailed(v1, v2) {
    // Simple implementation - could be enhanced with semantic version comparison
    if (!v1 || !v2) return false;
    return VersionUtilities.versionMatches(v1+"?", v2);
  }
}

class FhirCodeSystemFactory extends CodeSystemFactoryProvider {
  constructor() {
    super();
  }

  defaultVersion() {
    return 'unknown'; // No default version for FHIR CodeSystems
  }

  /**
   * Build a FHIR CodeSystem provider
   * @param {TxOperationContext} opContext - Operation context
   * @param {CodeSystem} codeSystem - The FHIR CodeSystem to wrap
   * @param {CodeSystem[]} supplements - Array of supplement CodeSystems
   * @returns {FhirCodeSystemProvider} New provider instance
   */
  build(opContext, codeSystem, supplements) {
    this.recordUse();

    // Validate parameters
    if (!codeSystem || typeof codeSystem !== 'object') {
      throw new Error('codeSystem parameter is required and must be a CodeSystem object');
    }

    if (codeSystem.jsonObj?.resourceType !== 'CodeSystem') {
      throw new Error('codeSystem must be a FHIR CodeSystem resource');
    }

    // Validate supplements array
    if (supplements && !Array.isArray(supplements)) {
      throw new Error('supplements must be an array');
    }

    if (supplements) {
      supplements.forEach((supplement, index) => {
        if (!supplement || typeof supplement !== 'object' || supplement.jsonObj?.resourceType !== 'CodeSystem') {
          throw new Error(`Supplement ${index} must be a FHIR CodeSystem resource`);
        }
      });
    }

    return new FhirCodeSystemProvider(codeSystem, supplements || []);
  }
}

module.exports = {
  FhirCodeSystemFactory,
  FhirCodeSystemProvider
};