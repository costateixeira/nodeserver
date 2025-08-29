/* eslint-disable no-unused-vars */

const assert = require('assert');
const {CodeSystem, CodeSystemContentMode} = require("../library/codesystem");
const {Languages, Language} = require("../../library/languages");

class TxOperationContext {

  constructor(langs) {
    this.langs = this._ensureLanguages(langs);
  }

  _ensureLanguages(param) {
    assert(typeof param === 'string' || param instanceof Languages, 'Parameter must be string or Languages object');
    return typeof param === 'string' ? Languages.fromAcceptLanguage(param) : param;
  }

  /**
   * @type {Languages} languages specified in request
   */
  langs;
}

class Designation {
  language;
  use;
  value;

  constructor(language, use, value) {
    this.language = language;
    this.use = use;
    this.value = value;
  }
}

class FilterExecutionContext {
  filters = [];
}

class CodeSystemProvider {
  /**
   * {TxOperationContext} The context in which this is executing
   */
  opContext;

  /**
   * @type {CodeSystem[]}
   */
  supplements;

  constructor(opContext, supplements) {
    this.opContext = opContext;
    this.supplements = supplements;
    this._ensureOpContext(opContext);
    this._validateSupplements();
  }

  _ensureOpContext(opContext) {
    assert(opContext && opContext instanceof TxOperationContext, "opContext is not an instance of TxOperationContext");
  }

  /**
   * Validates that supplements are CodeSystem instances
   * @private
   */
  _validateSupplements() {
    if (!this.supplements) return;

    if (!Array.isArray(this.supplements)) {
      throw new Error('Supplements must be an array');
    }

    this.supplements.forEach((supplement, index) => {
      if (!(supplement instanceof CodeSystem)) {
        throw new Error(`Supplement ${index} must be a CodeSystem instance, got ${typeof supplement}`);
      }
    });
  }

  /**
   * @section Metadata for the code system
   */

  /**
   * @returns {string} uri for the code system
   */
  name() { return this.system() + (this.version() ? "|"+this.version() : "") }

  /**
   * @returns {string} uri for the code system
   */
  system() { throw new Error("Must override"); }

  /**
   * @returns {string} version for the code system
   */
  version() { throw new Error("Must override"); }

  /**
   * @returns {string} default language for the code system
   */
  defLang() { return 'en' }

  /**
   * @returns {CodeSystemContentMode} content mode for the CodeSystem
   */
  contentMode() { return CodeSystemContentMode.Complete; }

  /**
   * @returns {integer} agreed limitation of expansions (see CPT). 0 means no limitation
   */
  expandLimitation() { return 0; }

  /**
   * @returns {string} description for the code system
   */
  description() { throw new Error("Must override"); }

  /**
   * @returns {string} source package for the code system, if known
   */
  sourcePackage() { return null; }

  /**
   * @returns {integer} total number of concepts in the code system
   */
  totalCount() { throw new Error("Must override"); }

  /**
   * @returns {CodeSystem.property[]} defined properties for the code system
   */
  propertyDefinitions() { return null; }

