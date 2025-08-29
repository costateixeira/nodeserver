const { CodeSystemProvider, Designation, CodeSystemFactoryProvider} = require('./cs-api');
const assert = require('assert');
const { CodeSystem } = require("../library/codesystem");

class USStateConcept {
  constructor(code, display) {
    this.code = code;
    this.display = display;
  }
}

class USStateServices extends CodeSystemProvider {
  constructor(opContext, supplements, codes, codeMap) {
    super(opContext, supplements);
    this.codes = codes || [];
    this.codeMap = codeMap || new Map();
  }

  // Metadata methods
  system() {
    return 'https://www.usps.com/';
  }

  version() {
    return null; // No version specified
  }

  description() {
    return 'US State Codes';
  }

  totalCount() {
    return this.codes.length;
  }

  hasParents() {
    return false; // No hierarchical relationships
  }

  hasAnyDisplays(languages) {
    const langs = this._ensureLanguages(languages);
    if (this._hasAnySupplementDisplays(langs)) {
      return true;
    }
    return super.hasAnyDisplays(langs);
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
    if (ctxt.display && this.opContext.langs.isEnglishOrNothing()) {
      return ctxt.display.trim();
    }
    let disp = this._displayFromSupplements(ctxt.code);
    if (disp) {
      return disp;
    }
    return ctxt.display ? ctxt.display.trim() : '';
  }

  async definition(code) {
    
    await this.#ensureContext(code);
    return null; // No definitions provided
  }

  async isAbstract(code) {
    
    await this.#ensureContext(code);
    return false; // No abstract concepts
  }

  async isInactive(code) {
    
    await this.#ensureContext(code);
    return false; // No inactive concepts
  }

  async isDeprecated(code) {
    
    await this.#ensureContext(code);
    return false; // No deprecated concepts
  }

  async designations(code) {
    
    const ctxt = await this.#ensureContext(code);
    let designations = [];
    if (ctxt != null) {
      designations.push(new Designation('en', CodeSystem.makeUseForDisplay(), ctxt.display));
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
    if (code instanceof USStateConcept) {
      return code;
    }
    throw new Error("Unknown Type at #ensureContext: " + (typeof code));
  }

  // Lookup methods
  async locate(code) {
    
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    const concept = this.codeMap.get(code);
    if (concept) {
      return { context: concept, message: null };
    }
    return { context: null, message: `US State Code '${code}' not found` };
  }

  // Iterator methods
  async iterator(code) {
    
    const ctxt = await this.#ensureContext(code);
    if (!ctxt) {
      return { index: 0, total: this.totalCount() };
    }
    return null; // No child iteration
  }

  async nextContext(iteratorContext) {
    
    assert(iteratorContext, 'iteratorContext must be provided');
    if (iteratorContext && iteratorContext.index < iteratorContext.total) {
      const concept = this.codes[iteratorContext.index];
      iteratorContext.index++;
      return concept;
    }
    return null;
  }

  // Subsumption
  async subsumesTest(codeA, codeB) {
    await this.#ensureContext(codeA);
    await this.#ensureContext(codeB);
    return false; // No subsumption relationships
  }
}

class USStateFactoryProvider extends CodeSystemFactoryProvider {
  constructor() {
    super();
    this.uses = 0;
    this.codes = null;
    this.codeMap = null;
  }

  defaultVersion() {
    return null; // No versioning for US states
  }

  build(opContext, supplements) {
    this.uses++;
    return new USStateServices(opContext, supplements, this.codes, this.codeMap);
  }

  useCount() {
    return this.uses;
  }

  recordUse() {
    this.uses++;
  }


  system() {
    return 'https://www.usps.com/';
  }

  version() {
    return null; // No version specified
  }

  async load() {
    this.codes = [];
    this.codeMap = new Map();

    const data = [
      ['AL', 'Alabama'],
      ['AK', 'Alaska'],
      ['AS', 'American Samoa'],
      ['AZ', 'Arizona'],
      ['AR', 'Arkansas'],
      ['CA', 'California'],
      ['CO', 'Colorado'],
      ['CT', 'Connecticut'],
      ['DE', 'Delaware'],
      ['DC', 'District of Columbia'],
      ['FM', 'Federated States of Micronesia'],
      ['FL', 'Florida'],
      ['GA', 'Georgia'],
      ['GU', 'Guam'],
      ['HI', 'Hawaii'],
      ['ID', 'Idaho'],
      ['IL', 'Illinois'],
      ['IN', 'Indiana'],
      ['IA', 'Iowa'],
      ['KS', 'Kansas'],
      ['KY', 'Kentucky'],
      ['LA', 'Louisiana'],
      ['ME', 'Maine'],
      ['MH', 'Marshall Islands'],
      ['MD', 'Maryland'],
      ['MA', 'Massachusetts'],
      ['MI', 'Michigan'],
      ['MN', 'Minnesota'],
      ['MS', 'Mississippi'],
      ['MO', 'Missouri'],
      ['MT', 'Montana'],
      ['NE', 'Nebraska'],
      ['NV', 'Nevada'],
      ['NH', 'New Hampshire'],
      ['NJ', 'New Jersey'],
      ['NM', 'New Mexico'],
      ['NY', 'New York'],
      ['NC', 'North Carolina'],
      ['ND', 'North Dakota'],
      ['MP', 'Northern Mariana Islands'],
      ['OH', 'Ohio'],
      ['OK', 'Oklahoma'],
      ['OR', 'Oregon'],
      ['PW', 'Palau'],
      ['PA', 'Pennsylvania'],
      ['PR', 'Puerto Rico'],
      ['RI', 'Rhode Island'],
      ['SC', 'South Carolina'],
      ['SD', 'South Dakota'],
      ['TN', 'Tennessee'],
      ['TX', 'Texas'],
      ['UT', 'Utah'],
      ['VT', 'Vermont'],
      ['VI', 'Virgin Islands'],
      ['VA', 'Virginia'],
      ['WA', 'Washington'],
      ['WV', 'West Virginia'],
      ['WI', 'Wisconsin'],
      ['WY', 'Wyoming'],
      ['AE', 'Armed Forces Europe, the Middle East, and Canada'],
      ['AP', 'Armed Forces Pacific'],
      ['AA', 'Armed Forces Americas (except Canada)']
    ];

    // Load concepts into arrays and map
    for (const [code, display] of data) {
      const concept = new USStateConcept(code, display);
      this.codes.push(concept);
      this.codeMap.set(code, concept);
    }
  }
}

module.exports = {
  USStateServices,
  USStateFactoryProvider,
  USStateConcept
};