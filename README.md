# Node.js FHIR Server

A Node.js based REST API+Web server featuring Smart support for Smart Health Links (SHL), FHIR Validation, Value Set Control Language (VCL) parsing, and Implementation Guide Statistics (XIG) with SQLite database integration.

## Features

### Smart Health Links (SHL)

This module supports the Passport and ICVP services on http://www.healthintersections.com.au

- SHL creation with UUID generation and expiration
- File upload and storage with base64 encoding
- VHL (Verifiable Health Link) processing support
- Automatic cleanup of expired SHL entries
- Comprehensive access logging
- Java-based FHIR validator integration


### Value Set Control Language (VCL)

This module provides VCL -> ValueSet support for http://fhir.org/VCL

- VCL expression parsing and validation
- Dynamic ValueSet generation from VCL expressions
- Support for `http://fhir.org/VCL/` URL format
- Comprehensive error handling with position information

### Implementation Guide Statistics (XIG)

This module provides XIG access at http://xig.fhir.org/xig/resources 

- Comprehensive FHIR IG statistics and browsing
- Resource filtering by version, authority, realm, and type
- Real-time database synchronization with fhir.org
- Advanced caching system for performance
- Detailed resource dependency tracking
- Resource narrative and source content display

### General Features

- Express.js server with JSON request/response handling
- SQLite database with automatic initialization
- CORS support and error handling
- Graceful shutdown
- Request tracking and statistics

## Setup

1. Install dependencies:
```bash
npm install
```

2. Place the FHIR validator JAR file in the project root:
```bash
# Download from https://github.com/hapifhir/org.hl7.fhir.core/releases
wget https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar
```

3. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## API Endpoints

### Health Check
- `GET /health` - Server health status including validator and XIG status

### FHIR Validation
- `POST /validate` - Validate FHIR resources (JSON/XML)
- `GET /validate/status` - Check validator service status
- `POST /validate/loadig` - Load additional Implementation Guide packages

### VCL (Value Set Control Language)
- `GET /VCL?vcl=<expression>` - Parse VCL expression and return ValueSet

### SHL (Smart Health Link)
- `POST /shl/create` - Create new SHL entry
- `POST /shl/upload` - Upload files to existing SHL entry
- `GET /shl/access/{uuid}` - Access SHL entry (anonymous)
- `POST /shl/access/{uuid}` - Access SHL entry with recipient info
- `GET /shl/file/{fileId}` - Download individual file
- `POST /shl/sign` - Sign a URL with COSE signature

### XIG (Implementation Guide Statistics)
- `GET /xig` - XIG homepage with navigation
- `GET /xig/resources` - Browse FHIR resources with filtering
- `GET /xig/resource/{packagePid}/{resourceType}/{resourceId}` - Individual resource details
- `GET /xig/stats` - System statistics and performance metrics
- `GET /xig/status` - XIG status (JSON)
- `GET /xig/cache` - Cache statistics (JSON)
- `POST /xig/update` - Manual database update

### Configuration Management
- `GET /config/{key}` - Get configuration value
- `PUT /config/{key}` - Update configuration value

## Example Usage

### FHIR Validation
```bash
# Validate a FHIR resource following ICVP specifications
curl -X POST http://localhost:3000/validate \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Patient",
    "id": "example",
    "gender": "male"
  }'

# Check validator status
curl http://localhost:3000/validate/status
```

### VCL Parsing
```bash
# Parse a VCL expression
curl "http://localhost:3000/VCL?vcl=http://loinc.org%5E*"

# Parse with HTTP prefix
curl "http://localhost:3000/VCL?vcl=http://fhir.org/VCL/http://loinc.org%5E*"
```

### XIG Statistics
```bash
# Browse all resources
curl http://localhost:3000/xig/resources

# Filter by FHIR version
curl "http://localhost:3000/xig/resources?ver=R4"

# Filter by resource type
curl "http://localhost:3000/xig/resources?type=rp&rt=Patient"

# Get system statistics
curl http://localhost:3000/xig/stats
```

