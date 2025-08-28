/**
 * UCUM CodeSystem Provider
 * Implementation of CodeSystemProvider for UCUM (Unified Code for Units of Measure)
 */

const { CodeSystemProvider, TxOperationContext, Designation, FilterExecutionContext, CodeSystemFactoryProvider} = require('./cs-api');
const { Languages } = require('../../library/languages');
const { CodeSystem } = require("../library/codesystem");
const ValueSet = require("../library/valueset");
const assert = require('assert');
const {UcumService} = require("../library/ucum-service");

/**
 * UCUM provider context for concepts
 */
class UcumContext {
  constructor(code) {
    assert(typeof code === 'string', 'code must be string');
    this.code = code;
  }
}

/**
 * Filter context for UCUM canonical unit filters
 */
class UcumFilterContext {
  constructor(canonical = '') {
    this.canonical = canonical;
    this.cursor = -1; // Used for iteration
    this.filters = [];
  }
}

/**
 * UCUM CodeSystem Provider
 * Provides validation and lookup for UCUM unit expressions
 */
class UcumCodeSystemProvider extends CodeSystemProvider {
  constructor(opContext, supplements, ucumService, commonUnits = null) {
    super(opContext, supplements);
    assert(ucumService != null && ucumService instanceof UcumService, 'ucumService must be a UcumService');
    assert(!commonUnits || commonUnits instanceof ValueSet, 'if provided, commonUnits must be a ValueSet');

    this.ucumService = ucumService;
    this.commonUnits = commonUnits; // ValueSet for common units
    this.commonUnitList = null;

    this._setupCommonUnits();
  }

  _setupCommonUnits() {
    if (this.commonUnits) {
      // Extract concept list from common units ValueSet
      // This would depend on your ValueSet implementation
      // For now, assuming it has a getConcepts() method
      // if (typeof this.commonUnits.getConcepts === 'function') {
      //   this.commonUnitList = this.commonUnits.getConcepts();
      // }
    }
  }

  // ========== Metadata Methods ==========

  system() {
    return 'http://unitsofmeasure.org'; // UCUM URI
  }

  version() {
    return this.ucumService.ucumIdentification().version;
  }

  description() {
    return 'Unified Code for Units of Measure (UCUM)';
  }

  totalCount() {
    return -1; // Unbounded due to grammar
  }

  hasParents() {
    return false; // No hierarchy in UCUM
  }

  contentMode() {
    return 'complete';
  }

  expandLimitation() {
    return 0; // No limitation
  }

