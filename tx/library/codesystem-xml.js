/**
 * XML support for FHIR CodeSystem resources
 * Handles conversion between FHIR XML format and CodeSystem objects
 */

// Import the XMLParser and XMLBuilder from fast-xml-parser
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { CodeSystem } = require('./codesystem');

/**
 * XML support for FHIR CodeSystem resources
 * @class
 */
class CodeSystemXML {

  /**
   * FHIR CodeSystem elements that should be arrays in JSON
   * @type {Set<string>}
   * @private
   */
  static _arrayElements = new Set([
    'identifier',      // R4+: array of identifiers
    'contact',         // Array of contact details
    'useContext',      // Array of usage contexts
    'jurisdiction',    // Array of jurisdictions
    'concept',         // Array of concept definitions
    'filter',          // Array of filters
    'operator',        // Array of filter operators (within filter)
    'property',        // Array of property definitions
    'designation',     // Array of designations (within concepts)
    'extension',       // Array of extensions
    'modifierExtension' // Array of modifier extensions
  ]);

  /**
   * Creates CodeSystem from FHIR XML string
   * @param {string} xmlString - FHIR XML representation of CodeSystem
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {CodeSystem} New CodeSystem instance
   */
  static fromXML(xmlString, version = 'R5') {
    // Parse XML to JSON using FHIR-aware configuration
    const jsonObj = this._xmlToJson(xmlString);

    // Use existing CodeSystem constructor with version conversion
    return new CodeSystem(jsonObj, version);
  }

  /**
   * Converts CodeSystem to FHIR XML string
   * @param {CodeSystem} codeSystem - CodeSystem instance
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} FHIR XML string
   */
  static toXMLString(codeSystem, version = 'R5') {
    // Get JSON in target version using existing version conversion
    const jsonString = codeSystem.toJSONString(version);
    let jsonObj = JSON.parse(jsonString);

    // Special handling for R3 format (identifier needs to be a single object)
    if (version === 'R3' && jsonObj.identifier && !Array.isArray(jsonObj.identifier)) {
      // Already converted to R3 format with single identifier
    } else if (version === 'R3' && jsonObj.identifier && Array.isArray(jsonObj.identifier) && jsonObj.identifier.length > 0) {
      // Need to ensure identifier is a single object for R3 XML
      jsonObj.identifier = jsonObj.identifier[0];
    }

    // Convert JSON to FHIR XML format
    return this._jsonToXml(jsonObj, version);
  }

  /**
   * Converts FHIR XML to JSON object
   * @param {string} xmlString - FHIR XML string
   * @returns {Object} JSON representation
   * @private
   */
  static _xmlToJson(xmlString) {
    // Fast-xml-parser configuration for FHIR
    const parserOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      attributesGroupName: false,
      textNodeName: '#text',
      isArray: (name, path, isLeaf, isAttribute) => {
        // These elements should always be arrays even if there's only one
        return this._arrayElements.has(name);
      },
      parseAttributeValue: true,
      parseTagValue: false,
      trimValues: true,
      cdataPropName: '__cdata',
      numberParseOptions: {
        leadingZeros: false,
        hex: true,
        skipLike: /^[-+]?0\d+/
      }
    };

    const parser = new XMLParser(parserOptions);
    const parsed = parser.parse(xmlString);

    // Get the CodeSystem element
    const codeSystem = parsed.CodeSystem;
    if (!codeSystem) {
      throw new Error('Invalid XML: Missing CodeSystem element');
    }