### SHL Creation and Access
```bash
# Create SHL entry
curl -X POST http://localhost:3000/shl/create \
  -H "Content-Type: application/json" \
  -d '{"vhl":true,"password":"default123","days":30}'

# Upload files to SHL
curl -X POST http://localhost:3000/shl/upload \
  -H "Content-Type: application/json" \
  -d '{
    "uuid":"your-shl-uuid-here",
    "pword":"your-generated-password-here",
    "files":[
      {"cnt":"SGVsbG8gV29ybGQ=","type":"text/plain"}
    ]
  }'

# Access SHL entry
curl -X POST http://localhost:3000/shl/access/your-shl-uuid-here \
  -H "Content-Type: application/json" \
  -d '{"recipient":"Dr. Smith"}'
```

## Access Logging

The system provides comprehensive logging:

- **SHL Access**: Logs all `/shl/access` calls with recipient info
- **File Downloads**: Logs both master SHL and individual file access
- **XIG Usage**: Tracks page views and processing times
- **Request Statistics**: Daily counts and performance metrics

## Background Tasks

### SHL Cleanup
Runs hourly to remove expired SHL entries from the database.

### XIG Database Updates
- **Automatic**: Daily at 2 AM, downloads latest FHIR IG statistics from fhir.org
- **Manual**: Via `POST /xig/update` endpoint
- **Validation**: Ensures database integrity before replacement

## Database

The server uses two SQLite databases:

### Main Database (`database.db`)
Contains SHL data, configuration, and validator settings:

- **config**: System configuration and certificates
- **SHL**: Smart Health Link entries with expiration
- **SHLFiles**: File storage with base64 encoding
- **SHLViews**: Access logging and analytics

### XIG Database (`xig.db`)
Downloaded from fhir.org, contains FHIR IG statistics:

- **Resources**: All FHIR resources across packages
- **Packages**: Implementation Guide package information
- **Dependencies**: Resource dependency relationships
- **Contents**: Compressed resource JSON content
- **Categories**: Resource categorization data

## Environment Variables

- `PORT` - Server port (default: 3000)

## Project Structure

```
├── server.js              # Main server file with all endpoints
├── xig.js                 # XIG module for IG statistics
├── vcl-parser.js          # VCL parsing and validation
├── vhl.js                 # VHL processing module (optional)
├── package.json           # Dependencies and scripts
├── database.db            # Main SQLite database (auto-created)
├── xig.db                 # XIG statistics database (auto-downloaded)
├── validator_cli.jar      # FHIR validator JAR file (must be downloaded manually)
├── xig-template.html      # XIG HTML template (optional)
├── static/                # Static files for XIG interface
│   ├── fhir.css
│   ├── icon-fhir-16.png
│   └── assets/
│       ├── css/
│       ├── js/
│       └── ico/
└── README.md              # This file
```

## XIG Features Detail

### Resource Browsing
- **Filtering**: By FHIR version, authority, realm, resource type
- **Search**: Full-text search across resource content
- **Pagination**: Handles large result sets efficiently
- **Types**: CodeSystems, ValueSets, Profiles, Extensions, etc.

### Resource Details
- **Metadata**: Complete resource information
- **Dependencies**: Shows what uses and what is used by each resource
- **Narrative**: Displays FHIR narrative content with link fixing
- **Source**: Full JSON source with GZIP decompression

### Performance
- **Caching**: In-memory caching of frequently accessed data
- **Database**: Read-only SQLite for fast queries
- **Statistics**: Real-time performance metrics and timing

## VHL Processing

When an SHL entry has `vhl: true`, the `/shl/access` endpoint will use the `vhl.js` module to process the response. This allows for VHL-specific transformations.

The `vhl.js` module should export a `processVHL` function that takes:
- `host` - Request host
- `uuid` - SHL entry UUID  
- `standardResponse` - Standard JSON response

And returns the modified JSON response for VHL entries.

## Configuration

Key configuration options stored in the database:

- **FHIR Validator**: Version, terminology server, packages
- **SHL Settings**: Password, certificate, signing keys
- **VHL Settings**: Issuer information
- **XIG Settings**: Update schedule, display options

Configuration can be updated via the `/config` endpoints or directly in the database.