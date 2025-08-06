const { CodeSystemProvider } = require('./cs-api');

/**
 * Code system provider for URIs
 * This is a simple provider that treats any URI as a valid code
 * Uses strings directly as context since URIs have no additional metadata
 */
class UriServices extends CodeSystemProvider {
  /**
   * @type {CodeSystem[]}
   */
  supplements;

  constructor(supplements) {
    super();
    this.supplements = supplements;
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
    return false; // URIs don't have displays
  }

  hasParents() {
    return false; // URIs don't have hierarchy
  }

  // ============================================================================
  // Getting Information about concepts
  // ============================================================================

  code(opContext, code) {
    return code; // For URIs, the code is the context
  }

  async display(opContext, code) {
    return ''; // URIs don't have displays
  }

  async definition(opContext, code) {
    return ''; // URIs don't have definitions
  }

  isAbstract(opContext, code) {
    return false; // URIs are not abstract
  }

  isInactive(opContext, code) {
    return false; // URIs are not inactive
  }

  isDeprecated(opContext, code) {
    return false; // URIs are not deprecated
  }

  getStatus(opContext, code) {
    return null;
  }

  designations(opContext, code) {
    return null; // No designations for URIs
  }

  properties(opContext, code) {
    return null; // No properties for URIs
  }

  sameConcept(opContext, a, b) {
    return a === b; // For URIs, direct string comparison
  }

  // ============================================================================
  // Finding concepts
  // ============================================================================

  async locate(opContext, code) {
    // For URIs, any string is potentially valid
    return {
      context: code, // Use the string directly as context
      message: null
    };
  }

  async locateIsA(opContext, code, parent, disallowParent) {
    // URIs don't have formal subsumption properties
    return {
      context: null,
      message: `URIs do not have parents`
    };
  }

  iterator(opContext, code) {
    return null; // Cannot iterate URIs
  }

  nextContext(opContext, context) {
    return null; // No iteration support
  }

  subsumesTest(opContext, codeA, codeB) {
    return false; // No subsumption for URIs
  }

  // ============================================================================
  // Filtering (not supported for URIs)
  // ============================================================================

  doesFilter(opContext, prop, op, value) {
    return false; // No filters supported
  }

  getPrepContext(opContext, iterate) {
    return null; // No filtering context needed
  }

  async searchFilter(opContext, filterContext, filter, sort) {
    throw new Error('Search filtering not supported for URI code system');
  }

  async specialFilter(opContext, filterContext, filter, sort) {
    throw new Error('Special filtering not supported for URI code system');
  }

  async executeFilters(opContext, filterContext) {
    throw new Error('Filter execution not supported for URI code system');
  }

  filterSize(opContext, filterContext, set) {
    throw new Error('Filter size not supported for URI code system');
  }

  filtersNotClosed(opContext, filterContext) {
    return true; // URI space is not closed
  }

  filterMore(opContext, filterContext, set) {
    throw new Error('Filter iteration not supported for URI code system');
  }

  filterConcept(opContext, filterContext, set) {
    throw new Error('Filter concept access not supported for URI code system');
  }

  filterLocate(opContext, filterContext, set, code) {
    throw new Error('Filter locate not supported for URI code system');
  }

  filterCheck(opContext, filterContext, set, concept) {
    throw new Error('Filter check not supported for URI code system');
  }

  filterFinish(opContext, filterContext) {
    // Nothing to clean up
  }

  // ============================================================================
  // Translations and concept maps
  // ============================================================================

  registerConceptMaps(list) {
    // No concept maps for URIs
  }

  getTranslations(opContext, coding, target) {
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