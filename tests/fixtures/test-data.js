/**
 * Test data fixtures for all modules
 */

class TestFixtures {
  
  /**
   * FHIR Resource examples for testing
   */
  static getFhirResources() {
    return {
      patient: {
        resourceType: 'Patient',
        id: 'test-patient-001',
        identifier: [
          {
            system: 'http://example.org/mrn',
            value: 'TEST001'
          }
        ],
        active: true,
        name: [
          {
            use: 'official',
            family: 'TestPatient',
            given: ['John', 'Q']
          }
        ],
        gender: 'male',
        birthDate: '1990-01-01'
      },
      
      observation: {
        resourceType: 'Observation',
        id: 'test-observation-001',
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs'
              }
            ]
          }
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '85354-9',
              display: 'Blood pressure panel with all children optional'
            }
          ]
        },
        subject: {
          reference: 'Patient/test-patient-001'
        },
        effectiveDateTime: '2023-01-15T10:30:00Z',
        valueQuantity: {
          value: 120,
          unit: 'mmHg',
          system: 'http://unitsofmeasure.org',
          code: 'mm[Hg]'
        }
      },
      
      valueSet: {
        resourceType: 'ValueSet',
        id: 'test-valueset-001',
        url: 'http://example.org/fhir/ValueSet/test-codes',
        version: '1.0.0',
        name: 'TestValueSet',
        title: 'Test Value Set',
        status: 'active',
        experimental: true,
        date: '2023-01-01',
        publisher: 'Test Organization',
        description: 'A test value set for unit testing',
        compose: {
          include: [
            {
              system: 'http://snomed.info/sct',
              concept: [
                {
                  code: '123456789',
                  display: 'Test concept 1'
                },
                {
                  code: '987654321',
                  display: 'Test concept 2'
                }
              ]
            }
          ]
        }
      },
      
      structureDefinition: {
        resourceType: 'StructureDefinition',
        id: 'test-profile-001',
        url: 'http://example.org/fhir/StructureDefinition/TestProfile',
        version: '1.0.0',
        name: 'TestProfile',
        title: 'Test Profile',
        status: 'active',
        kind: 'resource',
        abstract: false,
        type: 'Patient',
        baseDefinition: 'http://hl7.org/fhir/StructureDefinition/Patient',
        derivation: 'constraint',
        differential: {
          element: [
            {
              id: 'Patient.identifier',
              path: 'Patient.identifier',
              min: 1,
              mustSupport: true
            }
          ]
        }
      }
    };
  }
  
  /**
   * SHL (Smart Health Links) test data
   */
  static getShlTestData() {
    return {
      validShlRequest: {
        vhl: false,
        password: 'test-password-123',
        days: 30
      },
      
      validVhlRequest: {
        vhl: true,
        password: 'test-password-123',
        days: 7
      },
      
      validFiles: [
        {
          cnt: Buffer.from(JSON.stringify(this.getFhirResources().patient)).toString('base64'),
          type: 'application/fhir+json'
        },
        {
          cnt: Buffer.from(JSON.stringify(this.getFhirResources().observation)).toString('base64'),
          type: 'application/fhir+json'
        }
      ],
      
      invalidFiles: [
        {
          cnt: 'invalid-base64-content',
          // missing type
        },
        {
          type: 'application/fhir+json'
          // missing cnt
        }
      ],
      
      largeFile: {
        cnt: Buffer.from('x'.repeat(10000000)).toString('base64'), // ~10MB
        type: 'application/octet-stream'
      }
    };
  }
  
  /**
   * VCL (ValueSet Compose Language) test expressions
   */
  static getVclTestData() {
    return {
      validExpressions: [
        'system|http://snomed.info/sct',
        'system|http://snomed.info/sct^version|20210731',
        'system|http://loinc.org^property|STATUS^value|ACTIVE',
        'valueset|http://hl7.org/fhir/ValueSet/example',
        'system|http://snomed.info/sct^concept|123456789',
        'system|http://snomed.info/sct^filter|concept^op|is-a^value|123456789'
      ],
      
      invalidExpressions: [
        '', // empty
        'invalid-syntax',
        'system|', // missing system URL
        'system|http://example.org^invalid-property|value',
        'system|http://example.org^property|^value|test' // empty property
      ],
      
      complexExpression: 'system|http://snomed.info/sct^version|20210731^filter|concept^op|is-a^value|64572001^property|STATUS^value|ACTIVE',
      
      expectedValueSet: {
        resourceType: 'ValueSet',
        id: 'generated-valueset',
        compose: {
          include: [
            {
              system: 'http://snomed.info/sct',
              version: '20210731',
              filter: [
                {
                  property: 'concept',
                  op: 'is-a',
                  value: '64572001'
                }
              ]
            }
          ]
        }
      }
    };
  }
  
  /**
   * Package server test data
   */
  static getPackageTestData() {
    return {
      mockPackages: [
        {
          id: 'hl7.fhir.r4.core',
          version: '4.0.1',
          fhirVersion: '4.0.1',
          description: 'FHIR R4 Core',
          url: 'http://hl7.org/fhir/R4',
          canonical: 'http://hl7.org/fhir',
          content: Buffer.from('mock-package-content-r4-core'),
          dependencies: []
        },
        {
          id: 'hl7.fhir.us.core',
          version: '3.1.1',
          fhirVersion: '4.0.1',
          description: 'US Core Implementation Guide',
          url: 'http://hl7.org/fhir/us/core',
          canonical: 'http://hl7.org/fhir/us/core',
          content: Buffer.from('mock-package-content-us-core'),
          dependencies: ['hl7.fhir.r4.core']
        },
        {
          id: 'test.example.ig',
          version: '1.0.0',
          fhirVersion: '4.0.1',
          description: 'Test Example Implementation Guide',
          url: 'http://example.org/fhir/test-ig',
          canonical: 'http://example.org/fhir/test-ig',
          content: Buffer.from('mock-package-content-test-ig'),
          dependencies: ['hl7.fhir.r4.core', 'hl7.fhir.us.core']
        }
      ],
      
      mockFeeds: {
        feeds: [
          {
            name: 'HL7 FHIR Registry',
            url: 'http://localhost:8080/hl7-feed.json'
          },
          {
            name: 'Test Registry',
            url: 'http://localhost:8080/test-feed.json'
          }
        ]
      }
    };
  }
  
  /**
   * XIG (Implementation Guide Statistics) test data
   */
  static getXigTestData() {
    return {
      mockResources: [
        {
          ResourceKey: 1,
          PackageKey: 1,
          ResourceType: 'StructureDefinition',
          Id: 'Patient',
          Type: 'Patient',
          Kind: 'resource',
          Description: 'Patient resource profile',
          Url: 'http://hl7.org/fhir/StructureDefinition/Patient',
          Version: '4.0.1',
          Status: 'active',
          R4: 1,
          R5: 0,
          Realm: 'US',
          Authority: 'hl7'
        },
        {
          ResourceKey: 2,
          PackageKey: 1,
          ResourceType: 'ValueSet',
          Id: 'administrative-gender',
          Type: null,
          Kind: null,
          Description: 'Administrative Gender value set',
          Url: 'http://hl7.org/fhir/ValueSet/administrative-gender',
          Version: '4.0.1',
          Status: 'active',
          R4: 1,
          R5: 1,
          Realm: 'UV',
          Authority: 'hl7'
        }
      ],
      
      mockPackages: [
        {
          PackageKey: 1,
          Id: 'hl7.fhir.r4.core',
          PID: 'hl7.fhir.r4.core#4.0.1',
          Web: 'http://hl7.org/fhir/R4',
          Canonical: 'http://hl7.org/fhir'
        }
      ],
      
      queryParams: {
        simple: { ver: 'R4' },
        complex: { 
          ver: 'R4', 
          auth: 'hl7', 
          realm: 'US', 
          type: 'rp', 
          text: 'patient' 
        },
        pagination: { 
          ver: 'R4', 
          offset: '200' 
        }
      }
    };
  }
  
  /**
   * Database test data and utilities
   */
  static getDatabaseTestData() {
    return {
      shlTables: [
        'SHL',
        'SHLFiles', 
        'SHLViews'
      ],
      
      packagesTables: [
        'Packages',
        'PackageVersions',
        'PackageFeeds'
      ],
      
      xigTables: [
        'Resources',
        'Packages',
        'Metadata',
        'Categories'
      ],
      
      sampleSqlQueries: {
        selectPatientResources: `
          SELECT * FROM Resources 
          WHERE ResourceType = 'Patient' 
          AND R4 = 1
        `,
        selectPackagesByRealm: `
          SELECT DISTINCT p.* FROM Packages p
          JOIN Resources r ON p.PackageKey = r.PackageKey
          WHERE r.Realm = ?
        `,
        countResourcesByType: `
          SELECT ResourceType, COUNT(*) as count
          FROM Resources
          GROUP BY ResourceType
          ORDER BY count DESC
        `
      }
    };
  }
  
  /**
   * Performance testing scenarios
   */
  static getPerformanceTestData() {
    return {
      scenarios: {
        light: {
          duration: 30,
          arrivalRate: 5,
          rampTo: 10
        },
        moderate: {
          duration: 60,
          arrivalRate: 10,
          rampTo: 25
        },
        heavy: {
          duration: 120,
          arrivalRate: 25,
          rampTo: 50
        }
      },
      
      endpoints: [
        { path: '/health', weight: 20 },
        { path: '/shl/validate/status', weight: 15 },
        { path: '/xig/stats', weight: 15 },
        { path: '/packages/catalog', weight: 20 },
        { path: '/VCL?vcl=system|http://snomed.info/sct', weight: 10 },
        { path: '/xig?ver=R4', weight: 20 }
      ]
    };
  }
  
  /**
   * Generate random test data
   */
  static generateRandomData(type, count = 10) {
    const generators = {
      patients: () => ({
        resourceType: 'Patient',
        id: `test-patient-${Math.random().toString(36).substr(2, 9)}`,
        name: [{
          family: `TestFamily${Math.floor(Math.random() * 1000)}`,
          given: [`TestGiven${Math.floor(Math.random() * 1000)}`]
        }],
        gender: ['male', 'female', 'other'][Math.floor(Math.random() * 3)],
        birthDate: `19${Math.floor(Math.random() * 80) + 20}-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`
      }),
      
      packages: () => ({
        id: `test.package.${Math.random().toString(36).substr(2, 6)}`,
        version: `${Math.floor(Math.random() * 5) + 1}.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`,
        fhirVersion: ['4.0.1', '5.0.0'][Math.floor(Math.random() * 2)],
        description: `Test package ${Math.floor(Math.random() * 10000)}`
      })
    };
    
    const generator = generators[type];
    if (!generator) {
      throw new Error(`Unknown data type: ${type}`);
    }
    
    return Array.from({ length: count }, generator);
  }
}

module.exports = TestFixtures;