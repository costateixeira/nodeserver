const { CodeSystemProvider, Designation, CodeSystemFactoryProvider} = require('./cs-api');
const assert = require('assert');
const { CodeSystem } = require("../library/codesystem");

class MimeTypeConcept {
  constructor(code) {
    this.code = code;
    this.mimeType = this.#parseMimeType(code);
  }

  #parseMimeType(code) {
    // Basic MIME type parsing - type/subtype with optional parameters
    const trimmed = code.trim();
    const parts = trimmed.split(';')[0].trim(); // Remove parameters for validation
    const typeParts = parts.split('/');

    if (typeParts.length === 2 && typeParts[0] && typeParts[1]) {
      return {
        type: typeParts[0],
        subtype: typeParts[1],
        isValid: true,
        source: trimmed
      };
    }

    return {
      type: '',
      subtype: '',
      isValid: false,
      source: trimmed
    };
  }

  isValid() {
    return this.mimeType.isValid && this.mimeType.subtype !== '';
  }
}

class MimeTypeServices extends CodeSystemProvider {
  constructor(opContext, supplements) {
    super(opContext, supplements);
  }

  // Metadata methods
  system() {
    return 'urn:ietf:bcp:13'; // BCP 13 defines MIME types
  }

  version() {
    return null;
  }

  description() {
    return 'Mime Types';
  }

  totalCount() {
    return -1; // Not bounded - infinite possible MIME types
  }

  hasParents() {
    return false; // No hierarchical relationships
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }
    return false; // MIME types don't have displays by default
  }

  // Core concept methods
  async code(code) {
    
    const ctxt = await this.#ensureContext(code);
    return ctxt ? ctxt.code : null;
  }

  async display(code) {
    
    const ctxt = await this.#ensureContext(code);
    if (!ctxt) {
      return null;
    }

    // Check supplements first
    const suppDisplay = this._displayFromSupplements(ctxt.code);
    if (suppDisplay) {
      return suppDisplay;
    }

    // Default display is the code itself, trimmed
    return ctxt.code.trim();
  }

  async definition(code) {
    
    await this.#ensureContext(code);
    return null; // No definitions provided
  }

  async isAbstract(code) {
    
    await this.#ensureContext(code);
    return false; // MIME types are not abstract
  }

  async isInactive(code) {
    
    await this.#ensureContext(code);
    return false; // MIME types are not inactive
  }

  async isDeprecated(code) {
    
    await this.#ensureContext(code);
    return false; // MIME types are not deprecated
  }

  async designations(code) {
    
    const ctxt = await this.#ensureContext(code);
    const designations = [];
    if (ctxt != null) {
      const display = await this.display(ctxt);
      if (display) {
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), display));
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
    if (code instanceof MimeTypeConcept) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // Lookup methods
  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const concept = new MimeTypeConcept(code);
    if (concept.isValid()) {
      return { context: concept, message: null };
    }

    return { context: null, message: `Invalid MIME type '${code}'` };
  }

  // Subsumption - not supported
  async subsumesTest(codeA, codeB) {

    await this.#ensureContext(codeA);
    await this.#ensureContext(codeB);
    return false; // No subsumption relationships
  }

  async locateIsA(code, parent) {
    await this.#ensureContext(code);
    await this.#ensureContext(parent);
    return { context: null, message: 'Subsumption not supported for MIME types' };
  }
}

class MimeTypeServicesFactory extends CodeSystemFactoryProvider {
  constructor() {
    super();
    this.uses = 0;
  }

  defaultVersion() {
    return null;
  }

  system() {
    return 'urn:ietf:bcp:13'; // BCP 13 defines MIME types
  }

  version() {
    return null;
  }

  build(opContext, supplements) {
    this.uses++;
    return new MimeTypeServices(opContext, supplements);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }
}

module.exports = {
  MimeTypeServices,
  MimeTypeServicesFactory,
  MimeTypeConcept
};