    // Convert to FHIR JSON format
    return this._convertXmlToFhirJson(codeSystem);
  }

  /**
   * Converts XML parser output to FHIR JSON format
   * @param {Object} xmlObj - XML parser output
   * @returns {Object} FHIR JSON object
   * @private
   */
  static _convertXmlToFhirJson(xmlObj) {
    const result = { resourceType: 'CodeSystem' };

    // Process each property
    for (const [key, value] of Object.entries(xmlObj)) {
      // Skip attributes and namespace
      if (key === '@_xmlns' || key.startsWith('@_')) continue;

      if (key === 'identifier') {
        // Handle identifier array
        result.identifier = this._processIdentifiers(value);
      } else if (key === 'filter') {
        // Handle filter array
        result.filter = this._processFilters(value);
      } else if (key === 'concept') {
        // Handle concept array
        result.concept = this._processConcepts(value);
      } else if (typeof value === 'object' && value !== null && value['@_value'] !== undefined) {
        // Handle primitive with value attribute
        result[key] = value['@_value'];
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        // Handle complex objects
        result[key] = this._processComplexObject(value);
      } else {
        // Default handling
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Process identifier elements from XML
   * @param {Object|Array} identifiers - XML parser output for identifiers
   * @returns {Array} Array of identifier objects
   * @private
   */
  static _processIdentifiers(identifiers) {
    // Ensure we have an array
    const idArray = Array.isArray(identifiers) ? identifiers : [identifiers];

    return idArray.map(id => {
      const result = {};

      // Process system
      if (id.system && id.system['@_value']) {
        result.system = id.system['@_value'];
      }

      // Process value
      if (id.value && id.value['@_value']) {
        result.value = id.value['@_value'];
      }

      return result;
    });
  }

  /**
   * Process filter elements from XML
   * @param {Object|Array} filters - XML parser output for filters
   * @returns {Array} Array of filter objects
   * @private
   */
  static _processFilters(filters) {
    // Ensure we have an array
    const filterArray = Array.isArray(filters) ? filters : [filters];

    return filterArray.map(filter => {
      const result = {};

      // Process code
      if (filter.code && filter.code['@_value']) {
        result.code = filter.code['@_value'];
      }

      // Process operators
      if (filter.operator) {
        const operators = Array.isArray(filter.operator) ? filter.operator : [filter.operator];
        result.operator = operators.map(op => op['@_value']);
      }

      // Process value
      if (filter.value && filter.value['@_value']) {
        result.value = filter.value['@_value'];
      }

      return result;
    });
  }

  /**
   * Process concept elements from XML
   * @param {Object|Array} concepts - XML parser output for concepts
   * @returns {Array} Array of concept objects
   * @private
   */
  static _processConcepts(concepts) {
    // Ensure we have an array
    const conceptArray = Array.isArray(concepts) ? concepts : [concepts];

    return conceptArray.map(concept => {
      const result = {};

      // Process code
      if (concept.code && concept.code['@_value']) {
        result.code = concept.code['@_value'];
      }

      // Process display
      if (concept.display && concept.display['@_value']) {
        result.display = concept.display['@_value'];
      }

      // Process nested concepts
      if (concept.concept) {
        result.concept = this._processConcepts(concept.concept);
      }

      // Process properties
      if (concept.property) {
        result.property = this._processProperties(concept.property);
      }

      return result;
    });
  }

  /**
   * Process property elements from XML
   * @param {Object|Array} properties - XML parser output for properties
   * @returns {Array} Array of property objects
   * @private
   */
  static _processProperties(properties) {
    // Ensure we have an array
    const propArray = Array.isArray(properties) ? properties : [properties];

    return propArray.map(prop => {
      const result = {};

      // Process code
      if (prop.code && prop.code['@_value']) {
        result.code = prop.code['@_value'];
      }

      // Process valueCode
      if (prop.valueCode && prop.valueCode['@_value']) {
        result.valueCode = prop.valueCode['@_value'];
      }

      return result;
    });
  }

  /**
   * Process complex object from XML
   * @param {Object} obj - XML parser output for complex object
   * @returns {Object} Processed object
   * @private
   */
  static _processComplexObject(obj) {
    const result = {};

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('@_')) continue;

      if (typeof value === 'object' && value !== null && value['@_value'] !== undefined) {
        result[key] = value['@_value'];
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this._processComplexObject(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Converts JSON object to FHIR XML
   * @param {Object} jsonObj - JSON representation
   * @param {string} version - FHIR version for XML namespace
   * @returns {string} FHIR XML string
   * @private
   */
  static _jsonToXml(jsonObj, version = 'R5') {
    // Generate XML manually to have full control over the format
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += `<CodeSystem xmlns="${this._getFhirNamespace(version)}">\n`;

    // Add each property as XML elements
    xml += this._generateXmlElements(jsonObj, 2); // 2 spaces indentation

    xml += '</CodeSystem>';
    return xml;
  }

  /**
   * Recursively generates XML elements from JSON
   * @param {Object} obj - JSON object to convert
   * @param {number} indent - Number of spaces for indentation
   * @returns {string} XML elements
   * @private
   */
  static _generateXmlElements(obj, indent) {
    if (!obj || typeof obj !== 'object') return '';

    const spaces = ' '.repeat(indent);
    let xml = '';

    // Iterate through all properties
    for (const [key, value] of Object.entries(obj)) {
      // Skip resourceType as it's represented by the root element
      if (key === 'resourceType') continue;

      if (Array.isArray(value)) {
        // Handle arrays by creating multiple elements with the same name
        for (const item of value) {
          if (typeof item === 'object') {
            // Complex object array element
            xml += `${spaces}<${key}>\n`;
            xml += this._generateXmlElements(item, indent + 2);
            xml += `${spaces}</${key}>\n`;
          } else {
            // Simple value array element
            xml += `${spaces}<${key} value="${this._escapeXml(item)}"/>\n`;
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // Handle complex object
        xml += `${spaces}<${key}>\n`;
        xml += this._generateXmlElements(value, indent + 2);
        xml += `${spaces}</${key}>\n`;
      } else if (value !== undefined && value !== null) {
        // Handle primitive values
        xml += `${spaces}<${key} value="${this._escapeXml(value)}"/>\n`;
      }
    }

    return xml;
  }

  /**
   * Escapes special characters in XML
   * @param {string|number|boolean} value - Value to escape
   * @returns {string} Escaped XML string
   * @private
   */
  static _escapeXml(value) {
    if (value === undefined || value === null) return '';

    const str = String(value);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Determines if an XML element should be converted to an array in JSON
   * @param {string} tagName - XML element name
   * @param {string} jPath - JSON path context
   * @returns {boolean} True if should be array
   * @private
   */
  static _shouldBeArray(tagName, jPath) {
    // Check if this is a known FHIR array element
    if (this._arrayElements.has(tagName)) {
      return true;
    }

    // Special cases based on context
    if (tagName === 'concept' && jPath.includes('concept')) {
      // Nested concepts are arrays
      return true;
    }

    if (tagName === 'property' && jPath.includes('concept')) {
      // Properties within concepts are arrays
      return true;
    }

    if (tagName === 'operator' && jPath.includes('filter')) {
      // Operators within filters are arrays
      return true;
    }

    return false;
  }

  /**
   * Processes FHIR-specific JSON structure after XML parsing
   * @param {Object} obj - Parsed object from XML
   * @returns {Object} FHIR-compliant JSON object
   * @private
   */
  static _processFhirStructure(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const processed = {};

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith('@')) {
        // Skip XML attributes that aren't FHIR data
        continue;
      }

      if (Array.isArray(value)) {
        // Process array elements
        processed[key] = value.map(item => this._processFhirStructure(item));
      } else if (typeof value === 'object' && value !== null) {
        // Handle FHIR primitive types with 'value' attribute
        if (value.value !== undefined && Object.keys(value).length === 1) {
          // This is a FHIR primitive - extract the value
          processed[key] = value.value;
        } else {
          // Complex object - recurse
          processed[key] = this._processFhirStructure(value);
        }
      } else {
        // Simple value
        processed[key] = value;
      }
    }

    // Add resourceType if missing
    if (!processed.resourceType) {
      processed.resourceType = 'CodeSystem';
    }

    return processed;
  }

  /**
   * Prepares JSON object for XML conversion (handles FHIR primitives)
   * @param {Object} obj - JSON object
   * @returns {Object} XML-ready object
   * @private
   */
  static _prepareForXml(obj) {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this._prepareForXml(item));
    }

    const prepared = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip resourceType
      if (key === 'resourceType') continue;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        // FHIR primitive - wrap in object with 'value' attribute for XML
        prepared[key] = { '@value': value.toString() };
      } else if (Array.isArray(value)) {
        // Handle arrays - create multiple elements with the same name
        if (value.length > 0) {
          prepared[key] = value.map(item => this._prepareForXml(item));
        }
      } else if (typeof value === 'object' && value !== null) {
        // Complex object - recurse
        prepared[key] = this._prepareForXml(value);
      } else if (value !== undefined && value !== null) {
        prepared[key] = value;
      }
    }

    return prepared;
  }

  /**
   * Gets FHIR namespace for XML based on version
   * @param {string} version - FHIR version
   * @returns {string} FHIR namespace URL
   * @private
   */
  static _getFhirNamespace(version) {
    const namespaces = {
      'R3': 'http://hl7.org/fhir',
      'R4': 'http://hl7.org/fhir',
      'R5': 'http://hl7.org/fhir'
    };
    return namespaces[version] || namespaces['R5'];
  }

  /**
   * Gets the element name for array items in XML
   * @param {string} arrayName - Array property name
   * @returns {string} Element name for array items
   * @private
   */
  static _getArrayElementName(arrayName) {
    // Most FHIR arrays use singular element names
    const singularMap = {
      'identifiers': 'identifier',
      'contacts': 'contact',
      'useContexts': 'useContext',
      'jurisdictions': 'jurisdiction',
      'concepts': 'concept',
      'filters': 'filter',
      'operators': 'operator',
      'properties': 'property',
      'designations': 'designation',
      'extensions': 'extension',
      'modifierExtensions': 'modifierExtension'
    };

    return singularMap[arrayName] || arrayName.replace(/s$/, '');
  }

  /**
   * Validates that XML string is a FHIR CodeSystem
   * @param {string} xmlString - XML string to validate
   * @returns {boolean} True if valid FHIR CodeSystem XML
   */
  static isValidCodeSystemXML(xmlString) {
    try {
      // More precise check using regular expressions
      const rootElementRegex = /<CodeSystem\s+[^>]*xmlns\s*=\s*["']http:\/\/hl7\.org\/fhir["'][^>]*>/;
      const closingTagRegex = /<\/CodeSystem>/;

      return rootElementRegex.test(xmlString) && closingTagRegex.test(xmlString);
    } catch (error) {
      return false;
    }
  }

  /**
   * Gets XML parser/builder library info for debugging
   * @returns {Object} Library information
   */
  static getLibraryInfo() {
    return {
      library: 'fast-xml-parser',
      features: [
        'High performance XML parsing',
        'Configurable array detection',
        'FHIR attribute handling',
        'Namespace support',
        'Bidirectional conversion'
      ]
    };
  }
}

module.exports = CodeSystemXML;