  /**
   * @param {Languages} languages language specification
   * @returns {boolean} defined properties for the code system
   */
  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    return langs.isEnglishOrNothing();
  }

  resourceLanguageMatches(resource, languages, ifNoLang = false) {
    if (resource.language) {
      const resourceLang = new Language(resource.language);
      for (const requestedLang of languages) {
        if (resourceLang.matchesForDisplay(requestedLang)) {
          return true;
        }
      }
    } else {
      return ifNoLang;
    }
  }

  _hasAnySupplementDisplays(languages) {
    // Check if any supplements have displays in the requested languages
    if (this.supplements) {
      // displays have preference
      for (const supplement of this.supplements) {
        // Check if supplement language matches and has displays
        if (this.resourceLanguageMatches(supplement.jsonObj, languages, false)) {
          // Check if any concept has a display
          const allConcepts = supplement.getAllConcepts();
          if (allConcepts.some(c => c.display)) {
            return true;
          }
        }
      }
      // Check concept designations for display uses
      for (const supplement of this.supplements) {
        const allConcepts = supplement.getAllConcepts();
        for (const concept of allConcepts) {
          if (concept.designation) {
            for (const designation of concept.designation) {
              if (CodeSystem.isUseADisplay(designation.use)) {
                if (designation.language) {
                  const designationLang = new Language(designation.language);
                  for (const requestedLang of languages) {
                    if (designationLang.matchesForDisplay(requestedLang)) {
                      return true;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return false; // nothing in the supplements
  }

  /**
   * @returns {boolean} true if there's a heirarchy
   */
  hasParents() { return false; }

  /**
   * @returns {string} true if the code system nominates an enumeration to use in place of iterating (UCUM)
   */
  specialEnumeration() { return null; }

  /**
   * @param {string} url the supplement of interest
   * @returns {boolean} true if the nominated supplement is in scope
   */
  hasSupplement(url) {
    if (!this.supplements) return false;
    return this.supplements.some(supp => supp.jsonObj.url === url || supp.jsonObj.versionedUrl === url);
  }

  /**
   * @returns {string[]} all supplements in scope
   */
  listSupplements() {
    return this.supplements ? this.supplements.map(s => s.jsonObj.url) : [];
  }

  /**
   * @returns {Feature[]} applicable Features
   */
  listFeatures() { return null; }

  /**
   * @param {string} v1 - first version
   * @param {string} v2 - second version
   * @returns {boolean} True if something....
   */
  versionIsMoreDetailed(v1, v2) { return false; }

  /**
   * @returns { {status, standardsStatus : String, experimental : boolean} } applicable Features
   */
  status() { return null; }

  /**
   * @section Getting Information about the concepts in the CodeSystem
   */

  /**
   * @param {String | CodeSystemProviderContext} code
   * @returns {string} the correct code for the concept specified
   */
  async code(code) {throw new Error("Must override"); }

  /**
   * @param {String | CodeSystemProviderContext} code
   * @returns {string} the best display given the languages in the operation context
   */
  async display(code) {
    throw new Error("Must override");
  }

  /**
   * Protected!
   *
   
   * @param {String} code
   * @returns {string} the best display given the languages in the operation context
   */
  _displayFromSupplements(code) {
    assert(typeof code === 'string', 'code must be string');
    if (this.supplements) {
      const concepts = [];
      // displays have preference
      for (const supplement of this.supplements) {
        // Check if supplement language matches and has displays
        if (this.resourceLanguageMatches(supplement.jsonObj, this.opContext.langs, false)) {
          // Check if any concept has a display
          const concept= supplement.getConceptByCode(code);
          if (concept) {
            if (concept.display) {
              return concept.display;
            }
            concepts.push(concept);
          }
        }
      }
      // Check concept designations for display uses
      for (const concept in concepts) {
        if (concept.designation) {
          for (const designation of concept.designation) {
            if (CodeSystem.isUseADisplay(designation.use) && this.opContext.langs.hasMatch(designation.language)) {
              return designation.value;
            }
          }
        }
      }
      // still here? try again, for any non-language display
      for (const supplement of this.supplements) {
        if (!supplement.jsonObj.language) {
          const concept= supplement.getConceptByCode(code);
          if (concept && concept.display) {
            return concept.display;
          }
        }
      }
    }
    return null; // nothing in the supplements
  }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} the definition for the concept (if available)
   */
  async definition(code) {throw new Error("Must override"); }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is abstract
   */
  async isAbstract(code) { return false; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is inactive
   */
  async isInactive(code) { return false; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is inactive
   */
  async isDeprecated(code) { return false; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} status
   */
  async getStatus(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} assigned itemWeight - if there is one
   */
  async itemWeight(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} parent, if there is one
   */
  async parent(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {Designation[]} whatever designations exist (in all languages)
   */
  async designations(code) { return null; }

  _listSupplementDesignations(code) {
    assert(typeof code === 'string', 'code must be string');
    let designations = [];

    if (this.supplements) {
      for (const supplement of this.supplements) {
        const concept= supplement.getConceptByCode(code);
        if (concept) {
          if (concept.display) {
            designations.push(new Designation(supplement.jsonObj.language, CodeSystem.makeUseForDisplay(), concept.display));
          }
          if (concept.designation) {
            for (const d of concept.designation) {
              designations.push(new Designation(d.language, d.use, d.value));
            }
          }
        }
      }
    }
    return designations;
  }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {Extension[]} extensions, if any
   */
  async extensions(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {CodeSystem.concept.property[]} parent, if there is one
   */
  async properties(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} information about incomplete validation on the concept, if there is any information (SCT)
   */
  async incompleteValidationMessage(code) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} a
   * @param {string | CodeSystemProviderContext} b
   * @returns {boolean} true if they're the same
   */
  async sameConcept(a, b) { return false; }

  /**
   * @section Finding concepts in the CodeSystem
   */

  /**
   
   * @param {string } code
   * @returns {{context : CodeSystemProviderContext, message : String} the result of looking for the code
   */
  async locate(code) { throw new Error("Must override"); }

  /**
   
   * @param {string} code
   * @param {string} parent
   * @param {boolean} disallowParent
   * @returns {{context : CodeSystemProviderContext, message : String} the result of looking for the code in the context of the parent
   */
  async locateIsA(code) {
    if (this.hasParents()) throw new Error("Must override"); else return { context : null, message: "The CodeSystem "+this.name()+" does not have parents"}
  }

  /**
   
   * @param {string | CodeSystemProviderContext} code
   * @returns {CodeSystemIterator} a handle that can be passed to nextConcept (or null, if it can't be iterated)
   */
  async iterator(code) { return null }

  /**
   
   * @param {CodeSystemIterator} context
   * @returns {CodeSystemProviderContext} the next concept, or null
   */
  async nextContext(context) { return null; }

  /**
   
   * @param {string | CodeSystemProviderContext} codeA
   * @param {string | CodeSystemProviderContext} codeB
   * @returns {boolean} true if codeA subsumes codeB
   */
  async subsumesTest(codeA, codeB) { return false; }

  /**
   
   * @param {CodeSystemProviderContext} ctxt the context to add properties for
   * @param {string[]} props the properties requested
   * @param {Parameters} params the parameters response to add to
   */

  async extendLookup(ctxt, props, params) { }

  // procedure getCDSInfo(card : TCDSHookCard; langList : THTTPLanguageList; baseURL, code, display : String); virtual;

  /**
   * returns true if a filter is supported
   *
   * @param {String} prop
   * @param {ValueSetFilterOperator} op
   * @param {String} prop
   * @returns {boolean} true if suppoted
   * */
  async doesFilter(prop, op, value) { return false; }

  /**
   * gets a single context in which filters will be evaluated. The application doesn't make use of this context;
   * it's only use is to be passed back to the CodeSystem provider so it can make use of it - if it wants
   *
   * @param {boolean} iterate true if the conceptSets that result from this will be iterated, and false if they'll be used to locate a single code
   * @returns {FilterExecutionContext} filter (or null, it no use for this)
   * */
  async getPrepContext(iterate) { return new FilterExecutionContext(); }

  /**
   * executes a text search filter (whatever that means) and returns a FilterConceptSet
   *
   * throws an exception if the search filter can't be handled
   *
   * @param {FilterExecutionContext} filterContext filtering context
   * @param {String} filter user entered text search
   * @param {boolean} sort ?
   **/
  async searchFilter(filterContext, filter, sort) { throw new Error("Must override"); } // ? must override?

  /**
   * I don't know what this does
   *
   * throws an exception if the search filter can't be handled
   * @param {FilterExecutionContext} filterContext filtering context
   * @param {String} filter user entered text search
   * @param {boolean} sort ?
   **/
  async specialFilter(filterContext, filter, sort) { throw new Error("Must override"); } // ? must override?

  /**
   * Get a FilterConceptSet for a value set filter
   *
   * throws an exception if the search filter can't be handled
   *
   * @param {FilterExecutionContext} filterContext filtering context
   * @param {String} prop
   * @param {ValueSetFilterOperator} op
   * @param {String} prop
   **/
  async filter(filterContext, prop, op, value) { throw new Error("Must override"); } // well, only if any filters are actually supported

  /**
   * called once all the filters have been handled, and iteration is about to happen.
   * this function returns one more filters. If there were multiple filters, but only
   * one FilterConceptSet, then the code system provider has done the join across the
   * filters, otherwise the engine will do so as required
   *
   * @param {FilterExecutionContext} filterContext filtering context
   * @returns {FilterConceptSet[]} filter sets
   **/
  async executeFilters(filterContext) { throw new Error("Must override"); } // well, only if any filters are actually supported

  /**
   * return how many concepts are in the filter set
   @param {FilterExecutionContext} filterContext filtering context
   @param {FilterConceptSet} set of interest
   @returns {int} number of concepts in the set
   */
  async filterSize(filterContext, set) {throw new Error("Must override"); }

  /**
   * return true if there's an infinite number of members (or at least, beyond knowing)
   *
   * This is true if the code system defines a grammar
   *
   @param {FilterExecutionContext} filterContext filtering context
   @returns {boolean} true if not closed
   */
  async filtersNotClosed(filterContext) { return false; }

  /**
   * iterate the filter set. Iteration is forwards only, using the style
   * while (filterMore()) { something(filterConcept()};
   *
   @param {FilterExecutionContext} filterContext filtering context
   @param {FilterConceptSet} set of interest
   @returns {boolean} if there is a concept
   */
  async filterMore(filterContext, set) {throw new Error("Must override"); }

  /**
   * get the current concept
   *
   @param {FilterExecutionContext} filterContext filtering context
   @param {FilterConceptSet} set of interest
   @returns {CodeSystemProviderContext} if there is a concept
   */
  async filterConcept(filterContext, set) {throw new Error("Must override"); }

  /**
   * filterLocate - instead of iterating, find a code in the FilterConceptSet
   *
   @param {FilterExecutionContext} filterContext filtering context
   @param {FilterConceptSet} set of interest
   @param {string} code the code to find
   @returns {string | CodeSystemProviderContext} an error explaining why it isn't in the set, or a handle to the concept
   */
   async filterLocate(filterContext, set, code) {throw new Error("Must override"); }

   /**
   * filterLocate - instead of iterating, find a code in the FilterConceptSet
   *
   @param {FilterExecutionContext} filterContext filtering context
   @param {FilterConceptSet} set of interest
   @param {CodeSystemProviderContext} concept the code to find
   @returns {string | boolean } an error explaining why it isn't in the set, or true if it is
   */
   async filterCheck(filterContext, set, concept) {throw new Error("Must override"); }

  /**
   * filterFinish - opportunity for the provider to close up and recover resources etc
   *
   @param {FilterExecutionContext} filterContext filtering context
   */
  async filterFinish(filterContext) {throw new Error("Must override"); }

  /**
   * register the concept maps that are implicitly defined as part of the code system
   *
   * @param {ConceptMap[]} conceptMaps
   *
   */
  registerConceptMaps(list) {}


  /**
   * register the concept maps that are implicitly defined as part of the code system
   *
   * @param {Coding} coding the coding to translate
   * @param {String} target
   * @returns {CodeTranslation[]} the list of translations
   */
  async getTranslations(coding, target) { return null;}

  // ==== Parameter checking methods =========
  _ensureLanguages(param) {
    assert(
      typeof param === 'string' ||
      param instanceof Languages ||
      (Array.isArray(param) && param.every(item => typeof item === 'string')),
      'Parameter must be string, Languages object, or array of strings'
    );

    if (typeof param === 'string') {
      return Languages.fromAcceptLanguage(param);
    } else if (Array.isArray(param)) {
      const languages = new Languages();
      for (const str of param) {
        const lang = new Language(str);
        languages.add(lang);
      }
      return languages;
    } else {
      return param; // Already a Languages object
    }
  }

}

class CodeSystemFactoryProvider {
  uses = 0;

  /**
   * @returns {String} the latest version, if known
   */
  defaultVersion() { throw new Error("Must override"); }

  async load() {
    // nothing here
  }



  /**
   
   * @param {CodeSystem[]} supplements any supplements that are in scope
   * @returns {CodeSystemProvider} a built provider - or an exception
   */
  build(opContext, supplements) { throw new Error("Must override Factory"); }

  /**
   * @returns {string} uri for the code system
   */
  system() {
    throw new Error("Must override");
  }

  /**
   * @returns {string} version for the code system
   */
  version() { throw new Error("Must override"); }


/**
   * @returns {number} how many times the factory has been asked to construct a provider
   */
  useCount() {return this.uses}

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  TxOperationContext,
  Designation,
  FilterExecutionContext,
  CodeSystemProvider,
  CodeSystemContentMode,
  CodeSystemFactoryProvider
};