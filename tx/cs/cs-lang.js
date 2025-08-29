const { CodeSystemProvider, Designation, FilterExecutionContext, CodeSystemFactoryProvider} = require('./cs-api');
const { Language } = require('../../library/languages');
const { CodeSystem } = require("../library/codesystem");
const assert = require('assert');

/**
 * Language component types for filtering
 */
const LanguageComponent = {
  LANG: 'language',
  EXTLANG: 'ext-lang',
  SCRIPT: 'script',
  REGION: 'region',
  VARIANT: 'variant',
  EXTENSION: 'extension',
  PRIVATE_USE: 'private-use'
};

const CODES_LanguageComponent = Object.values(LanguageComponent);

/**
 * Filter context for language component filters
 */
class IETFLanguageCodeFilter {
  constructor(component, status) {
    this.component = component; // LanguageComponent
    this.status = status; // boolean - true if component must exist, false if must not exist
  }
}

/**
 * IETF Language CodeSystem Provider
 * Provides validation and lookup for BCP 47 language tags
 */
class IETFLanguageCodeProvider extends CodeSystemProvider {
  constructor(opContext, supplements, languageDefinitions) {
    super(opContext, supplements);
    this.languageDefinitions = languageDefinitions; // LanguageDefinitions instance
  }

  // ========== Metadata Methods ==========

  system() {
    return 'urn:ietf:bcp:47'; // BCP 47 URI
  }

  version() {
    return null; // No specific version for BCP 47. Could be date?
  }

  description() {
    return 'IETF language codes (BCP 47)';
  }

  totalCount() {
    return -1; // Unbounded - grammar-based system
  }

  hasParents() {
    return false; // No hierarchy in language codes
  }

  contentMode() {
    return 'complete'
  }

