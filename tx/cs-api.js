const CodeSystemContentMode = Object.freeze({Complete: 'complete'});

class TxOperationContext {
@param {Languages} languages - languages specified in the operation
}

class Designation {

}

class CodeSystemProvider {
  /**
   * @section Metadata for the code system
   */

  /**
   * @returns {string} uri for the code system
   */
  name() { return system() + (this.version() ? "|"+this.version() : "") }

  /**
   * @returns {string} uri for the code system
   */
  system() { throw "Must override"; }

  /**
   * @returns {string} version for the code system
   */
  version() { throw "Must override"; }

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
  description() { throw "Must override"; }

  /**
   * @returns {string} source package for the code system, if known
   */
  sourcePackage() { return null; }

  /**
   * @returns {integer} total number of concepts in the code system
   */
  totalCount() { throw "Must override"; }

  /**
   * @returns {CodeSystem.property[]} defined properties for the code system
   */
  propertyDefinitions() { return null; }

  /**
   * @param {Languages} languages language specification
   * @returns {boolean} defined properties for the code system
   */
  hasAnyDisplays(languages) { return languages.matches('en'); }

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
  hasSupplement(url) { return false; }

  /**
   * @returns {string[]} all supplements in scope
   */
  listSupplements() { return null; }

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
  getStatus() { return null; }

  /**
   * @section Getting Information about the concepts in the CodeSystem
   */

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {String | CodeSystemProviderContext} code
   * @returns {string} the correct code for the concept specified
   */
  code(opContext, code) {throw "Must override"; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {String | CodeSystemProviderContext} code
   * @returns {string} the best display given the languages in the operation context
   */
  display(opContext, code) {throw "Must override"; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} the definition for the concept (if available)
   */
  definition(opContext, code) {throw "Must override"; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is abstract
   */
  isAbstract(opContext, code) { return false; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is inactive
   */
  isInactive(opContext, code) { return false; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {boolean} if the concept is inactive
   */
  isDeprecated(opContext, code) { return false; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} status
   */
  getStatus(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} assigned itemWeight - if there is one
   */
  itemWeight(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} parent, if there is one
   */
  parent(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {Designation[]} whatever designations exist (in all languages)
   */
  designations(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {Extension[]} extensions, if any
   */
  extensions(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {CodeSystem.concept.property[]} parent, if there is one
   */
  properties(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {string} information about incomplete validation on the concept, if there is any information (SCT)
   */
  incompleteValidationMessage(opContext, code) { return null; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} a
   * @param {string | CodeSystemProviderContext} b
   * @returns {boolean} true if they're the same
   */
  sameConcept(/*TxOperationContext*/ opContext, a, b) { return false; }

  /**
   * @section Finding concepts in the CodeSystem
   */

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string } code
   * @returns {{context : CodeSystemProviderContext, message : String} the result of looking for the code
   */
  locate(opContext, code) { throw "Must override"; }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string} code
   * @param {string} parent
   * @param {boolean} disallowParent
   * @returns {{context : CodeSystemProviderContext, message : String} the result of looking for the code in the context of the parent
   */
  locateIsA(opContext, code) {
    if (this.hasParents()) throw "Must override"; else return { context : null, message: "The CodeSystem "+this.name()+" does not have parents"}
  }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {string | CodeSystemProviderContext} code
   * @returns {CodeSystemIterator} a handle that can be passed to nextConcept (or null, if it can't be iterated)
   */
  iterator(opContext, code) { return null }

  /**
   * @param {TxOperationContext} opContext operation context (logging, etc)
   * @param {CodeSystemIterator} context
   * @returns {CodeSystemProviderContext} the next concept, or null
   */
  nextContext(opContext,context) { return null; }



  function doesFilter(/*TxOperationContext*/ opContext; prop : String; op : TFhirFilterOperator; value : String) : boolean; virtual;

  function getPrepContext(/*TxOperationContext*/ opContext) : TCodeSystemProviderFilterPreparationContext; virtual;
  function searchFilter(/*TxOperationContext*/ opContext; filter : TSearchFilterText; prep : TCodeSystemProviderFilterPreparationContext; sort : boolean) : TCodeSystemProviderFilterContext; virtual; abstract;
  function specialFilter(/*TxOperationContext*/ opContext; prep : TCodeSystemProviderFilterPreparationContext; sort : boolean) : TCodeSystemProviderFilterContext; virtual;
  function filter(/*TxOperationContext*/ opContext; forExpansion, forIteration : boolean; prop : String; op : TFhirFilterOperator; value : String; prep : TCodeSystemProviderFilterPreparationContext) : TCodeSystemProviderFilterContext; virtual; abstract;
  function prepare(/*TxOperationContext*/ opContext; prep : TCodeSystemProviderFilterPreparationContext) : boolean; virtual; // true if the underlying provider collapsed multiple filters
  function filterLocate(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext; code : String; var message : String) : TCodeSystemProviderContext; overload; virtual; abstract;
  function filterLocate(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext; code : String) : TCodeSystemProviderContext; overload; virtual;
  function FilterMore(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext) : boolean; virtual; abstract;
  function filterSize(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext) : integer; overload; virtual; abstract;
  function FilterConcept(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext): TCodeSystemProviderContext; virtual; abstract;
  function InFilter(/*TxOperationContext*/ opContext; ctxt : TCodeSystemProviderFilterContext; concept : TCodeSystemProviderContext) : Boolean; virtual; abstract;
  function isNotClosed(/*TxOperationContext*/ opContext; textFilter : TSearchFilterText; propFilter : TCodeSystemProviderFilterContext = nil) : boolean; virtual; abstract;
  procedure extendLookup(/*TxOperationContext*/ opContext; factory : TFHIRFactory; ctxt : TCodeSystemProviderContext; langList : THTTPLanguageList; props : TArray<String>; resp : TFHIRLookupOpResponseW); virtual;
  function subsumesTest(/*TxOperationContext*/ opContext; codeA, codeB : String) : String; virtual;

  procedure getCDSInfo(/*TxOperationContext*/ opContext; card : TCDSHookCard; langList : THTTPLanguageList; baseURL, code, display : String); virtual;

  procedure registerConceptMaps(list : TFslList<TFHIRConceptMapW>; factory : TFHIRFactory); virtual;
  procedure getTranslations(coding: TFHIRCodingW; target : String; codes : TFslList<TCodeTranslation>); virtual;


  procedure RecordUse(count : integer = 1);
  procedure checkReady; virtual;
  function defToThisVersion(specifiedVersion : String) : boolean; virtual;
  property UseCount : cardinal read FUseCount;
}

class CodeSystemFactory {

  defaultToLatest() {
    return boolean;
    throw "Must override";
  }
  // returns a CodeSystemProvider
  build(supplements) {
      throw "Must override Factory";
  }
}
