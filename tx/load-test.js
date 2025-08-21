const fs = require('fs').promises;
const path = require('path');
const yaml = require('yaml'); // npm install yaml
const { PackageManager, PackageContentLoader } = require('../library/package-manager');
const CodeSystem = require("./library/codesystem"); // Update this path

async function loadPackagesAndMeasure() {
  const startTime = Date.now();
  const startMemory = process.memoryUsage();

  console.log('Starting package loading performance test...');
  console.log(`Initial memory usage: ${(startMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);

  try {
    // Read and parse YAML configuration
    const yamlPath = path.join(__dirname, '..', 'tx', 'tx.fhir.org.yml');
    const yamlContent = await fs.readFile(yamlPath, 'utf8');
    const config = yaml.parse(yamlContent);

    // Extract npm packages from rX array
    const npmPackages = config.rX
      .filter(entry => typeof entry === 'string' && entry.startsWith('npm:'))
      .map(entry => entry.substring(4)); // Remove 'npm:' prefix

    // Add hl7.fhir.r4.core as specified
    npmPackages.push('hl7.fhir.r4.core');

    console.log(`\nFound ${npmPackages.length} npm packages to process:`);
    npmPackages.forEach(pkg => console.log(`  - ${pkg}`));

    // Initialize Enhanced PackageManager with redirect support
    const packageServers = ['https://packages.fhir.org'];
    const cacheFolder = path.join(__dirname, '.package-cache');
    const packageManager = new PackageManager(packageServers, cacheFolder);

    // Resource types we want to load
    const targetResourceTypes = ['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem'];

    let totalResourcesLoaded = 0;
    const packageResults = [];

    // Map to hold ALL loaded resources in memory by url|version
    // This prevents garbage collection and gives accurate memory measurements
    const allLoadedResources = new Map();
    // Separate map for wrapped CodeSystem instances
    const wrappedCodeSystems = new Map();
    let codeSystemsWrapped = 0;


    // Process each package
    for (let i = 0; i < npmPackages.length; i++) {
      const packageId = npmPackages[i];
      console.log(`\n[${i + 1}/${npmPackages.length}] Processing package: ${packageId}`);
      const packageStartTime = Date.now();

      try {
        // Fetch package (using null to get the most recent version)
        console.log(`  Fetching package...`);
        const packagePath = await packageManager.fetch(packageId, null);
        const fullPackagePath = path.join(cacheFolder, packagePath);

        console.log(`  Package extracted to: ${packagePath}`);

        // Initialize content loader
        console.log(`  Loading package index...`);
        const contentLoader = new PackageContentLoader(fullPackagePath);
        await contentLoader.initialize();

        // Get statistics
        const stats = await contentLoader.getStatistics();
        console.log(`  Package contains ${stats.totalResources} total resources`);

        const packageResult = {
          packageId,
          totalResources: stats.totalResources,
          targetResources: {},
          loadedCount: 0,
          codeSystemsWrapped: 0,
          loadTime: 0
        };

        // Load each target resource type
        for (const resourceType of targetResourceTypes) {
          const resources = await contentLoader.getResourcesByType(resourceType);
          packageResult.targetResources[resourceType] = resources.length;

          if (resources.length > 0) {
            console.log(`    Loading ${resources.length} ${resourceType} resources...`);

            // Actually load the resources (this is where the real work happens)
            const loadedResources = await contentLoader.loadByFilter(
              entry => entry.resourceType === resourceType
            );
            let packageCodeSystemsWrapped = 0;

            // Store all loaded resources in memory by url|version to prevent GC
            for (const resource of loadedResources) {
              let key;
              if (resource.url) {
                key = resource.version ? `${resource.url}|${resource.version}` : resource.url;
              } else {
                // Fallback for resources without url (use resourceType/id)
                key = `${resource.resourceType}/${resource.id}`;
              }

              // Store in our memory map to keep it from being garbage collected
              allLoadedResources.set(key, resource);
              // For CodeSystem resources, also wrap them in the CodeSystem class
              if (resource.resourceType === 'CodeSystem') {
                try {
                  console.log(`      Wrapping CodeSystem: ${resource.url || resource.id}`);
                  const wrappedCS = new CodeSystem(resource, 'R5'); // Assume R5 for now
                  wrappedCodeSystems.set(key, wrappedCS);
                  codeSystemsWrapped++;
                  packageCodeSystemsWrapped++;
                } catch (error) {
                  console.log(`      ⚠️  Failed to wrap CodeSystem ${resource.url || resource.id}: ${error.message}`);
                }
              }
            }

            packageResult.loadedCount += loadedResources.length;
            totalResourcesLoaded += loadedResources.length;
            packageResult.codeSystemsWrapped += packageCodeSystemsWrapped;


            console.log(`    ✓ Loaded ${loadedResources.length} ${resourceType} resources`);
            if (packageCodeSystemsWrapped > 0) {
              console.log(`    ✓ Wrapped ${packageCodeSystemsWrapped} CodeSystems in class instances`);
            }

          }
        }

        packageResult.loadTime = Date.now() - packageStartTime;
        packageResults.push(packageResult);

        console.log(`  Package completed in ${packageResult.loadTime}ms`);

        // Show current memory usage
        const currentMemory = process.memoryUsage();
        console.log(`  Current heap usage: ${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);

      } catch (error) {
        console.error(`  ❌ Failed to load package ${packageId}:`, error.message);
        packageResults.push({
          packageId,
          error: error.message,
          loadTime: Date.now() - packageStartTime
        });
      }
    }

    // Calculate final results
    const endTime = Date.now();

    // Force garbage collection if available (run with --expose-gc for this to work)
    if (global.gc) {
      console.log('\nForcing garbage collection for accurate memory measurement...');
      global.gc();
    }

    const endMemory = process.memoryUsage();
    const totalTime = endTime - startTime;

    const memoryIncrease = {
      rss: endMemory.rss - startMemory.rss,
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal,
      external: endMemory.external - startMemory.external
    };

    // Print comprehensive results
    console.log('\n' + '='.repeat(60));
    console.log('PERFORMANCE TEST RESULTS');
    console.log('='.repeat(60));

    console.log(`\n⏱️  TIMING:`);
    console.log(`   Total time: ${totalTime.toLocaleString()}ms (${(totalTime / 1000).toFixed(2)}s)`);
    console.log(`   Average time per package: ${(totalTime / npmPackages.length).toFixed(0)}ms`);

    console.log(`\n💾 MEMORY USAGE INCREASE:`);
    console.log(`   RSS (Resident Set Size): ${(memoryIncrease.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Heap Used: ${(memoryIncrease.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Heap Total: ${(memoryIncrease.heapTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   External: ${(memoryIncrease.external / 1024 / 1024).toFixed(2)} MB`);

    console.log(`\n📊 RESOURCES LOADED:`);
    console.log(`   Total target resources loaded: ${totalResourcesLoaded.toLocaleString()}`);
    console.log(`   Resources retained in memory: ${allLoadedResources.size.toLocaleString()}`);
    console.log(`   CodeSystems wrapped in class: ${codeSystemsWrapped.toLocaleString()}`);
    console.log(`   Target resource types: ${targetResourceTypes.join(', ')}`);

    // Sample some keys from the map to show what we're storing
    const sampleKeys = Array.from(allLoadedResources.keys()).slice(0, 3);
    if (sampleKeys.length > 0) {
      console.log(`   Sample resource keys:`);
      sampleKeys.forEach(key => console.log(`     ${key}`));
      if (allLoadedResources.size > 3) {
        console.log(`     ... and ${allLoadedResources.size - 3} more`);
      }
    }

    console.log(`\n📦 PER-PACKAGE BREAKDOWN:`);
    packageResults.forEach((result, index) => {
      if (result.error) {
        console.log(`   ${index + 1}. ${result.packageId}: ❌ ERROR (${result.error})`);
      } else {
        console.log(`   ${index + 1}. ${result.packageId}:`);
        console.log(`      Time: ${result.loadTime}ms`);
        console.log(`      Total resources in package: ${result.totalResources}`);
        console.log(`      Target resources loaded: ${result.loadedCount}`);

        const nonZeroTypes = Object.entries(result.targetResources)
          .filter(([type, count]) => count > 0);

        if (nonZeroTypes.length > 0) {
          console.log(`      Breakdown:`);
          nonZeroTypes.forEach(([type, count]) => {
            console.log(`        ${type}: ${count}`);
          });
        }
      }
    });

    console.log(`\n📈 PERFORMANCE INSIGHTS:`);
    console.log(`   Resources per second: ${(totalResourcesLoaded / (totalTime / 1000)).toFixed(0)}`);
    console.log(`   MB per 1000 resources: ${((memoryIncrease.heapUsed / 1024 / 1024) / (totalResourcesLoaded / 1000)).toFixed(2)}`);
    console.log(`   Average ms per resource: ${(totalTime / totalResourcesLoaded).toFixed(2)}`);

    // Comparison with the 20-minute baseline
    console.log(`\n🔍 COMPARISON:`);
    console.log(`   Current approach: ${(totalTime / 60000).toFixed(2)} minutes`);
    console.log(`   Existing system: ~20 minutes (with threading issues)`);
    if (totalTime < 20 * 60 * 1000) {
      const improvement = ((20 * 60 * 1000 - totalTime) / (20 * 60 * 1000) * 100);
      console.log(`   Improvement: ${improvement.toFixed(1)}% faster`);
    }

    console.log(`\n💡 NOTES:`);
    console.log(`   All ${allLoadedResources.size} resources are retained in memory`);
    console.log(`   by url|version key to prevent garbage collection during measurement`);
    console.log(`   Run with --expose-gc flag to enable forced garbage collection`);
    console.log(`   Memory measurements reflect actual in-memory resource storage`);

    // Keep the map in scope until the very end
    console.log(`\n🗄️  Resource map contains ${allLoadedResources.size} entries`);

  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nTest interrupted by user');
  process.exit(0);
});

// Run the test
if (require.main === module) {
  console.log('📋 FHIR Package Loading Performance Test');
  console.log('This will fetch and load terminology packages to measure performance\n');

  loadPackagesAndMeasure()
    .then(() => {
      console.log('\n✅ Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error);
      process.exit(1);
    });
}

module.exports = { loadPackagesAndMeasure };