  listFeatures() {
    // not sure about this?

    // // Return supported filter features
    // return CODES_LanguageComponent.map(component => ({
    //   feature: `rest.Codesystem:${this.system()}.filter`,
    //   value: `${component}:exists`
    // }));
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }
    return super.hasAnyDisplays(langs);
  }

  // ========== Code Information Methods ==========

  async code(code) {
    
    const ctxt = await this.#ensureContext(code);
    if (ctxt instanceof Language) {
      return ctxt.code;
    }
    throw new Error('Invalid context type');
  }

  async display(code) {
    
    const ctxt = await this.#ensureContext(code);
    if (!ctxt) {
      return null;
    }
    if (this.opContext.langs.isEnglishOrNothing()) {
      return this.languageDefinitions.present(ctxt).trim();
    }
    let disp = this._displayFromSupplements(ctxt.code);
    if (disp) {
      return disp;
    }
    return this.languageDefinitions.present(ctxt).trim();
  }

  async definition(code) {
    
    await this.#ensureContext(code);
    return null; // No definitions for language codes
  }

  async isAbstract(code) {
    
    await this.#ensureContext(code);
    return false; // Language codes are not abstract
  }

  async isInactive(code) {
    
    await this.#ensureContext(code);
    return false; // We don't track inactive language codes
  }

  async isDeprecated(code) {
    
    await this.#ensureContext(code);
    return false; // We don't track deprecated language codes
  }

  async designations(code) {
    
    const ctxt = await this.#ensureContext(code);
    const designations = [];
    if (ctxt != null) {
      const primaryDisplay = this.languageDefinitions.present(ctxt).trim();
      designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), primaryDisplay));
      if (ctxt.isLangRegion()) {
        const langDisplay = this.languageDefinitions.getDisplayForLang(ctxt.language);
        const regionDisplay = this.languageDefinitions.getDisplayForRegion(ctxt.region);
        const regionVariant = `${langDisplay} (${regionDisplay})`;
        const regionVariant2 = `${langDisplay} (Region=${regionDisplay})`;
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), regionVariant));
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), regionVariant2));
      }
      // add alternative displays if available
      const displayCount = this.languageDefinitions.displayCount(ctxt);
      for (let i = 0; i < displayCount; i++) {
        const altDisplay = this.languageDefinitions.present(ctxt, i).trim();
        if (altDisplay && altDisplay !== primaryDisplay) {
          designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), altDisplay));
          // Add region variants for alternatives too
          if (ctxt.language.isLangRegion()) {
            const langDisplay = this.languageDefinitions.getDisplayForLang(ctxt.language, i);
            const regionDisplay = this.languageDefinitions.getDisplayForRegion(ctxt.region);
            const altRegionVariant = `${langDisplay} (${regionDisplay})`;
            designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), altRegionVariant));
          }
        }
      }
      designations.push(...this._listSupplementDesignations(ctxt.code));
    }
    return designations;
  }


  async #ensureContext(code) {
    if (code == null) {
      return code;
    }
    if (typeof code === 'string') {
      const ctxt = await this.locate(code);
      if (ctxt.context == null) {
        throw new Error(ctxt.message);
      } else {
        return ctxt.context;
      }
    }
    if (code instanceof Language) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: "+ (typeof code));
  }

  // ========== Lookup Methods ==========

  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const language = this.languageDefinitions.parse(code);
    if (!language) {
      return { context: null, message: `Invalid language code: ${code}` };
    }

    return { context: language, message: null };
  }

  // ========== Filter Methods ==========

  async doesFilter(prop, op, value) {
    
    assert(prop != null && typeof prop === 'string', 'prop must be a non-null string');
    assert(op != null && typeof op === 'string', 'op must be a non-null string');
    assert(value != null && typeof value === 'string', 'value must be a non-null string');

    // Support exists filters for language components
    if (op === 'exists' && (value === 'true' || value === 'false')) {
      return CODES_LanguageComponent.includes(prop);
    }
    return false;
  }

  async searchFilter(filterContext, filter, sort) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(filter && typeof filter === 'string', 'filter must be a non-null string');
    assert(typeof sort === 'boolean', 'sort must be a boolean');

    throw new Error('Text search not supported');
  }


  async filter(filterContext, prop, op, value) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(prop != null && typeof prop === 'string', 'prop must be a non-null string');
    assert(op != null && typeof op === 'string', 'op must be a non-null string');
    assert(value != null && typeof value === 'string', 'value must be a non-null string');

    if (op !== 'exists') {
      throw new Error(`Unsupported filter operator: ${op}`);
    }

    if (value !== 'true' && value !== 'false') {
      throw new Error(`Invalid exists value: ${value}, must be 'true' or 'false'`);
    }

    const componentIndex = CODES_LanguageComponent.indexOf(prop);
    if (componentIndex < 0) {
      throw new Error(`Unsupported filter property: ${prop}`);
    }

    const component = CODES_LanguageComponent[componentIndex];
    const status = value === 'true';

    filterContext.filters.push(new IETFLanguageCodeFilter(component, status));
  }

  async executeFilters(filterContext) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return filterContext.filters;
  }

  async filterSize(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');

    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filtersNotClosed(filterContext) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return true; // Grammar-based system is not closed
  }

  async filterMore(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filterConcept(filterContext, set) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filterLocate(filterContext, set, code) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    assert(typeof code === 'string', 'code must be non-null string');

    const language = this.languageDefinitions.parse(code);
    if (!language) {
      return `Invalid language code: ${code}`;
    }

    const filter = set;
    let hasComponent = false;

    switch (filter.component) {
      case LanguageComponent.LANG:
        hasComponent = language.language !== '';
        break;
      case LanguageComponent.EXTLANG:
        hasComponent = language.extLang.length > 0;
        break;
      case LanguageComponent.SCRIPT:
        hasComponent = language.script !== '';
        break;
      case LanguageComponent.REGION:
        hasComponent = language.region !== '';
        break;
      case LanguageComponent.VARIANT:
        hasComponent = language.variant !== '';
        break;
      case LanguageComponent.EXTENSION:
        hasComponent = language.extension !== '';
        break;
      case LanguageComponent.PRIVATE_USE:
        hasComponent = language.privateUse.length > 0;
        break;
      default:
        return `Unknown language component: ${filter.component}`;
    }

    if (hasComponent === filter.status) {
      return language;
    } else {
      const action = filter.status ? 'does not contain' : 'contains';
      const requirement = filter.status ? 'required' : 'not allowed';
      return `The language code ${code} ${action} a ${filter.component}, and it is ${requirement}`;
    }
  }

  async filterCheck(filterContext, set, concept) {
    
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    const ctxt = await this.#ensureContext(concept);


    const filter = set;
    let hasComponent = false;

    switch (filter.component) {
      case LanguageComponent.LANG:
        hasComponent = ctxt.language !== '';
        break;
      case LanguageComponent.EXTLANG:
        hasComponent = ctxt.extLang.length > 0;
        break;
      case LanguageComponent.SCRIPT:
        hasComponent = ctxt.script !== '';
        break;
      case LanguageComponent.REGION:
        hasComponent = ctxt.region !== '';
        break;
      case LanguageComponent.VARIANT:
        hasComponent = ctxt.variant !== '';
        break;
      case LanguageComponent.EXTENSION:
        hasComponent = ctxt.extension !== '';
        break;
      case LanguageComponent.PRIVATE_USE:
        hasComponent = ctxt.privateUse.length > 0;
        break;
      default:
        return `Unknown language component: ${filter.component}`;
    }

    return hasComponent === filter.status;
  }


  // ========== Iterator Methods ==========
  // Cannot iterate language codes (grammar-based)

  // ========== Additional Methods ==========

  async sameConcept(a, b) {
    
    const codeA = await this.code(a);
    const codeB = await this.code(b);
    return codeA === codeB;
  }

  async subsumesTest(codeA, codeB) {
    await this.#ensureContext(codeA);
    await this.#ensureContext(codeB);
    return false; // No subsumption in language codes
  }

}

/**
 * Factory for creating IETF Language CodeSystem providers
 */
class IETFLanguageCodeFactory extends CodeSystemFactoryProvider  {
  constructor(languageDefinitions) {
    super();
    this.languageDefinitions = languageDefinitions;
    this.uses = 0;
  }

  defaultVersion() {
    return ''; // No versioning for BCP 47
  }

  system() {
    return 'urn:ietf:bcp:47'; // BCP 47 URI
  }

  version() {
    return null; // No specific version for BCP 47. Could be date?
  }

  build(opContext, supplements) {
    this.recordUse();
    return new IETFLanguageCodeProvider(opContext, supplements, this.languageDefinitions);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  IETFLanguageCodeProvider,
  IETFLanguageCodeFactory,
  IETFLanguageCodeFilter,
  LanguageComponent
};