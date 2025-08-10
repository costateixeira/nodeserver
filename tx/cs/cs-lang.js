const { CodeSystemProvider, TxOperationContext, Designation, FilterExecutionContext } = require('./cs-api');
const { Language, LanguageDefinitions, Languages} = require('../library/languages');
const CodeSystem = require("../library/codesystem");
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
  constructor(languageDefinitions, supplements = null) {
    super(supplements);
    this.languageDefinitions = languageDefinitions; // LanguageDefinitions instance
  }

  // ========== Metadata Methods ==========

  system() {
    return 'urn:ietf:bcp:47'; // BCP 47 URI
  }

  version() {
    return ''; // No specific version for BCP 47. Could be date?
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

  async code(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    if (ctxt instanceof Language) {
      return ctxt.code;
    }
    throw new Error('Invalid context type');
  }

  async display(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    if (!ctxt) {
      return null;
    }
    if (opContext.langs.isEnglishOrNothing()) {
      return this.languageDefinitions.present(ctxt).trim();
    }
    let disp = this._displayFromSupplements(context);
    if (disp) {
      return disp;
    }
    return this.languageDefinitions.present(ctxt).trim();
  }

  async definition(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return null; // No definitions for language codes
  }

  async isAbstract(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // Language codes are not abstract
  }

  async isInactive(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // We don't track inactive language codes
  }

  async isDeprecated(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // We don't track deprecated language codes
  }

  async designations(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
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
          if (lang.isLangRegion()) {
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


  async #ensureContext(opContext, code) {
    if (code == null) {
      return code;
    }
    if (typeof code === 'string') {
      const ctxt = await this.locate(opContext, code);
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

  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const language = this.languageDefinitions.parse(code);
    if (!language) {
      return { context: null, message: `Invalid language code: ${code}` };
    }

    return { context: language, message: null };
  }

  // ========== Filter Methods ==========

  async doesFilter(opContext, prop, op, value) {
    this._ensureOpContext(opContext);
    assert(prop != null && typeof prop === 'string', 'prop must be a non-null string');
    assert(op != null && typeof op === 'string', 'op must be a non-null string');
    assert(value != null && typeof value === 'string', 'value must be a non-null string');

    // Support exists filters for language components
    if (op === 'exists' && (value === 'true' || value === 'false')) {
      return CODES_LanguageComponent.includes(prop);
    }
    return false;
  }

  async searchFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(filter && typeof filter === 'string', 'filter must be a non-null string');
    assert(typeof sort === 'boolean', 'sort must be a boolean');

    throw new Error('Search filter not implemented for Language Codes');
  }

  async specialFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(filter && typeof filter === 'string', 'filter must be a non-null string');
    assert(typeof sort === 'boolean', 'sort must be a boolean');

    throw new Error('Special filter not implemented for Language Codes');
  }

  async filter(opContext, filterContext, prop, op, value) {
    this._ensureOpContext(opContext);
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

  async executeFilters(opContext, filterContext) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return filterContext.filters;
  }

  async filterSize(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');

    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filtersNotClosed(opContext, filterContext) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    return true; // Grammar-based system is not closed
  }

  async filterMore(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filterConcept(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    throw new Error('Language valuesets cannot be expanded as they are based on a grammar');
  }

  async filterLocate(opContext, filterContext, set, code) {
    this._ensureOpContext(opContext);
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

  async filterCheck(opContext, filterContext, set, concept) {
    this._ensureOpContext(opContext);
    assert(filterContext && filterContext instanceof FilterExecutionContext, 'filterContext must be a FilterExecutionContext');
    assert(set && set instanceof IETFLanguageCodeFilter, 'set must be a IETFLanguageCodeFilter');
    const ctxt = await this.#ensureContext(opContext, concept);


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

  async filterFinish(opContext, filterContext) {
    this._ensureOpContext(opContext);
    // Nothing to clean up
  }

  // ========== Iterator Methods ==========

  async iterator(opContext, context) {
    this._ensureOpContext(opContext);
    return null; // Cannot iterate language codes (grammar-based)
  }

  async nextContext(opContext, iterator) {
    this._ensureOpContext(opContext);
    return null; // Cannot iterate language codes
  }

  // ========== Additional Methods ==========

  async sameConcept(opContext, a, b) {
    this._ensureOpContext(opContext);
    const codeA = await this.code(opContext, a);
    const codeB = await this.code(opContext, b);
    return codeA === codeB;
  }

  async subsumesTest(opContext, codeA, codeB) {
    this._ensureOpContext(opContext);
    return false; // No subsumption in language codes
  }

  async searchFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    throw new Error('Text search not supported for language codes');
  }

  async specialFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    throw new Error('Special filters not supported for language codes');
  }

  async extendLookup(opContext, ctxt, props, params) {
    this._ensureOpContext(opContext);
    // No additional properties to add
  }

  async registerConceptMaps(list) {
    // No concept maps for language codes
  }

  async getTranslations(opContext, coding, target) {
    this._ensureOpContext(opContext);
    return null; // No translations available
  }
}

/**
 * Factory for creating IETF Language CodeSystem providers
 */
class IETFLanguageCodeFactory {
  constructor(languageDefinitions) {
    this.languageDefinitions = languageDefinitions;
    this.uses = 0;
  }

  defaultVersion() {
    return ''; // No versioning for BCP 47
  }

  build(opContext, supplements) {
    this.recordUse();
    return new IETFLanguageCodeProvider(this.languageDefinitions, supplements);
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