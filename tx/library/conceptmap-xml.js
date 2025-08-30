/**
 * XML support for FHIR ConceptMap resources
 * Handles conversion between FHIR XML format and ConceptMap objects
 */

import { ConceptMap } from './ConceptMap.js';
import {XMLBuilder, XMLParser} from "fast-xml-parser";

/**
 * XML support for FHIR ConceptMap resources
 * @class
 */
export class ConceptMapXML {

  /**
   * FHIR ConceptMap elements that should be arrays in JSON
   * @type {Set<string>}
   * @private
   */
  static _arrayElements = new Set([
    'identifier',      // Array in R5, single in R3/R4
    'contact',         // Array of contact details
    'useContext',      // Array of usage contexts
    'jurisdiction',    // Array of jurisdictions
    'group',           // Array of mapping groups
    'element',         // Array of elements (within group)
    'target',          // Array of targets (within element)
    'property',        // Array of properties (R5 only)
    'additionalAttribute', // Array of additional attributes (R5 only)
    'extension',       // Array of extensions
    'modifierExtension' // Array of modifier extensions
  ]);

  /**
   * Creates ConceptMap from FHIR XML string
   * @param {string} xmlString - FHIR XML representation of ConceptMap
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {ConceptMap} New ConceptMap instance
   */
  static fromXML(xmlString, version = 'R5') {
    // Parse XML to JSON using FHIR-aware configuration
    const jsonObj = this._xmlToJson(xmlString);

    // Use existing ConceptMap constructor with version conversion
    return new ConceptMap(jsonObj, version);
  }

  /**
   * Converts ConceptMap to FHIR XML string
   * @param {ConceptMap} conceptMap - ConceptMap instance
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} FHIR XML string
   */
  static toXMLString(conceptMap, version = 'R5') {
    // Get JSON in target version using existing version conversion
    const jsonString = conceptMap.toJSONString(version);
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

    // Extract the ConceptMap root element and process FHIR-specific structures
    const conceptMap = result.ConceptMap || result;
    return this._processFhirStructure(conceptMap);
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
      rootNodeName: 'ConceptMap',
      xmlns: this._getFhirNamespace(version),
      arrayNodeName: (tagName) => {
        // For arrays, use the singular form as the repeated element name
        return this._getArrayElementName(tagName);
      }
    };

    const builder = new XMLBuilder(builderOptions);

    // Wrap in ConceptMap root with proper namespace
    const rootObj = {
      ConceptMap: {
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
    if (tagName === 'group') {
      // Groups are always arrays in ConceptMap
      return true;
    }

    if (tagName === 'element' && jPath.includes('group')) {
      // Elements within groups are arrays
      return true;
    }

    if (tagName === 'target' && jPath.includes('element')) {
      // Targets within elements are arrays
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
      'groups': 'group',
      'elements': 'element',
      'targets': 'target',
      'properties': 'property',
      'additionalAttributes': 'additionalAttribute',
      'extensions': 'extension',
      'modifierExtensions': 'modifierExtension'
    };

    return singularMap[arrayName] || arrayName.replace(/s$/, '');
  }

  /**
   * Validates that XML string is a FHIR ConceptMap
   * @param {string} xmlString - XML string to validate
   * @returns {boolean} True if valid FHIR ConceptMap XML
   */
  static isValidConceptMapXML(xmlString) {
    try {
      // Basic check for ConceptMap root element and namespace
      return xmlString.includes('<ConceptMap') &&
        xmlString.includes('http://hl7.org/fhir') &&
        xmlString.includes('</ConceptMap>');
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
const conceptMap = ConceptMapXML.fromXML(xmlString, 'R4');

// Convert to different version XML
const r3Xml = ConceptMapXML.toXMLString(conceptMap, 'R3');

// Validate XML
if (ConceptMapXML.isValidConceptMapXML(xmlString)) {
  const cm = ConceptMapXML.fromXML(xmlString);
}

// Find mappings
const mappings = conceptMap.findMappings('http://loinc.org', 'LA6113-0');
const reverseMappings = conceptMap.findReverseMappings('http://snomed.info/sct', '260385009');
*/