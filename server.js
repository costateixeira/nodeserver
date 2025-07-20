const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import modules
const SHLModule = require('./shl.js');
const VCLModule = require('./vcl.js');
const xigModule = require('./xig.js');

const app = express();

// Load configuration
let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configData);
  console.log('Configuration loaded successfully');
} catch (error) {
  console.error('Failed to load configuration:', error.message);
  process.exit(1);
}

const PORT = process.env.PORT || config.server.port || 3000;

// Middleware
app.use(express.json());
app.use(express.raw({ type: 'application/fhir+json', limit: '10mb' }));
app.use(express.raw({ type: 'application/fhir+xml', limit: '10mb' }));
app.use(cors(config.server.cors));

// Module instances
const modules = {};

// Initialize modules based on configuration
async function initializeModules() {
  console.log('Initializing modules...');

  // Initialize SHL module
  if (config.modules.shl.enabled) {
    try {
      modules.shl = new SHLModule();
      await modules.shl.initialize(config.modules.shl);
      app.use('/shl', modules.shl.router);
      console.log('SHL module loaded and routes registered');
    } catch (error) {
      console.error('Failed to initialize SHL module:', error);
      throw error;
    }
  } else {
    console.log('SHL module is disabled in configuration');
  }

  // Initialize VCL module
  if (config.modules.vcl.enabled) {
    try {
      modules.vcl = new VCLModule();
      await modules.vcl.initialize(config.modules.vcl);
      app.use('/VCL', modules.vcl.router);
      console.log('VCL module loaded and routes registered');
    } catch (error) {
      console.error('Failed to initialize VCL module:', error);
      throw error;
    }
  } else {
    console.log('VCL module is disabled in configuration');
  }

  // Initialize XIG module
  if (config.modules.xig.enabled) {
    try {
      await xigModule.initializeXigModule();
      app.use('/xig', xigModule.router);
      modules.xig = xigModule;
      console.log('XIG module loaded and routes registered');
    } catch (error) {
      console.error('Failed to initialize XIG module:', error);
      throw error;
    }
  } else {
    console.log('XIG module is disabled in configuration');
  }

  console.log('All enabled modules initialized successfully');
}

// Serve static files
app.use(express.static(path.join(__dirname, 'static')));

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    modules: {}
  };

  // Get status from each enabled module
  Object.keys(modules).forEach(moduleName => {
    if (modules[moduleName] && typeof modules[moduleName].getStatus === 'function') {
      healthStatus.modules[moduleName] = modules[moduleName].getStatus();
    } else if (moduleName === 'xig') {
      // XIG has different status check
      let xigStatus = 'Enabled';
      if (modules.xig && modules.xig.isCacheLoaded && modules.xig.isCacheLoaded()) {
        xigStatus = 'Running';
      } else {
        xigStatus = 'Enabled but not loaded';
      }
      healthStatus.modules.xig = { enabled: true, status: xigStatus };
    }
  });

  res.json(healthStatus);
});

// Error handling middleware
// app.use((req, res) => {
//   res.status(404).json({
//     error: 'Route not found'
//   });
// });

// Initialize everything
async function startServer() {
  try {
    // Initialize modules
    await initializeModules().catch(error => {
      console.error('Failed to initialize modules:', error);
      throw error;
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`\n=== Server running on http://localhost:${PORT} ===`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      
      if (config.modules.shl.enabled) {
        console.log(`SHL endpoints: http://localhost:${PORT}/shl/`);
        
        if (config.modules.shl.validator.enabled) {
          console.log(`FHIR Validation endpoint: http://localhost:${PORT}/shl/validate`);
          console.log(`Validator status: http://localhost:${PORT}/shl/validate/status`);
        }
      }
      
      if (config.modules.vcl.enabled) {
        console.log(`VCL parsing endpoint: http://localhost:${PORT}/VCL?vcl=<expression>`);
      }
      
      if (config.modules.xig.enabled) {
        console.log(`XIG endpoints: http://localhost:${PORT}/xig`);
        console.log(`XIG statistics: http://localhost:${PORT}/xig/stats`);
        console.log(`XIG resources: http://localhost:${PORT}/xig`);
      }
      
      console.log(`====================================================\n`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...');
  
  // Shutdown all modules
  for (const [moduleName, moduleInstance] of Object.entries(modules)) {
    try {
      if (moduleInstance && typeof moduleInstance.shutdown === 'function') {
        console.log(`Shutting down ${moduleName} module...`);
        await moduleInstance.shutdown();
        console.log(`${moduleName} module shut down`);
      }
    } catch (error) {
      console.error(`Error shutting down ${moduleName} module:`, error);
    }
  }
  
  console.log('Server shutdown complete');
  process.exit(0);
});

// Start the server
startServer();