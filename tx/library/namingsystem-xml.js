/**
 * XML support for FHIR NamingSystem resources
 * Handles conversion between FHIR XML format and NamingSystem objects
 */

import { NamingSystem } from './NamingSystem.js';
import {XMLBuilder, XMLParser} from "fast-xml-parser";

/**
 * XML support for FHIR NamingSystem resources
 * @class
 */
export class NamingSystemXML {

  /**
   * FHIR NamingSystem elements that should be arrays in JSON
   * @type {Set<string>}
   * @private
   */
  static _arrayElements = new Set([
    'contact',         // Array of contact details
    'useContext',      // Array of usage contexts
    'jurisdiction',    // Array of jurisdictions
    'uniqueId',        // Array of unique identifiers (core element)
    'extension',       // Array of extensions
    'modifierExtension' // Array of modifier extensions
  ]);

  /**
   * Creates NamingSystem from FHIR XML string
   * @param {string} xmlString - FHIR XML representation of NamingSystem
   * @param {string} [version='R5'] - FHIR version ('R3', 'R4', or 'R5')
   * @returns {NamingSystem} New NamingSystem instance
   */
  static fromXML(xmlString, version = 'R5') {
    // Parse XML to JSON using FHIR-aware configuration
    const jsonObj = this._xmlToJson(xmlString);

    // Use existing NamingSystem constructor with version conversion
    return new NamingSystem(jsonObj, version);
  }

  /**
   * Converts NamingSystem to FHIR XML string
   * @param {NamingSystem} namingSystem - NamingSystem instance
   * @param {string} [version='R5'] - Target FHIR version ('R3', 'R4', or 'R5')
   * @returns {string} FHIR XML string
   */
  static toXMLString(namingSystem, version = 'R5') {
    // Get JSON in target version using existing version conversion
    const jsonString = namingSystem.toJSONString(version);
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
      isArray: (tagName, jPath, isLeafNode, isAttribute) => {
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

    // Extract the NamingSystem root element and process FHIR-specific structures
    const namingSystem = result.NamingSystem || result;
    return this._processFhirStructure(namingSystem);
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
      rootNodeName: 'NamingSystem',
      xmlns: this._getFhirNamespace(version),
      arrayNodeName: (tagName) => {
        // For arrays, use the singular form as the repeated element name
        return this._getArrayElementName(tagName);
      }
    };

    const builder = new XMLBuilder(builderOptions);

    // Wrap in NamingSystem root with proper namespace
    const rootObj = {
      NamingSystem: {
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

    // uniqueId is always an array in NamingSystem
    if (tagName === 'uniqueId') {
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
      'contacts': 'contact',
      'useContexts': 'useContext',
      'jurisdictions': 'jurisdiction',
      'uniqueIds': 'uniqueId',
      'extensions': 'extension',
      'modifierExtensions': 'modifierExtension'
    };

    return singularMap[arrayName] || arrayName.replace(/s$/, '');
  }

  /**
   * Validates that XML string is a FHIR NamingSystem
   * @param {string} xmlString - XML string to validate
   * @returns {boolean} True if valid FHIR NamingSystem XML
   */
  static isValidNamingSystemXML(xmlString) {
    try {
      // Basic check for NamingSystem root element and namespace
      return xmlString.includes('<NamingSystem') &&
        xmlString.includes('http://hl7.org/fhir') &&
        xmlString.includes('</NamingSystem>');
    } catch (error) {
      console.error('Error message:', error.message);
      console.error('Stack trace:', error.stack);
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
const namingSystem = NamingSystemXML.fromXML(xmlString, 'R4');

// Convert to different version XML
const r3Xml = NamingSystemXML.toXMLString(namingSystem, 'R3');

// Validate XML
if (NamingSystemXML.isValidNamingSystemXML(xmlString)) {
  const ns = NamingSystemXML.fromXML(xmlString);
}

// Check unique identifiers
if (namingSystem.hasUniqueId('uri', 'http://example.org/my-system')) {
  const preferredId = namingSystem.getPreferredUniqueId();
  console.log(preferredId?.value);
}
*/