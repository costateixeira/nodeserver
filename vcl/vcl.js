//
// Copyright 2025, Health Intersections Pty Ltd (http://www.healthintersections.com.au)
//
// Licensed under BSD-3: https://opensource.org/license/bsd-3-clause
//

const express = require('express');
const {parseVCL, parseVCLAndSetId, validateVCLExpression, VCLParseException} = require('./vcl-parser.js');

class VCLModule {
  constructor() {
    this.router = express.Router();
    this.config = null;
    this.setupRoutes();
  }

  async initialize(config) {
    this.config = config;
    console.log('VCL module initialized successfully');
  }

  setupRoutes() {
    // VCL parsing endpoint
    this.router.get('/', (req, res) => {
      var {vcl} = req.query;

      // Validation
      if (!vcl) {
        return res.status(400).json({
          error: 'VCL expression is required as query parameter: ?vcl=<expression>'
        });
      }

      if (vcl.startsWith('http://fhir.org/VCL/')) {
        vcl = vcl.substring(20);
      }

      try {
        // Validate the VCL expression first
        if (!validateVCLExpression(vcl)) {
          return res.status(400).json({
            error: 'Invalid VCL expression syntax'
          });
        }

        // Parse the VCL expression and generate ValueSet with ID
        const valueSet = parseVCLAndSetId(vcl);

        // Return the ValueSet as JSON
        res.json(valueSet);

      } catch (error) {
        console.error('VCL parsing error:', error);

        if (error instanceof VCLParseException) {
          return res.status(400).json({
            error: 'VCL parsing error',
            message: error.message,
            position: error.position >= 0 ? error.position : undefined
          });
        } else {
          return res.status(500).json({
            error: 'Internal server error while parsing VCL',
            message: error.message
          });
        }
      }
    });
  }

  async shutdown() {
    console.log('VCL module shut down');
    // VCL module doesn't have any resources to clean up
  }

  getStatus() {
    return {
      enabled: true
    };
  }
}

module.exports = VCLModule;