const assert = require('assert');
const https = require('https');
const { CodeSystemProvider, Designation, CodeSystemFactoryProvider } = require('./cs-api');

class HGVSCode {
  constructor(code) {
    this.code = code;
  }
}

class HGVSServices extends CodeSystemProvider {
  constructor(supplements) {
    super(supplements);
  }

  // Metadata methods
  system() {
    return 'http://varnomen.hgvs.org';
  }

  async version() {
    return '2.0';
  }

  description() {
    return 'HGVS codes';
  }

  async totalCount() {
    return 0; // No enumerable codes
  }

  specialEnumeration() {
    return null;
  }

  defaultToLatest() {
    return true;
  }

  defToThisVersion(specifiedVersion) {
    return true;
  }

  // Core concept methods
  async code(opContext, context) {
    this._ensureOpContext(opContext);
    if (context instanceof HGVSCode) {
      return context.code;
    }
    return null;
  }

  async display(opContext, context) {
    this._ensureOpContext(opContext);
    return this.code(opContext, context);
  }

  async definition(opContext, context) {
    this._ensureOpContext(opContext);
    return '';
  }

  async isAbstract(opContext, context) {
    this._ensureOpContext(opContext);
    return false;
  }

  async isInactive(opContext, context) {
    this._ensureOpContext(opContext);
    return false;
  }

  async isDeprecated(opContext, context) {
    this._ensureOpContext(opContext);
    return false;
  }

  async designations(opContext, context) {
    this._ensureOpContext(opContext);
    const designations = [];

    if (context instanceof HGVSCode) {
      designations.push(new Designation('', null, context.code));

      // Add supplement designations
      designations.push(...this._listSupplementDesignations(context.code));
    }

    return designations;
  }

  async extendLookup(opContext, ctxt, props, params) {
    this._ensureOpContext(opContext);
    // No additional properties to add for HGVS codes
  }

  // Lookup methods - this is the main functionality
  async locate(opContext, code) {
    this._ensureOpContext(opContext);
    assert(code == null || typeof code === 'string', 'code must be string');
    if (!code) return { context: null, message: 'Empty code' };

    try {
      const result = await this.#validateHGVSCode(code);

      if (result.valid) {
        return {
          context: new HGVSCode(code),
          message: null
        };
      } else {
        return {
          context: null,
          message: result.message || `HGVS code '${code}' is not valid`
        };
      }
    } catch (error) {
      throw new Error(`Error validating HGVS code: ${error.message}`);
    }
  }

  async #validateHGVSCode(code) {
    return new Promise((resolve, reject) => {
      const url = `https://clinicaltables.nlm.nih.gov/fhir/R4/CodeSystem/hgvs/$validate-code?code=${encodeURIComponent(code)}`;

      const request = https.get(url, { timeout: 5000 }, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            let valid = false;
            let message = '';

            // Parse the FHIR Parameters response
            if (json.parameter && Array.isArray(json.parameter)) {
              for (const param of json.parameter) {
                if (param.name === 'result' && param.valueBoolean) {
                  valid = true;
                } else if (param.name === 'message' && param.valueString) {
                  if (message) message += ', ';
                  message += param.valueString;
                }
              }
            }

            resolve({ valid, message });
          } catch (parseError) {
            reject(new Error(`Error parsing HGVS response: ${parseError.message}`));
          }
        });
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('HGVS validation request timed out'));
      });

      request.on('error', (error) => {
        reject(new Error(`HGVS validation request failed: ${error.message}`));
      });
    });
  }

  async locateIsA(opContext, code, parent, disallowParent = false) {
    this._ensureOpContext(opContext);
    return null; // No hierarchy support
  }

  // Iterator methods - not supported
  async iterator(opContext, context) {
    this._ensureOpContext(opContext);
    // Return empty iterator
    return {
      total: 0,
      current: 0,
      more: () => false,
      next: () => this.current++
    };
  }

  async nextContext(opContext, iteratorContext) {
    this._ensureOpContext(opContext);
    iteratorContext.next();
    return null;
  }

  // Filter support - not supported
  async doesFilter(opContext, prop, op, value) {
    this._ensureOpContext(opContext);
    return false;
  }

  async getPrepContext(opContext, iterate) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async searchFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async specialFilter(opContext, filterContext, filter, sort) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filter(opContext, filterContext, prop, op, value) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async prepare(opContext, filterContext) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async executeFilters(opContext, filterContext) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterSize(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterMore(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterConcept(opContext, filterContext, set) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterLocate(opContext, filterContext, set, code) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterCheck(opContext, filterContext, set, concept) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filterFinish(opContext, filterContext) {
    this._ensureOpContext(opContext);
    throw new Error('Filters are not supported for HGVS');
  }

  async filtersNotClosed(opContext, filterContext) {
    this._ensureOpContext(opContext);
    return false;
  }

  // Subsumption testing - not supported
  async subsumesTest(opContext, codeA, codeB) {
    this._ensureOpContext(opContext);
    throw new Error('Subsumption is not supported for HGVS');
  }

  // Other methods
  async getCDSInfo(opContext, card, langList, baseURL, code, display) {
    this._ensureOpContext(opContext);
    // No CDS info for HGVS
  }

  async defineFeatures(opContext, features) {
    this._ensureOpContext(opContext);
    // No special features
  }
}

class HGVSServicesFactory extends CodeSystemFactoryProvider {
  constructor() {
    super();
    this.uses = 0;
  }

  defaultVersion() {
    return '2.0';
  }

  async build(opContext, supplements) {
    this.recordUse();
    return new HGVSServices(supplements);
  }

  static checkService() {
    // Simple check - just return that it's available
    // In practice, you might want to test the external service
    return 'OK (External validation service)';
  }
}

module.exports = {
  HGVSServices,
  HGVSServicesFactory,
  HGVSCode
};