const CodeSystem = require('../library/codesystem');
const { CodeSystemProvider, CodeSystemFactoryProvider, TxOperationContext, Designation} = require('./cs-api');
const { Language, Languages } = require('../../library/languages');
const assert = require('assert');

/**
 * Code system provider for URIs
 * This is a simple provider that treats any URI as a valid code
 * Uses strings directly as context since URIs have no additional metadata
 * Enhanced to support supplements for display and definition lookup
 */
class UriServices extends CodeSystemProvider {
  constructor(supplements) {
    super(supplements);
  }

  // ============================================================================
  // Metadata for the code system
  // ============================================================================

  system() {
    return 'urn:ietf:rfc:3986'; // URI_URIs constant equivalent
  }

  version() {
    return 'n/a';
  }

  description() {
    return 'URIs';
  }

  totalCount() {
    return -1; // Infinite/unknown count
  }

  name() {
    return 'Internal URI services';
  }

  defLang() {
    return 'en';
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    } else {
      return false; // URIs don't have displays by default
    }
  }

  hasParents() {
    return false; // URIs don't have hierarchy
  }

  // ============================================================================
  // Getting Information about concepts
  // ============================================================================

  async code(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return code; // For URIs, the code is the context
  }

  async display(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return this._displayFromSupplements(opContext, ctxt);
  }

  async definition(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return null; // URIs don't have definitions by default
  }

  async isAbstract(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // URIs are not abstract
  }

  async isInactive(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // URIs are not inactive
  }

  async isDeprecated(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // URIs are not deprecated
  }

  async designations(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    const designations = [];
    if (ctxt != null) {
      designations.push(...this._listSupplementDesignations(ctxt));
    }
    return designations;
  }

  async properties(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    // Collect properties from all supplements
    let allProperties = [];

    if (this.supplements) {
      for (const supplement of this.supplements) {
        const concept = supplement.getConceptByCode(code);  // ← Uses CodeSystem API
        if (concept && concept.property) {
          // Add all properties from this concept
          allProperties = allProperties.concat(concept.property);
        }
      }
    }

    return allProperties.length > 0 ? allProperties : null;
  }

  async sameConcept(opContext, a, b) {
    this._ensureOpContext(opContext);
    const ac = await this.#ensureContext(opContext, a);
    const bc = await this.#ensureContext(opContext, b);
    return a === b; // For URIs, direct string comparison
  }


  async #ensureContext(opContext, code) {
    if (code == null || typeof code === 'string') {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: "+ (typeof code));
  }

  // ============================================================================
  // Finding concepts
  // ============================================================================

  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    // For URIs, any string is potentially valid
    // But we can check if it exists in supplements for better validation
    // but it doesn't make any difference...

    return {
      context: code, // Use the string directly as context
      message: null
    };
  }

  // ============================================================================
  // Filtering (not supported for URIs)
  // ============================================================================

  // nothing to declare

  // ============================================================================
  // Translations and concept maps
  // ============================================================================

  async registerConceptMaps(list) {
    // No concept maps for URIs
  }

  async getTranslations(opContext, coding, target) {
    this._ensureOpContext(opContext);
    return null; // No translations available
  }
}

/**
 * Factory for creating URI code system providers
 */
class UriServicesFactory extends CodeSystemFactoryProvider {

  defaultVersion() {
    return 'n/a';
  }

  async build(opContext, supplements) {
    this.recordUse();
    return new UriServices(supplements);
  }
}

module.exports = {
  UriServices,
  UriServicesFactory
};