  specialEnumeration() {
    // Return URL of common units if available
    return this.commonUnits ? this.commonUnits.url || null : null;
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }
    return langs.isEnglishOrNothing();
  }

  listFeatures() {
    return [
      {
        feature: `rest.Codesystem:${this.system()}.filter`,
        value: 'canonical:equals'
      }
    ];
  }

  // ========== Code Information Methods ==========

  async code(code) {
    
    const ctxt = await this.#ensureContext(code);
    return ctxt.code;
  }

  async display(code) {
    
    const ctxt = await this.#ensureContext(code);

    if (this.opContext.langs.isEnglishOrNothing()) {
      // Check for common units display first
      if (this.commonUnitList) {
        for (const concept of this.commonUnitList) {
          if (concept.code === ctxt.code && concept.display) {
            return concept.display.trim();
          }
        }
      }

      // Check supplements
      const supplementDisplay = this._displayFromSupplements(ctxt.code);
      if (supplementDisplay) {
        return supplementDisplay;
      }

      // Default to analysis
      return this.ucumService.analyse(ctxt.code);
    }

    // Non-English languages - check supplements first
    const supplementDisplay = this._displayFromSupplements(ctxt.code);
    if (supplementDisplay) {
      return supplementDisplay;
    }

    // Fall back to analysis
    return this.ucumService.analyse(ctxt.code);
  }

  async definition(code) {
    
    await this.#ensureContext(code);
    return null; // UCUM doesn't provide definitions
  }

  async isAbstract(code) {
    
    await this.#ensureContext(code);
    return false; // UCUM codes are not abstract
  }

  async isInactive(code) {
    
    await this.#ensureContext(code);
    return false; // We don't track inactive UCUM codes
  }

  async isDeprecated(code) {
    
    await this.#ensureContext(code);
    return false; // We don't track deprecated UCUM codes
  }

  async designations(code) {
    
    const ctxt = await this.#ensureContext(code);

    const designations = [];

    // Primary display (analysis)
    const analysis = this.ucumService.analyse(ctxt.code);
    designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), analysis));

    // Common unit display if available
    if (this.commonUnitList) {
      for (const concept of this.commonUnitList) {
        if (concept.code === ctxt.code && concept.display) {
          const display = concept.display.trim();
          if (display !== analysis) {
            designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), display));
          }
        }
      }
    }

    // Add supplement designations
    designations.push(...this._listSupplementDesignations(ctxt.code));

    return designations;
  }

  async #ensureContext(code) {
    if (code == null) {
      return code;
    }
    if (typeof code === 'string') {
      const result = await this.locate(code);
      if (result.context == null) {
        throw new Error(result.message);
      } else {
        return result.context;
      }
    }
    if (code instanceof UcumContext) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // ========== Lookup Methods ==========

  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');

    if (!code) {
      return { context: null, message: 'Empty code' };
    }

    const validationResult = this.ucumService.validate(code);
    if (validationResult === null) {
      return { context: new UcumContext(code), message: null };
    } else {
      return { context: null, message: validationResult };
    }
  }

  // ========== Filter Methods ==========

  async doesFilter(prop, op, value) {
    
    assert(prop != null && typeof prop === 'string', 'prop must be a non-null string');
    assert(op != null && typeof op === 'string', 'op must be a non-null string');
    assert(value != null && typeof value === 'string', 'value must be a non-null string');

    // Support canonical unit filters
    return (prop === 'canonical' && op === 'equals');
  }

  async searchFilter(filterContext, filter, sort) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(filter && typeof filter === 'string', 'filter must be a non-null string');
    assert(typeof sort === 'boolean', 'sort must be a boolean');

    throw new Error('Search filter not implemented for UCUM');
  }

  async specialFilter(filterContext, filter, sort) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(filter && typeof filter === 'string', 'filter must be a non-null string');
    assert(typeof sort === 'boolean', 'sort must be a boolean');

    throw new Error('Special filter not presently implemented for UCUM');
    // const ucumFilter = new UcumFilterContext('');
    // filterContext.filters.push(ucumFilter);
  }

  async filter(filterContext, prop, op, value) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(prop != null && typeof prop === 'string', 'prop must be a non-null string');
    assert(op != null && typeof op === 'string', 'op must be a non-null string');
    assert(value != null && typeof value === 'string', 'value must be a non-null string');

    if (prop !== 'canonical') {
      throw new Error(`Unsupported filter property: ${prop}`);
    }

    if (op !== 'equals') {
      throw new Error(`Unsupported filter operator for canonical: ${op}`);
    }

    const ucumFilter = new UcumFilterContext(value);
    filterContext.filters.push(ucumFilter);
  }

  async executeFilters(filterContext) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return filterContext.filters;
  }

  async filterSize(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof UcumFilterContext, 'set must be a UcumFilterContext');

    if (set.canonical === '' && this.commonUnitList) {
      return this.commonUnitList.length;
    }
    throw new Error('UCUM filter sets cannot be sized as they are based on a grammar');
  }

  async filtersNotClosed(filterContext) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return true; // Grammar-based system is not closed
  }

  async filterMore(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof UcumFilterContext, 'set must be a UcumFilterContext');

    if (set.canonical === '' && this.commonUnitList) {
      // Iterating common units
      set.cursor++;
      return set.cursor < this.commonUnitList.length;
    }
    throw new Error('UCUM filter sets cannot be iterated as they are based on a grammar');
  }

  async filterConcept(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof UcumFilterContext, 'set must be a UcumFilterContext');

    if (set.canonical === '' && this.commonUnitList) {
      // Return current common unit
      const concept = this.commonUnitList[set.cursor];
      return new UcumContext(concept.code);
    }
    throw new Error('UCUM filter sets cannot be iterated as they are based on a grammar');
  }

  async filterLocate(filterContext, set, code) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof UcumFilterContext, 'set must be a UcumFilterContext');
    assert(typeof code === 'string', 'code must be non-null string');

    // Validate the code first
    const validationResult = this.ucumService.validate(code);
    if (validationResult !== null) {
      return `Invalid UCUM code: ${validationResult}`;
    }

    if (set.canonical === '') {
      // Special enumeration case - check if in common units
      if (this.commonUnitList) {
        const found = this.commonUnitList.find(concept => concept.code === code);
        if (found) {
          return new UcumContext(code);
        } else {
          return `Code ${code} is not in the common units enumeration`;
        }
      }
      return new UcumContext(code); // Valid code
    } else {
      // Check canonical units
      try {
        const canonical = this.ucumService.getCanonicalUnits(code);
        if (canonical === set.canonical) {
          return new UcumContext(code);
        } else {
          return `Code ${code} has canonical form ${canonical}, not ${set.canonical} as required`;
        }
      } catch (error) {
        return `Error getting canonical form for ${code}: ${error.message}`;
      }
    }
  }

  async filterCheck(filterContext, set, concept) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof UcumFilterContext, 'set must be a UcumFilterContext');

    const ctxt = await this.#ensureContext(concept);

    if (set.canonical === '') {
      // Special enumeration case
      if (this.commonUnitList) {
        return this.commonUnitList.some(c => c.code === ctxt.code);
      }
      return true; // All valid codes are included
    } else {
      // Check canonical units
      try {
        const canonical = this.ucumService.getCanonicalUnits(ctxt.code);
        return canonical === set.canonical;
      } catch (error) {
        return false;
      }
    }
  }

  async filterFinish(filterContext) {
    
    // Nothing to clean up
  }

  // ========== Iterator Methods ==========

  async iterator(context) {
    
    return null; // Cannot iterate UCUM codes (grammar-based)
  }

  async nextContext(iterator) {
    
    return null; // Cannot iterate UCUM codes
  }

  // ========== Additional Methods ==========

  async sameConcept(a, b) {
    
    const codeA = await this.code(a);
    const codeB = await this.code(b);
    return codeA === codeB;
  }

  async subsumesTest(codeA, codeB) {
    
    return false; // No subsumption in UCUM
  }

  async extendLookup(ctxt, props, params) {
    

    if (props.includes('canonical')) {
      try {
        const canonical = this.ucumService.getCanonicalUnits(ctxt.code);
        // Add canonical property to params - implementation depends on your Parameters class
        if (params && typeof params.addProperty === 'function') {
          params.addProperty('canonical', canonical);
        }
      } catch (error) {
        // Ignore errors in canonical form calculation
      }
    }
  }

  async registerConceptMaps(list) {
    // No concept maps for UCUM
  }

  async getTranslations(coding, target) {
    
    return null; // No translations available
  }

}

/**
 * Factory for creating UCUM CodeSystem providers
 */
class UcumCodeSystemFactory extends CodeSystemFactoryProvider {
  constructor(ucumService, commonUnits = null) {
    super();
    assert(ucumService != null && ucumService instanceof UcumService, 'ucumService must be a UcumService');
    assert(!commonUnits || commonUnits instanceof ValueSet, 'if provided, commonUnits must be a ValueSet');
    this.ucumService = ucumService;
    this.commonUnits = commonUnits;
    this.uses = 0;
  }

  system() {
    return 'http://unitsofmeasure.org'; // UCUM URI
  }

  version() {
    return this.ucumService.ucumIdentification().getVersion();
  }

  defaultVersion() {
    if (this.ucumService && typeof this.ucumService.ucumIdentification === 'function') {
      const versionDetails = this.ucumService.ucumIdentification();
      return versionDetails ? versionDetails.getVersion() : '';
    }
    return '';
  }

  build(opContext, supplements) {
    this.recordUse();
    return new UcumCodeSystemProvider(opContext, supplements, this.ucumService, this.commonUnits);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  UcumCodeSystemProvider,
  UcumCodeSystemFactory,
  UcumContext,
  UcumFilterContext
};