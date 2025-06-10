# Node.js SHL API

A Node.js REST API for Smart Health Links (SHL) with SQLite database integration.

## Features

- Express.js server with JSON request/response handling
- SQLite database with automatic initialization
- SHL (Smart Health Link) creation with UUID generation
- File upload and storage with base64 encoding
- VHL (Verifiable Health Link) processing support
- Automatic cleanup of expired SHL entries (runs hourly)
- Comprehensive access logging
- Error handling and validation
- CORS support
- Graceful shutdown

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## API Endpoints

### SHL (Smart Health Link)

- `POST /shl/create` - Create new SHL entry
- `POST /shl/upload` - Upload files to existing SHL entry
- `POST /shl/access/{uuid}` - Access SHL entry and get file list (requires recipient)
- `GET /shl/file/{fileId}` - Download individual file
- `POST /shl/sign` - Sign a URL with COSE signature

### Health Check

- `GET /health` - Server health status

## Example Usage

### Create SHL entry:
```bash
# With numeric days
curl -X POST http://localhost:3000/shl/create \
  -H "Content-Type: application/json" \
  -d '{"vhl":true,"password":"default123","days":30}'

# With string days
curl -X POST http://localhost:3000/shl/create \
  -H "Content-Type: application/json" \
  -d '{"vhl":true,"password":"default123","days":"30"}'
```

### Upload files to SHL:
```bash
curl -X POST http://localhost:3000/shl/upload \
  -H "Content-Type: application/json" \
  -d '{
    "uuid":"your-shl-uuid-here",
    "pword":"your-generated-password-here",
    "files":[
      {"cnt":"SGVsbG8gV29ybGQ=","type":"text/plain"},
      {"cnt":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==","type":"image/png"}
    ]
  }'
```

### Access SHL entry:
```bash
# Access with recipient (required)
curl -X POST http://localhost:3000/shl/access/your-shl-uuid-here \
  -H "Content-Type: application/json" \
  -d '{"recipient":"Dr. Smith"}'

# Access with recipient and embedded length limit
curl -X POST http://localhost:3000/shl/access/your-shl-uuid-here \
  -H "Content-Type: application/json" \
  -d '{"recipient":"Dr. Smith","embeddedLengthMax":1000}'
```

### Download individual file:
```bash
curl http://localhost:3000/shl/file/file-uuid-here
```

### Sign a URL:
```bash
curl -X POST http://localhost:3000/shl/sign \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/health-data"}'
```

## Access Logging

The system logs all access attempts:

- **SHL Access**: When `/shl/access` is called, logs the SHL UUID, recipient, IP, and timestamp
- **File Downloads**: When `/shl/file` is called, logs both:
  - Master SHL UUID access (with null recipient)
  - File-specific UUID access (with null recipient)
  
All logs include IP address and timestamp for audit purposes.

## Background Tasks

The server automatically runs a cleanup task every hour (at minute 0) to remove expired SHL entries from the database. This ensures the database doesn't grow indefinitely with old entries.

## Database

The SQLite database file (`database.db`) is created automatically when the server starts. 

### Config Table
- `key` - Configuration key (primary key)
- `value` - Configuration value
- Default entries: 
  - `shl_password` = `default123`
  - `jwk` = Sample JWK JSON structure
  - `vhl.issuer` = `XXX`

### SHL Table
- `uuid` - Primary key (UUID)
- `vhl` - Boolean flag
- `expires_at` - Expiry date (calculated from creation date + days)
- `password` - Generated UUID password
- `created_at` - Timestamp (auto-generated)

### SHLFiles Table
- `id` - Primary key (UUID for individual files)
- `shl_uuid` - Foreign key to SHL table
- `cnt` - Base64 encoded file content
- `type` - MIME type of the file
- `created_at` - Timestamp (auto-generated)

### SHLViews Table
- `id` - Primary key (auto-increment)
- `shl_uuid` - Foreign key to SHL table
- `recipient` - Recipient information from request
- `ip_address` - Client IP address
- `created_at` - Timestamp (auto-generated)

## Environment Variables

- `PORT` - Server port (default: 3000)

## Project Structure

```
├── server.js          # Main server file
├── package.json       # Dependencies and scripts
├── vhl.js             # VHL processing module (optional)
├── database.db        # SQLite database (auto-created)
└── README.md         # This file
```

## VHL Processing

When an SHL entry has `vhl: true`, the `/shl/access` endpoint will use the `vhl.js` module to process the response. This allows for complex VHL-specific transformations of the returned JSON.

The `vhl.js` module should export a `processVHL` function that takes:
- `host` - The request host
- `uuid` - The SHL entry UUID  
- `standardResponse` - The standard JSON response

And returns the modified JSON response for VHL entries.

If `vhl.js` doesn't exist or VHL processing fails, the endpoint falls back to the standard response.