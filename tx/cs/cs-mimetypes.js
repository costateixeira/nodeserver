const { CodeSystemProvider, TxOperationContext, Designation, FilterExecutionContext } = require('./cs-api');
const assert = require('assert');
const CodeSystem = require("../library/codesystem");

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
  constructor(supplements) {
    super(supplements);
  }

  // Metadata methods
  system() {
    return 'urn:ietf:bcp:13'; // BCP 13 defines MIME types
  }

  version() {
    return '';
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
  async code(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return ctxt ? ctxt.code : null;
  }

  async display(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    if (!ctxt) {
      return null;
    }

    // Check supplements first
    const suppDisplay = this._displayFromSupplements(opContext, ctxt.code);
    if (suppDisplay) {
      return suppDisplay;
    }

    // Default display is the code itself, trimmed
    return ctxt.code.trim();
  }

  async definition(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return null; // No definitions provided
  }

  async isAbstract(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // MIME types are not abstract
  }

  async isInactive(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // MIME types are not inactive
  }

  async isDeprecated(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    return false; // MIME types are not deprecated
  }

  async designations(opContext, code) {
    this._ensureOpContext(opContext);
    const ctxt = await this.#ensureContext(opContext, code);
    const designations = [];
    if (ctxt != null) {
      const display = await this.display(opContext, ctxt);
      if (display) {
        designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), display));
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
    if (code instanceof MimeTypeConcept) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // Lookup methods
  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const concept = new MimeTypeConcept(code);
    if (concept.isValid()) {
      return { context: concept, message: null };
    }

    return { context: null, message: `Invalid MIME type '${code}'` };
  }

  // Subsumption - not supported
  async subsumesTest(opContext, codeA, codeB) {
    this._ensureOpContext(opContext);
    return false; // No subsumption relationships
  }

  async locateIsA(opContext, code, parent) {
    this._ensureOpContext(opContext);
    return { context: null, message: 'Subsumption not supported for MIME types' };
  }
}

class MimeTypeServicesFactory {
  constructor() {
    this.uses = 0;
  }

  defaultVersion() {
    return '';
  }

  build(opContext, supplements) {
    this.uses++;
    return new MimeTypeServices(supplements);
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