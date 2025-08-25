const { CodeSystem, CodeSystemContentMode}  = require("../library/codesystem");
const { CodeSystemFactoryProvider, CodeSystemProvider, Designation, FilterExecutionContext }  = require( "./cs-api");
const { VersionUtilities }  = require("../../library/version-utilities");
const { Language }  = require ("../../library/languages");

/**
 * Context class for FHIR CodeSystem provider concepts
 */
class FhirCodeSystemProviderContext {
  constructor(code, concept) {
    this.code = code;
    this.concept = concept;
  }
}

/**
 * Context class for FHIR CodeSystem provider filter results
 */
class FhirCodeSystemProviderFilterContext {
  constructor() {
    this.concepts = []; // Array of {concept, rating} objects
    this.currentIndex = -1;
    this.include = true; // Whether this is an include or exclude filter
  }

  /**
   * Add a concept to the filter results
   * @param {Object} concept - The concept object
   * @param {number} rating - Search relevance rating (higher = more relevant)
   */
  add(concept, rating = 0) {
    this.concepts.push({ concept, rating });
  }

  /**
   * Sort concepts by rating (highest first)
   */
  sort() {
    this.concepts.sort((a, b) => b.rating - a.rating);
  }

  /**
   * Get the total number of concepts in the filter
   * @returns {number} Number of concepts
   */
  size() {
    return this.concepts.length;
  }

  /**
   * Check if there are more concepts to iterate
   * @returns {boolean} True if more concepts available
   */
  hasMore() {
    return this.currentIndex + 1 < this.concepts.length;
  }

  /**
   * Move to next concept and return it
   * @returns {Object|null} Next concept or null if exhausted
   */
  next() {
    if (this.hasMore()) {
      this.currentIndex++;
      return this.concepts[this.currentIndex].concept;
    }
    return null;
  }

  /**
   * Reset iterator to beginning
   */
  reset() {
    this.currentIndex = -1;
  }

  /**
   * Find a concept by code in the filter results
   * @param {string} code - The code to find
   * @returns {Object|null} The concept if found, null otherwise
   */
  findConceptByCode(code) {
    for (const item of this.concepts) {
      if (item.concept.code === code) {
        return item.concept;
      }
    }
    return null;
  }

