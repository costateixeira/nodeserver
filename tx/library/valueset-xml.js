/**
 * XML support for FHIR ValueSet resources
 * Handles conversion between FHIR XML format and ValueSet objects
 */
import {XMLBuilder} from "fast-xml-parser";

const { XMLParser } = require('fast-xml-parser');
import { ValueSet } from './ValueSet.js';

/**
 * XML support for FHIR ValueSet resources
 * @class
 */
export class ValueSetXML {

  /**
   * FHIR ValueSet elements that should be arrays in JSON
   * @type {Set<string>}
   * @private
   */
  static _arrayElements = new Set([
    'identifier',      // Array of identifiers (always array for ValueSet)
    'contact',         // Array of contact details
    'useContext',      // Array of usage contexts
    'jurisdiction',    // Array of jurisdictions
    'include',         // Array of compose includes
    'exclude',         // Array of compose excludes
    'concept',         // Array of concepts (within include/exclude)
    'filter',          // Array of filters (within include/exclude)
    'valueSet',        // Array of value sets (within include)
    'parameter',       // Array of expansion parameters
    'contains',        // Array of expansion contains items
    'designation',     // Array of designations (within expansion contains)
    'extension',       // Array of extensions
    'modifierExtension' // Array of modifier extensions
  ]);

  /**
   * Creates ValueSet from FHIR XML string
   * @param {string} xmlString - FHIR XML representation of ValueSet
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {ValueSet} New ValueSet instance
   */
  static fromXML(xmlString, version = 'R5') {
    // Parse XML to JSON using FHIR-aware configuration
    const jsonObj = this._xmlToJson(xmlString);

    // Use existing ValueSet constructor with version conversion
    return new ValueSet(jsonObj, version);
  }

  /**
   * Converts ValueSet to FHIR XML string
   * @param {ValueSet} valueSet - ValueSet instance
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} FHIR XML string
   */
  static toXMLString(valueSet, version = 'R5') {
    // Get JSON in target version using existing version conversion
    const jsonString = valueSet.toJSONString(version);
    const jsonObj = JSON.parse(jsonString);

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
      attributeNamePrefix: '',
      textNodeName: 'value', // FHIR puts primitive values in 'value' attribute
      parseAttributeValue: true,
      removeNSPrefix: true, // Remove namespace prefixes
      isArray: (tagName, jPath) => {
        // Check if this element should be an array based on FHIR rules
        return this._shouldBeArray(tagName, jPath);
      },
      transformAttributeName: (attrName) => {
        // Handle FHIR attribute naming
        if (attrName === 'value') return 'value';
        return attrName;
      }
    };

    const parser = new XMLParser(parserOptions);
    const result = parser.parse(xmlString);

    // Extract the ValueSet root element and process FHIR-specific structures
    const valueSet = result.ValueSet || result;
    return this._processFhirStructure(valueSet);
  }

  /**
   * Converts JSON object to FHIR XML
   * @param {Object} jsonObj - JSON representation
   * @param {string} version - FHIR version for XML namespace
   * @returns {string} FHIR XML string
   * @private
   */
  static _jsonToXml(jsonObj, version = 'R5') {
    // Prepare object for XML conversion (handle FHIR-specific structures)
    const xmlReadyObj = this._prepareForXml(jsonObj);

    // Fast-xml-parser builder configuration for FHIR
    const builderOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: '',
      textNodeName: 'value',
      format: true,
      indentBy: '  ',
      rootNodeName: 'ValueSet',
      xmlns: this._getFhirNamespace(version),
      arrayNodeName: (tagName) => {
        // For arrays, use the singular form as the repeated element name
        return this._getArrayElementName(tagName);
      }
    };

    const builder = new XMLBuilder(builderOptions);

    // Wrap in ValueSet root with proper namespace
    const rootObj = {
      ValueSet: {
        '@xmlns': this._getFhirNamespace(version),
        ...xmlReadyObj
      }
    };

    return builder.build(rootObj);
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
    if (tagName === 'concept' && (jPath.includes('include') || jPath.includes('exclude'))) {
      // Concepts within include/exclude are arrays
      return true;
    }

    if (tagName === 'filter' && (jPath.includes('include') || jPath.includes('exclude'))) {
      // Filters within include/exclude are arrays
      return true;
    }

    if (tagName === 'contains' && jPath.includes('expansion')) {
      // Contains within expansion are arrays
      return true;
    }

    if (tagName === 'parameter' && jPath.includes('expansion')) {
      // Parameters within expansion are arrays
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
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        // FHIR primitive - wrap in object with 'value' attribute for XML
        prepared[key] = { '@value': value };
      } else if (Array.isArray(value)) {
        // Array - process elements
        prepared[key] = value.map(item => this._prepareForXml(item));
      } else if (typeof value === 'object' && value !== null) {
        // Complex object - recurse
        prepared[key] = this._prepareForXml(value);
      } else {
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
      'includes': 'include',
      'excludes': 'exclude',
      'concepts': 'concept',
      'filters': 'filter',
      'valueSets': 'valueSet',
      'parameters': 'parameter',
      'contains': 'contains', // Same singular/plural
      'designations': 'designation',
      'extensions': 'extension',
      'modifierExtensions': 'modifierExtension'
    };

    return singularMap[arrayName] || arrayName.replace(/s$/, '');
  }

  /**
   * Validates that XML string is a FHIR ValueSet
   * @param {string} xmlString - XML string to validate
   * @returns {boolean} True if valid FHIR ValueSet XML
   */
  static isValidValueSetXML(xmlString) {
    try {
      // Basic check for ValueSet root element and namespace
      return xmlString.includes('<ValueSet') &&
        xmlString.includes('http://hl7.org/fhir') &&
        xmlString.includes('</ValueSet>');
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
      version: '4.x', // Would be dynamic in real implementation
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

// Usage examples:
/*
// Load from XML
const valueSet = ValueSetXML.fromXML(xmlString, 'R4');

// Convert to different version XML
const r3Xml = ValueSetXML.toXMLString(valueSet, 'R3');

// Validate XML
if (ValueSetXML.isValidValueSetXML(xmlString)) {
  const vs = ValueSetXML.fromXML(xmlString);
}

// Check expansion codes
if (valueSet.hasCode('http://loinc.org', 'LA6113-0')) {
  const codeItem = valueSet.getCode('http://loinc.org', 'LA6113-0');
  console.log(codeItem.display);
}
*/