  /**
   * Check if a concept is in the filter results
   * @param {Object} concept - The concept to check
   * @returns {boolean} True if concept is in results
   */
  containsConcept(concept) {
    return this.concepts.some(item => item.concept === concept);
  }
}

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

  /**
   * @returns {{status: string, standardsStatus: string, experimental: boolean}|null} Status information
   */
  status() {
    const cs = this.codeSystem.jsonObj;
    if (!cs.status) return null;

    return {
      status: cs.status,
      standardsStatus: cs.extension?.find(ext =>
        ext.url === 'http://hl7.org/fhir/StructureDefinition/structuredefinition-standards-status'
      )?.valueCode || '',
      experimental: cs.experimental || false
    };
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} The correct code for the concept
   */
  async code(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    return ctxt ? ctxt.code : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string} code - The code to locate
   * @returns {Promise<{context: FhirCodeSystemProviderContext|null, message: string|null}>} Locate result
   */
  async locate(opContext, code) {
    this._ensureOpContext(opContext);

    if (!code || typeof code !== 'string') {
      return { context: null, message: 'Empty or invalid code' };
    }

    const concept = this.codeSystem.getConceptByCode(code);
    if (concept) {
      return {
        context: new FhirCodeSystemProviderContext(code, concept),
        message: null
      };
    }

    return {
      context: null,
      message: `Code '${code}' not found in CodeSystem '${this.system()}'`
    };
  }

  /**
   * Helper method to ensure we have a proper context object
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<FhirCodeSystemProviderContext|null>} Resolved context
   * @private
   */
  async #ensureContext(opContext, context) {
    if (context == null) {
      return null;
    }

    if (typeof context === 'string') {
      const result = await this.locate(opContext, context);
      if (result.context == null) {
        throw new Error(result.message);
      }
      return result.context;
    }

    if (context instanceof FhirCodeSystemProviderContext) {
      return context;
    }

    throw new Error("Unknown Type at #ensureContext: " + (typeof context));
  }
  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} The best display given the languages in the operation context
   */
  async display(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    // Check supplements first
    const supplementDisplay = this._displayFromSupplements(opContext, ctxt.code);
    if (supplementDisplay) {
      return supplementDisplay;
    }

    // Use language-aware display logic
    if (opContext.langs && !opContext.langs.isEnglishOrNothing()) {
      // Try to find exact language match in designations
      if (ctxt.concept.designation && Array.isArray(ctxt.concept.designation)) {
        for (const lang of opContext.langs.languages) {
          for (const designation of ctxt.concept.designation) {
            if (designation.language) {
              const designationLang = new Language(designation.language);
              if (designationLang.matchesForDisplay(lang)) {
                return designation.value.trim();
              }
            }
          }
        }
      }

      // Check if the CodeSystem's language matches requested languages
      if (this.defaultLanguage) {
        for (const requestedLang of opContext.langs.languages) {
          if (this.defaultLanguage.matchesForDisplay(requestedLang)) {
            return ctxt.concept.display?.trim() || '';
          }
        }
      }
    }

    // Default to the concept's display
    return ctxt.concept.display?.trim() || '';
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} The definition for the concept (if available)
   */
  async definition(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    return ctxt ? (ctxt.concept.definition || null) : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<boolean>} If the concept is abstract
   */
  async isAbstract(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return false;
    }

    // Check for abstract property
    if (ctxt.concept.property && Array.isArray(ctxt.concept.property)) {
      const abstractProp = ctxt.concept.property.find(p =>
        p.code === 'abstract' ||
        p.code === 'notSelectable' ||
        p.uri === 'http://hl7.org/fhir/concept-properties#notSelectable'
      );
      if (abstractProp && abstractProp.valueBoolean) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<boolean>} If the concept is inactive
   */
  async isInactive(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return false;
    }

    // Check for inactive property
    if (ctxt.concept.property && Array.isArray(ctxt.concept.property)) {
      const inactiveProp = ctxt.concept.property.find(p =>
        p.code === 'inactive' ||
        p.uri === 'http://hl7.org/fhir/concept-properties#inactive'
      );
      if (inactiveProp && inactiveProp.valueBoolean) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<boolean>} If the concept is deprecated
   */
  async isDeprecated(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return false;
    }

    // Check for deprecated property or status
    if (ctxt.concept.property && Array.isArray(ctxt.concept.property)) {
      const deprecatedProp = ctxt.concept.property.find(p =>
        p.code === 'deprecated' ||
        p.uri === 'http://hl7.org/fhir/concept-properties#deprecated'
      );
      if (deprecatedProp && deprecatedProp.valueBoolean) {
        return true;
      }

      // Check status property
      const statusProp = ctxt.concept.property.find(p =>
        p.code === 'status' ||
        p.uri === 'http://hl7.org/fhir/concept-properties#status'
      );
      if (statusProp && (statusProp.valueCode === 'deprecated' || statusProp.valueCode === 'retired')) {
        return true;
      }
    }

    return false;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} Status
   */
  async getStatus(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    // Check for status property
    if (ctxt.concept.property && Array.isArray(ctxt.concept.property)) {
      const statusProp = ctxt.concept.property.find(p =>
        p.code === 'status' ||
        p.uri === 'http://hl7.org/fhir/concept-properties#status'
      );
      if (statusProp && statusProp.valueCode) {
        return statusProp.valueCode;
      }
    }

    return null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} Assigned itemWeight - if there is one
   */
  async itemWeight(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    // Check for itemWeight extension
    if (ctxt.concept.extension && Array.isArray(ctxt.concept.extension)) {
      const itemWeightExt = ctxt.concept.extension.find(ext =>
        ext.url === 'http://hl7.org/fhir/StructureDefinition/itemWeight'
      );
      if (itemWeightExt && itemWeightExt.valueDecimal !== undefined) {
        return itemWeightExt.valueDecimal.toString();
      }
    }

    // Check in supplements
    if (this.supplements) {
      for (const supplement of this.supplements) {
        const supplementConcept = supplement.getConceptByCode(ctxt.code);
        if (supplementConcept && supplementConcept.extension && Array.isArray(supplementConcept.extension)) {
          const itemWeightExt = supplementConcept.extension.find(ext =>
            ext.url === 'http://hl7.org/fhir/StructureDefinition/itemWeight'
          );
          if (itemWeightExt && itemWeightExt.valueDecimal !== undefined) {
            return itemWeightExt.valueDecimal.toString();
          }
        }
      }
    }

    return null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<Designation[]|null>} Whatever designations exist (in all languages)
   */
  async designations(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    const designations = [];

    // Add main display as a designation
    if (ctxt.concept.display) {
      const displayLang = this.defaultLanguage ? this.defaultLanguage.toString() : 'en';
      designations.push(new Designation(displayLang, CodeSystem.makeUseForDisplay(), ctxt.concept.display));
    }

    // Add concept designations
    if (ctxt.concept.designation && Array.isArray(ctxt.concept.designation)) {
      for (const designation of ctxt.concept.designation) {
        designations.push(new Designation(
          designation.language || '',
          designation.use || null,
          designation.value
        ));
      }
    }

    // Add supplement designations
    const supplementDesignations = this._listSupplementDesignations(ctxt.code);
    designations.push(...supplementDesignations);

    return designations.length > 0 ? designations : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<Object[]|null>} Extensions, if any
   */
  async extensions(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    const extensions = [];

    // Add extensions from main concept
    if (ctxt.concept.extension && Array.isArray(ctxt.concept.extension)) {
      extensions.push(...ctxt.concept.extension);
    }

    // Add extensions from supplements
    if (this.supplements) {
      for (const supplement of this.supplements) {
        const supplementConcept = supplement.getConceptByCode(ctxt.code);
        if (supplementConcept && supplementConcept.extension && Array.isArray(supplementConcept.extension)) {
          extensions.push(...supplementConcept.extension);
        }
      }
    }

    return extensions.length > 0 ? extensions : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<Object[]|null>} Properties, if any
   */
  async properties(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    const properties = [];

    // Add properties from main concept
    if (ctxt.concept.property && Array.isArray(ctxt.concept.property)) {
      properties.push(...ctxt.concept.property);
    }

    // Add properties from supplements
    if (this.supplements) {
      for (const supplement of this.supplements) {
        const supplementConcept = supplement.getConceptByCode(ctxt.code);
        if (supplementConcept && supplementConcept.property && Array.isArray(supplementConcept.property)) {
          properties.push(...supplementConcept.property);
        }
      }
    }

    return properties.length > 0 ? properties : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context
   * @returns {Promise<string|null>} Parent, if there is one
   */
  async parent(opContext, context) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, context);
    if (!ctxt) {
      return null;
    }

    // Get parents from CodeSystem hierarchy maps
    const parents = this.codeSystem.getParents(ctxt.code);
    return parents.length > 0 ? parents[0] : null;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} a - First code or context
   * @param {string|FhirCodeSystemProviderContext} b - Second code or context
   * @returns {Promise<boolean>} True if they're the same
   */
  async sameConcept(opContext, a, b) {
    this._ensureOpContext(opContext);

    const ctxtA = await this.#ensureContext(opContext, a);
    const ctxtB = await this.#ensureContext(opContext, b);

    if (!ctxtA || !ctxtB) {
      return false;
    }

    return ctxtA.code === ctxtB.code;
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string} code - The code to locate
   * @param {string} parent - The parent code
   * @param {boolean} disallowSelf - Whether to disallow the code being the same as parent
   * @returns {Promise<{context: FhirCodeSystemProviderContext|null, message: string|null}>} Locate result
   */
  async locateIsA(opContext, code, parent, disallowSelf = false) {
    this._ensureOpContext(opContext);

    if (!this.hasParents()) {
      return {
        context: null,
        message: `The CodeSystem ${this.name()} does not have parents`
      };
    }

    // First check if both codes exist
    const codeResult = await this.locate(opContext, code);
    if (!codeResult.context) {
      return codeResult;
    }

    const parentResult = await this.locate(opContext, parent);
    if (!parentResult.context) {
      return {
        context: null,
        message: `Parent code '${parent}' not found in CodeSystem '${this.system()}'`
      };
    }

    // Check if code is same as parent
    if (code === parent) {
      if (disallowSelf) {
        return {
          context: null,
          message: `Code '${code}' cannot be the same as its parent`
        };
      } else {
        return codeResult; // Return the code itself
      }
    }

    // Check if code is a descendant of parent
    const ancestors = this.codeSystem.getAncestors(code);
    if (ancestors.includes(parent)) {
      return codeResult;
    }

    return {
      context: null,
      message: `Code '${code}' is not a descendant of '${parent}'`
    };
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string} codeA - First code
   * @param {string} codeB - Second code
   * @returns {Promise<string>} 'subsumes', 'subsumed-by', 'equivalent', or 'not-subsumed'
   */
  async subsumesTest(opContext, codeA, codeB) {
    this._ensureOpContext(opContext);

    // Check if both codes exist
    const resultA = await this.locate(opContext, codeA);
    if (!resultA.context) {
      throw new Error(`Unknown Code "${codeA}"`);
    }

    const resultB = await this.locate(opContext, codeB);
    if (!resultB.context) {
      throw new Error(`Unknown Code "${codeB}"`);
    }

    // Check if they're the same
    if (codeA === codeB) {
      return 'equivalent';
    }

    // If no hierarchy, codes can't subsume each other
    if (!this.hasParents()) {
      return 'not-subsumed';
    }

    // Check if A subsumes B (B is descendant of A)
    if (this.codeSystem.isDescendantOf(codeB, codeA)) {
      return 'subsumes';
    }

    // Check if B subsumes A (A is descendant of B)
    if (this.codeSystem.isDescendantOf(codeA, codeB)) {
      return 'subsumed-by';
    }

    return 'not-subsumed';
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {string|FhirCodeSystemProviderContext} context - Code or context to iterate from
   * @returns {Promise<Object|null>} A handle that can be passed to nextContext (or null if can't be iterated)
   */
  async iterator(opContext, context) {
    this._ensureOpContext(opContext);

    if (context === null || context === undefined) {
      // Iterate all concepts starting from root concepts
      const allCodes = this.codeSystem.getAllCodes();
      return {
        type: 'all',
        codes: allCodes,
        current: 0,
        total: allCodes.length
      };
    } else {
      const ctxt = await this.#ensureContext(opContext, context);
      if (!ctxt) {
        return null;
      }

      // Iterate children of the specified concept
      const children = this.codeSystem.getChildren(ctxt.code);
      return {
        type: 'children',
        parentCode: ctxt.code,
        codes: children,
        current: 0,
        total: children.length
      };
    }
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {Object} iteratorContext - Iterator context from iterator()
   * @returns {Promise<FhirCodeSystemProviderContext|null>} The next concept, or null
   */
  async nextContext(opContext, iteratorContext) {
    this._ensureOpContext(opContext);

    if (!iteratorContext || iteratorContext.current >= iteratorContext.total) {
      return null;
    }

    const code = iteratorContext.codes[iteratorContext.current];
    iteratorContext.current++;

    // Get the concept for this code
    const concept = this.codeSystem.getConceptByCode(code);
    if (!concept) {
      return null;
    }

    return new FhirCodeSystemProviderContext(code, concept);
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {FhirCodeSystemProviderContext} ctxt - The context to add properties for
   * @param {string[]} props - The properties requested
   * @param {Object} params - The parameters response to add to
   */
  async extendLookup(opContext, ctxt, props, params) {
    this._ensureOpContext(opContext);

    if (!ctxt || !(ctxt instanceof FhirCodeSystemProviderContext)) {
      return;
    }

    // Set abstract status
    params.abstract = await this.isAbstract(opContext, ctxt);

    // Add designations if requested (or by default)
    if (!props || props.length === 0 || props.includes('*') || props.includes('designation')) {
      const designations = await this.designations(opContext, ctxt);
      if (designations) {
        if (!params.designation) {
          params.designation = [];
        }
        for (const designation of designations) {
          const paramDesignation = {
            language: designation.language,
            value: designation.value
          };
          if (designation.use) {
            paramDesignation.use = designation.use;
          }
          params.designation.push(paramDesignation);
        }
      }
    }

    // Add properties if requested (or by default)
    if (!props || props.length === 0 || props.includes('*') || props.includes('property')) {
      const properties = await this.properties(opContext, ctxt);
      if (properties) {
        if (!params.property) {
          params.property = [];
        }
        for (const property of properties) {
          const paramProperty = {
            code: property.code
          };

          // Add the appropriate value based on the property type
          if (property.valueCode) {
            paramProperty.valueCode = property.valueCode;
          } else if (property.valueString) {
            paramProperty.valueString = property.valueString;
          } else if (property.valueInteger !== undefined) {
            paramProperty.valueInteger = property.valueInteger;
          } else if (property.valueBoolean !== undefined) {
            paramProperty.valueBoolean = property.valueBoolean;
          } else if (property.valueDateTime) {
            paramProperty.valueDateTime = property.valueDateTime;
          } else if (property.valueDecimal !== undefined) {
            paramProperty.valueDecimal = property.valueDecimal;
          } else if (property.valueCoding) {
            paramProperty.valueCoding = property.valueCoding;
          }

          params.property.push(paramProperty);
        }
      }
    }

    // Add parent if requested and exists
    if (!props || props.length === 0 || props.includes('*') || props.includes('parent')) {
      const parentCode = await this.parent(opContext, ctxt);
      if (parentCode) {
        if (!params.property) {
          params.property = [];
        }

        // Get parent's display for description
        const parentDisplay = await this.display(opContext, parentCode);

        params.property.push({
          code: 'parent',
          valueCode: parentCode,
          description: parentDisplay || parentCode
        });
      }
    }

    // Add children if requested
    if (!props || props.length === 0 || props.includes('*') || props.includes('child')) {
      const children = this.codeSystem.getChildren(ctxt.code);
      if (children.length > 0) {
        if (!params.property) {
          params.property = [];
        }

        for (const childCode of children) {
          const childDisplay = await this.display(opContext, childCode);
          params.property.push({
            code: 'child',
            valueCode: childCode,
            description: childDisplay || childCode
          });
        }
      }
    }
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {boolean} iterate - True if results will be iterated
   * @returns {FilterExecutionContext} Filter context
   */
  async getPrepContext(opContext, iterate) {
    this._ensureOpContext(opContext);
    return new FilterExecutionContext();
  }

  /**
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @returns {boolean} True if filters are not closed (infinite results possible)
   */
  async filtersNotClosed(opContext, filterContext) {
    this._ensureOpContext(opContext);
    return false; // FHIR CodeSystems are typically closed/finite
  }

  /**
   * Determines if a specific filter is supported
   * @param {TxOperationContext} opContext - Operation context
   * @param {string} prop - Property name
   * @param {string} op - Filter operator (=, is-a, descendent-of, etc.)
   * @param {string} value - Filter value
   * @returns {Promise<boolean>} True if filter is supported
   */
  async doesFilter(opContext, prop, op, value) {
    this._ensureOpContext(opContext);

    // Supported hierarchy filters
    if ((prop === 'concept' || prop === 'code') &&
      ['is-a', 'descendent-of', 'is-not-a', 'in', '=', 'regex'].includes(op)) {
      return true;
    }

    // Child existence filter
    if (prop === 'child' && op === 'exists') {
      return true;
    }

    // Property-based filters
    const propertyDefs = this.propertyDefinitions();
    if (propertyDefs) {
      const hasProperty = propertyDefs.some(p => p.code === prop);
      if (hasProperty && ['=', 'in', 'not-in', 'regex'].includes(op)) {
        return true;
      }
    }

    // Known special properties
    const knownProperties = ['notSelectable', 'status', 'inactive', 'deprecated'];
    if (knownProperties.includes(prop) && ['=', 'in', 'not-in'].includes(op)) {
      return true;
    }

    return false;
  }

  /**
   * Execute filter preparation - returns array of filter contexts
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @returns {Promise<Array>} Array of filter result sets
   */
  async executeFilters(opContext, filterContext) {
    this._ensureOpContext(opContext);

    // Return the accumulated filters from the context
    return filterContext.filters || [];
  }

  /**
   * Get the size of a filter result set
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {FhirCodeSystemProviderFilterContext} set - Filter result set
   * @returns {Promise<number>} Number of concepts in the set
   */
  async filterSize(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    return set ? set.size() : 0;
  }

  /**
   * Check if there are more results in the filter set iterator
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {FhirCodeSystemProviderFilterContext} set - Filter result set
   * @returns {Promise<boolean>} True if more results available
   */
  async filterMore(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    if (!set) return false;
    return set.hasMore();
  }

  /**
   * Get the current concept from the filter set iterator
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {FhirCodeSystemProviderFilterContext} set - Filter result set
   * @returns {Promise<FhirCodeSystemProviderContext|null>} Current concept context
   */
  async filterConcept(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    if (!set) return null;

    const concept = set.next();
    return concept ? new FhirCodeSystemProviderContext(concept.code, concept) : null;
  }

  /**
   * Find a specific code in the filter results
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {FhirCodeSystemProviderFilterContext} set - Filter result set
   * @param {string} code - Code to find
   * @returns {Promise<FhirCodeSystemProviderContext|string>} Context if found, error message if not
   */
  async filterLocate(opContext, filterContext, set, code) {
    this._ensureOpContext(opContext);
    if (!set) {
      return `Code '${code}' not found: no filter results`;
    }

    const concept = set.findConceptByCode(code);
    if (concept) {
      return new FhirCodeSystemProviderContext(code, concept);
    }

    return `Code '${code}' not found in filter results`;
  }

  /**
   * Check if a concept is in the filter results
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {FhirCodeSystemProviderFilterContext} set - Filter result set
   * @param {FhirCodeSystemProviderContext} concept - Concept to check
   * @returns {Promise<boolean|string>} True if found, error message if not
   */
  async filterCheck(opContext, filterContext, set, concept) {
    this._ensureOpContext(opContext);
    if (!set || !concept) {
      return 'Invalid filter set or concept';
    }

    const found = set.containsConcept(concept.concept);
    return found ? true : `Concept '${concept.code}' not found in filter results`;
  }

  /**
   * Clean up filter resources
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   */
  async filterFinish(opContext, filterContext) {
    this._ensureOpContext(opContext);
    // Clear any cached data
    if (filterContext.filters) {
      filterContext.filters.forEach(filter => {
        if (filter.reset) {
          filter.reset();
        }
      });
      filterContext.filters.length = 0;
    }
  }
  /**
   * Execute text-based search filter
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} filter - Search text
   * @param {boolean} sort - Whether to sort results by relevance
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   */
  async searchFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);

    const results = new FhirCodeSystemProviderFilterContext();
    const searchTerm = filter.toLowerCase();

    // Search through all concepts
    const allConcepts = this.codeSystem.getAllConcepts();

    for (const concept of allConcepts) {
      const rating = this._calculateSearchRating(concept, searchTerm);
      if (rating > 0) {
        results.add(concept, rating);
      }
    }

    if (sort) {
      results.sort();
    }

    // Add to filter context
    if (!filterContext.filters) {
      filterContext.filters = [];
    }
    filterContext.filters.push(results);

    return results;
  }

  /**
   * Calculate search relevance rating for a concept
   * @param {Object} concept - The concept to rate
   * @param {string} searchTerm - The search term (lowercase)
   * @returns {number} Rating (0 = no match, higher = better match)
   * @private
   */
  _calculateSearchRating(concept, searchTerm) {
    let rating = 0;

    // Exact matches get highest rating
    if (concept.code.toLowerCase() === searchTerm) {
      rating = 100;
    } else if (concept.display && concept.display.toLowerCase() === searchTerm) {
      rating = 100;
    }
    // Code starts with search term
    else if (concept.code.toLowerCase().startsWith(searchTerm)) {
      rating = 90;
    }
    // Display starts with search term
    else if (concept.display && concept.display.toLowerCase().startsWith(searchTerm)) {
      const lengthRatio = searchTerm.length / concept.display.length;
      rating = 80 + (10 * lengthRatio);
    }
    // Code contains search term
    else if (concept.code.toLowerCase().includes(searchTerm)) {
      rating = 60;
    }
    // Display contains search term
    else if (concept.display && concept.display.toLowerCase().includes(searchTerm)) {
      rating = 50;
    }
    // Definition contains search term
    else if (concept.definition && concept.definition.toLowerCase().includes(searchTerm)) {
      rating = 30;
    }
    // Check designations
    else if (concept.designation && Array.isArray(concept.designation)) {
      for (const designation of concept.designation) {
        if (designation.value && designation.value.toLowerCase().includes(searchTerm)) {
          rating = 40;
          break;
        }
      }
    }

    return rating;
  }

  /**
   * Execute a value set filter
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} prop - Property name to filter on
   * @param {string} op - Filter operator
   * @param {string} value - Filter value
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   */
  async filter(opContext, filterContext, prop, op, value) {
    this._ensureOpContext(opContext);

    let results = null;

    // Handle concept/code hierarchy filters
    if ((prop === 'concept' || prop === 'code')) {
      results = await this._handleConceptFilter(opContext, filterContext, op, value);
    }

    // Handle child existence filter
    if (prop === 'child' && op === 'exists') {
      results = await this._handleChildExistsFilter(opContext, filterContext, value);
    }

    // Handle property-based filters
    const propertyDefs = this.propertyDefinitions();
    if (propertyDefs) {
      const propertyDef = propertyDefs.find(p => p.code === prop);
      if (propertyDef) {
        results = await this._handlePropertyFilter(opContext, filterContext, propertyDef, op, value);
      }
    }

    // Handle known special properties
    const knownProperties = ['notSelectable', 'status', 'inactive', 'deprecated'];
    if (knownProperties.includes(prop)) {
      results = await this._handleKnownPropertyFilter(opContext, filterContext, prop, op, value);
    }

    if (results == null) {
      throw new Error(`The filter ${prop}${op}${value} was not understood`)
    }
    // Add to filter context
    if (!filterContext.filters) {
      filterContext.filters = [];
    }
    filterContext.filters.push(results);

    return results;
  }

  /**
   * Handle concept/code filters (is-a, descendent-of, etc.)
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} op - Filter operator
   * @param {string} value - Filter value (code)
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   * @private
   */
  async _handleConceptFilter(opContext, filterContext, op, value) {
    const results = new FhirCodeSystemProviderFilterContext();

    if (op === 'is-a' || op === 'descendent-of') {
      // Find all descendants of the specified code
      const includeRoot = (op === 'is-a');
      await this._addDescendants(results, value, includeRoot);
    }
    else if (op === 'is-not-a') {
      // Find all concepts that are NOT descendants of the specified code
      const excludeDescendants = this.codeSystem.getDescendants(value);
      const excludeSet = new Set([value, ...excludeDescendants]);

      const allCodes = this.codeSystem.getAllCodes();
      for (const code of allCodes) {
        if (!excludeSet.has(code)) {
          const concept = this.codeSystem.getConceptByCode(code);
          if (concept) {
            results.add(concept, 0);
          }
        }
      }
    }
    else if (op === 'in') {
      // Value is comma-separated list of codes
      const codes = value.split(',').map(c => c.trim());
      for (const code of codes) {
        const concept = this.codeSystem.getConceptByCode(code);
        if (concept) {
          results.add(concept, 0);
        }
      }
    }
    else if (op === '=') {
      // Exact match
      const concept = this.codeSystem.getConceptByCode(value);
      if (concept) {
        results.add(concept, 0);
      }
    }
    else if (op === 'regex') {
      // Regular expression match
      try {
        const regex = new RegExp('^' + value + '$');
        const allCodes = this.codeSystem.getAllCodes();
        for (const code of allCodes) {
          if (regex.test(code)) {
            const concept = this.codeSystem.getConceptByCode(code);
            if (concept) {
              results.add(concept, 0);
            }
          }
        }
      } catch (error) {
        throw new Error(`Invalid regex pattern: ${value}`);
      }
    }

    return results;
  }

  /**
   * Add descendants of a code to the results
   * @param {FhirCodeSystemProviderFilterContext} results - Results to add to
   * @param {string} ancestorCode - The ancestor code
   * @param {boolean} includeRoot - Whether to include the root code itself
   * @private
   */
  async _addDescendants(results, ancestorCode, includeRoot) {
    if (includeRoot) {
      const rootConcept = this.codeSystem.getConceptByCode(ancestorCode);
      if (rootConcept) {
        results.add(rootConcept, 0);
      }
    }

    const descendants = this.codeSystem.getDescendants(ancestorCode);
    for (const code of descendants) {
      const concept = this.codeSystem.getConceptByCode(code);
      if (concept) {
        results.add(concept, 0);
      }
    }
  }

  /**
   * Handle child exists filter
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} value - 'true' or 'false'
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   * @private
   */
  async _handleChildExistsFilter(opContext, filterContext, value) {
    const results = new FhirCodeSystemProviderFilterContext();
    const wantChildren = (value === 'true');

    const allCodes = this.codeSystem.getAllCodes();
    for (const code of allCodes) {
      const hasChildren = this.codeSystem.getChildren(code).length > 0;
      if (hasChildren === wantChildren) {
        const concept = this.codeSystem.getConceptByCode(code);
        if (concept) {
          results.add(concept, 0);
        }
      }
    }

    return results;
  }

  /**
   * Handle property-based filter
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {Object} propertyDef - Property definition
   * @param {string} op - Filter operator
   * @param {string} value - Filter value
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   * @private
   */
  async _handlePropertyFilter(opContext, filterContext, propertyDef, op, value) {
    const results = new FhirCodeSystemProviderFilterContext();
    const allConcepts = this.codeSystem.getAllConcepts();

    for (const concept of allConcepts) {
      if (this._conceptMatchesPropertyFilter(concept, propertyDef, op, value)) {
        results.add(concept, 0);
      }
    }

    return results;
  }

  /**
   * Check if concept matches property filter
   * @param {Object} concept - The concept to check
   * @param {Object} propertyDef - Property definition
   * @param {string} op - Filter operator
   * @param {string} value - Filter value
   * @returns {boolean} True if concept matches filter
   * @private
   */
  _conceptMatchesPropertyFilter(concept, propertyDef, op, value) {
    if (!concept.property || !Array.isArray(concept.property)) {
      return false;
    }

    const properties = concept.property.filter(p => p.code === propertyDef.code);

    if (op === '=') {
      return properties.some(p => this._getPropertyValue(p) === value);
    }
    else if (op === 'in') {
      const values = value.split(',').map(v => v.trim());
      return properties.some(p => values.includes(this._getPropertyValue(p)));
    }
    else if (op === 'not-in') {
      const values = value.split(',').map(v => v.trim());
      return !properties.some(p => values.includes(this._getPropertyValue(p)));
    }
    else if (op === 'regex') {
      try {
        const regex = new RegExp('^' + value + '$');
        return properties.some(p => regex.test(this._getPropertyValue(p)));
      } catch (error) {
        return false;
      }
    }

    return false;
  }

  /**
   * Get property value as string
   * @param {Object} property - The property object
   * @returns {string} Property value
   * @private
   */
  _getPropertyValue(property) {
    if (property.valueCode) return property.valueCode;
    if (property.valueString) return property.valueString;
    if (property.valueInteger !== undefined) return property.valueInteger.toString();
    if (property.valueBoolean !== undefined) return property.valueBoolean.toString();
    if (property.valueDecimal !== undefined) return property.valueDecimal.toString();
    if (property.valueDateTime) return property.valueDateTime;
    if (property.valueCoding) return property.valueCoding.code || '';

    return '';
  }

  /**
   * Handle known property filters (notSelectable, status, etc.)
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} prop - Property name
   * @param {string} op - Filter operator
   * @param {string} value - Filter value
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   * @private
   */
  async _handleKnownPropertyFilter(opContext, filterContext, prop, op, value) {
    const results = new FhirCodeSystemProviderFilterContext();
    const allConcepts = this.codeSystem.getAllConcepts();

    for (const concept of allConcepts) {
      let matches = false;

      if (prop === 'notSelectable') {
        const isAbstract = await this.isAbstract(opContext, new FhirCodeSystemProviderContext(concept.code, concept));
        const expectedValue = (value === 'true');
        matches = (isAbstract === expectedValue);
      }
      else if (prop === 'status') {
        const status = await this.getStatus(opContext, new FhirCodeSystemProviderContext(concept.code, concept));
        if (op === '=') {
          matches = (status === value);
        } else if (op === 'in') {
          const values = value.split(',').map(v => v.trim());
          matches = values.includes(status);
        } else if (op === 'not-in') {
          const values = value.split(',').map(v => v.trim());
          matches = !values.includes(status);
        }
      }
      else if (prop === 'inactive') {
        const isInactive = await this.isInactive(opContext, new FhirCodeSystemProviderContext(concept.code, concept));
        const expectedValue = (value === 'true');
        matches = (isInactive === expectedValue);
      }
      else if (prop === 'deprecated') {
        const isDeprecated = await this.isDeprecated(opContext, new FhirCodeSystemProviderContext(concept.code, concept));
        const expectedValue = (value === 'true');
        matches = (isDeprecated === expectedValue);
      }

      if (matches) {
        results.add(concept, 0);
      }
    }

    return results;
  }

  /**
   * Handle special filters (placeholder - extend as needed)
   * @param {TxOperationContext} opContext - Operation context
   * @param {FilterExecutionContext} filterContext - Filter context
   * @param {string} filter - Special filter
   * @param {boolean} sort - Whether to sort results
   * @returns {Promise<FhirCodeSystemProviderFilterContext>} Filter results
   */
  async specialFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);

    // Placeholder for special filter implementation
    // Can be extended for CodeSystem-specific special filters
    const results = new FhirCodeSystemProviderFilterContext();

    // Add to filter context
    if (!filterContext.filters) {
      filterContext.filters = [];
    }
    filterContext.filters.push(results);

    return results;
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
  FhirCodeSystemProvider,
  FhirCodeSystemProviderContext,
  FhirCodeSystemProviderFilterContext
};