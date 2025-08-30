const fs = require('fs').promises;
const path = require('path');
const yaml = require('yaml'); // npm install yaml
const { PackageManager, PackageContentLoader } = require('../library/package-manager');
const { CodeSystem } = require("./library/codesystem");
const {CountryCodeFactoryProvider} = require("./cs/cs-country");
const {Iso4217FactoryProvider} = require("./cs/cs-currency");
const {AreaCodeFactoryProvider} = require("./cs/cs-areacode");
const {MimeTypeServicesFactory} = require("./cs/cs-mimetypes");
const {USStateFactoryProvider} = require("./cs/cs-usstates");
const {HGVSServicesFactory} = require("./cs/cs-hgvs");
const {UcumCodeSystemFactory} = require("./cs/cs-ucum");
const {UcumService} = require("./library/ucum-service");
const {readFileSync} = require("fs");
const https = require('https');
const http = require('http');
const {LoincServicesFactory} = require("./cs/cs-loinc");
const {RxNormServicesFactory} = require("./cs/cs-rxnorm");
const {NdcServicesFactory} = require("./cs/cs-ndc");
const {UniiServicesFactory} = require("./cs/cs-unii");
const {SnomedServicesFactory} = require("./cs/cs-snomed");
const {CPTServicesFactory} = require("./cs/cs-cpt");
const {OMOPServicesFactory} = require("./cs/cs-omop");
const {PackageValueSetProvider} = require("./vs/vs-package");
const {IETFLanguageCodeFactory} = require("./cs/cs-lang");
const {LanguageDefinitions} = require("../library/languages");
const {VersionUtilities} = require("../library/version-utilities");

class Provider {
  /**
   * {Map<String, CodeSystemFactoryProvider>} A list of code system factories that contains all the preloaded code systems
   */
  codeSystemFactories;

  /**
   * {Map<String, CodeSystem>} A list of preload code systems
   */
  codeSystems;

  /**
   * {List<AbstractValueSetProvider>} A list of value set providers that know how to provide value sets by request
   */
  valueSetProviders;

  baseUrl = null;
  cacheFolder = null;
  startTime = Date.now();
  startMemory = process.memoryUsage();
  lastTime = null;
  totalDownloaded = 0;

  registerProvider(source, factory, isDefault = false) {
    this.#logSystem(factory.system(), factory.version(), source);
    if (isDefault || !this.codeSystemFactories.has(factory.system())) {
      this.codeSystemFactories.set(factory.system(), factory);
    }
    this.codeSystemFactories.set(factory.system()+"|"+factory.version(), factory);
  }


  constructor(configFile) {
    this.configFile = configFile;
    // Only synchronous initialization here
    this.codeSystemFactories = new Map();
    this.codeSystems = new Map();
    this.valueSetProviders = [];
  }

  #logSystemHeader() {
    let time = "Time".padEnd(6);
    // let memory = " MB".padEnd(6);
    let system = "System".padEnd(50);
    let version = "Version".padEnd(62);
    let source = "Source"
    console.log(`${time}${system}${version}${source}`);
    this.lastTime = Date.now();
    // this.lastMemory = process.memoryUsage();
  }

  #logSystem(url, ver, source) {
    //const mem = process.memoryUsage();
    let time = Math.floor(Date.now() - this.lastTime).toString().padStart(5)+" ";
    let system = url.padEnd(50);
    let version = (ver == null ? "" : ver).padEnd(62);
    console.log(`${time}${system}${version}${source}`);
    this.lastTime = Date.now();
  }

  #logPackagesHeader() {
    let time = "Time".padEnd(6);
    //let memory = " MB".padEnd(6);
    let id = "ID".padEnd(20);
    let ver = "Version".padEnd(20);
    let cs = "CS".padEnd(6);
    let vs = "VS".padEnd(6);
    console.log(`${time}${id}${ver}${cs}${vs}`);
    this.lastTime = Date.now();
  }

  #logPackage(idp, verp, csp, vsp) {
    let time = Math.floor(Date.now() - this.lastTime).toString().padStart(5)+" ";
    let id = idp.padEnd(20);
    let ver = verp.padEnd(20);
    let cs = csp.toString().padEnd(6);
    let vs = vsp.toString().padEnd(6);
    console.log(`${time}${id}${ver}${cs}${vs}`);
    this.lastTime = Date.now();
  }

  async load() {
    this.startTime = Date.now();
    //this.startMemory = process.memoryUsage();
    const packageServers = ['https://packages2.fhir.org/packages'];
    this.cacheFolder = path.join(__dirname, '..', '.package-cache');
    const packageManager = new PackageManager(packageServers,  this.cacheFolder);

    // Read and parse YAML configuration
    const yamlPath = path.join(__dirname, '..', 'tx', 'tx.fhir.org.yml');
    const yamlContent = await fs.readFile(yamlPath, 'utf8');
    const config = yaml.parse(yamlContent);
    this.baseUrl = config.base.url;

    console.log('Fetching Data');

    for (const source of config.sources) {
      await this.processSource(source, packageManager, "fetch");
    }

    console.log("Downloaded "+((this.totalDownloaded + packageManager.totalDownloaded)/ 1024)+" kB");

    console.log('Loading Code Systems');
    this.#logSystemHeader();

    for (const source of config.sources) {
      await this.processSource(source, packageManager, "cs");
    }
    console.log('Loading Packages');
    this.#logPackagesHeader();

    for (const source of config.sources) {
      await this.processSource(source, packageManager, "npm");
    }

    const endMemory = process.memoryUsage();
    const totalTime = Date.now() - this.startTime;

    const memoryIncrease = {
      rss: endMemory.rss - this.startMemory.rss,
      heapUsed: endMemory.heapUsed - this.startMemory.heapUsed,
      heapTotal: endMemory.heapTotal - this.startMemory.heapTotal,
      external: endMemory.external - this.startMemory.external
    };

    console.log(`Loading Time: ${(totalTime / 1000).toLocaleString()}s`);
    console.log(`Memory Used: ${(memoryIncrease.rss / 1024 / 1024).toFixed(2)} MB`);
  }

  async processSource(source, packageManager, mode) {
    // Parse the source string
    const colonIndex = source.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Invalid source format: ${source}`);
    }

    let type = source.substring(0, colonIndex);
    const details = source.substring(colonIndex + 1);

    // Handle special markers (like ! for default)
    let isDefault = false;
    if (type.endsWith('!')) {
      type = type.slice(0, -1);
      isDefault = true;
    }

    // Switch statement for different source types
    switch (type) {
      case 'internal':
        await this.loadInternal(details, isDefault, mode);
        break;

      case 'ucum':
        await this.loadUcum(details, isDefault, mode);
        break;

      case 'loinc':
        await this.loadLoinc(details, isDefault, mode);
        break;

      case 'rxnorm':
        await this.loadRxnorm(details, isDefault, mode);
        break;

      case 'ndc':
        await this.loadNdc(details, isDefault, mode);
        break;

      case 'unii':
        await this.loadUnii(details, isDefault, mode);
        break;

      case 'snomed':
        await this.loadSnomed(details, isDefault, mode);
        break;

      case 'cpt':
        await this.loadCpt(details, isDefault, mode);
        break;

      case 'omop':
        await this.loadOmop(details, isDefault, mode);
        break;

      case 'npm':
        await this.loadNpm(packageManager, details, isDefault, mode);
        break;

      default:
        throw new Error(`Unknown source type: ${type}`);
    }
  }

  async loadInternal(details, isDefault, mode) {
    if (isDefault) {
      throw new Error("Default is not supported for internal code system providers");
    }
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    switch (details) {
      case "country" : {
        const cc = new CountryCodeFactoryProvider();
        await cc.load();
        this.registerProvider('internal', cc);
        break;
      }
      case "lang" : {
        const langDefs = path.join(__dirname, '../tx/data/lang.dat');
        const definitions = await LanguageDefinitions.fromFile(langDefs);
        const langs = new IETFLanguageCodeFactory(definitions);
        await langs.load();
        this.registerProvider('internal', langs);
        break;
      }
      case "currency" : {
        const curr = new Iso4217FactoryProvider();
        await curr.load();
        this.registerProvider('internal', curr);
        break;
      }
      case "areacode" : {
        const ac = new AreaCodeFactoryProvider();
        await ac.load();
        this.registerProvider('internal', ac);
        break;
      }
      case "mimetypes" : {
        const mime = new MimeTypeServicesFactory();
        await mime.load();
        this.registerProvider('internal', mime);
        break;
      }
      case "usstates" : {
        const uss = new USStateFactoryProvider();
        await uss.load();
        this.registerProvider('internal', uss);
        break;
      }
      case "hgvs" : {
        const hgvs = new HGVSServicesFactory();
        await hgvs.load();
        this.registerProvider('internal', hgvs);
        break;
      }
      default:
        throw new Error("Unknown Internal Provider "+details);
    }
  }

  async loadUcum(details, isDefault, mode) {
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const source = path.join(__dirname, '..', details);

    const ucumEssenceXml = readFileSync(source, 'utf8');
    const ucumService = new UcumService();
    await ucumService.init(ucumEssenceXml);

    const ucum = new UcumCodeSystemFactory(ucumService);
    await ucum.load();
    this.registerProvider(source, ucum, isDefault);
  }

  async loadLoinc(details, isDefault, mode) {
    const loincFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }

    const loinc = new LoincServicesFactory(loincFN);
    await loinc.load();
    this.registerProvider(loincFN, loinc, isDefault);
  }

  async loadRxnorm(details, isDefault, mode) {
    const rxNormFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const rxn = new RxNormServicesFactory(rxNormFN);
    await rxn.load();
    this.registerProvider(rxNormFN, rxn, isDefault);
  }

  async loadNdc(details, isDefault, mode) {
    const ndcFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const ndc = new NdcServicesFactory(ndcFN);
    await ndc.load();
    this.registerProvider(ndcFN, ndc, isDefault);
  }

  async loadUnii(details, isDefault, mode) {
    const uniFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const unii = new UniiServicesFactory(uniFN);
    await unii.load();
    this.registerProvider(uniFN, unii, isDefault);
  }

  async loadSnomed(details, isDefault, mode) {
    const sctFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const sct = new SnomedServicesFactory(sctFN);
    await sct.load();
    this.registerProvider(sctFN, sct, isDefault);
  }

  async loadCpt(details, isDefault, mode) {
    const cptFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const cpt = new CPTServicesFactory(cptFN);
    await cpt.load();
    this.registerProvider(cptFN, cpt, isDefault);
  }

  async loadOmop(details, isDefault, mode) {
    const omopFN = await this.getOrDownloadFile(details);
    if (mode === "fetch" || mode === "npm") {
      return;
    }
    const omop = new OMOPServicesFactory(omopFN);
    await omop.load();
    this.registerProvider(omopFN, omop, isDefault);
  }

  async loadNpm(packageManager, details, isDefault, mode) {
    const packagePath = await packageManager.fetch(details, null);
    if (mode === "fetch" || mode === "cs") {
      return;
    }
    const fullPackagePath = path.join(this.cacheFolder, packagePath);
    const contentLoader = new PackageContentLoader(fullPackagePath);
    await contentLoader.initialize();
    const resources = await contentLoader.getResourcesByType("CodeSystem");
    let csc = 0;
    for (const resource of resources) {
      const cs = await contentLoader.loadFile(resource, contentLoader.fhirVersion());
      this.codeSystems.set(cs.url, new CodeSystem(cs));
      csc++;
    }
    const vs = new PackageValueSetProvider(contentLoader);
    await vs.initialize();
    this.valueSetProviders.push(vs);

    this.#logPackage(contentLoader.id(), contentLoader.version(), csc, vs.valueSetMap.size);
  }

  /**
   * Gets a file from local folder or downloads it from URL
   * @param {string} fileName - Name of the file
   * @returns {Promise<string>} Full path to the file
   * @throws {Error} If file cannot be downloaded or accessed
   */
  async getOrDownloadFile(fileName) {
    // Ensure folder exists
    await this.ensureFolderExists(this.cacheFolder);

    const filePath = path.join(this.cacheFolder, fileName);

    // Check if file already exists
    if (await this.fileExists(filePath)) {
      return filePath;
    }

    // File doesn't exist, download it
    console.log(`Downloading: ${fileName}`);

    const downloadUrl = this.baseUrl.endsWith('/') ? this.baseUrl + fileName : this.baseUrl + '/' + fileName;

    try {
      await this.downloadFile(downloadUrl, filePath);
      return filePath;
    } catch (error) {
      throw new Error(`Failed to download file ${fileName} from ${downloadUrl}: ${error.message}`);
    }
  }

  /**
   * Check if a file exists
   * @param {string} filePath - Path to check
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a folder exists, create it if it doesn't
   * @param {string} folderPath - Path to folder
   */
  async ensureFolderExists(folderPath) {
    try {
      await fs.mkdir(folderPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to create folder ${folderPath}: ${error.message}`);
      }
    }
  }

  /**
   * Download a file from URL to local path
   * @param {string} url - URL to download from
   * @param {string} filePath - Local path to save file
   * @returns {Promise<void>}
   */
  async downloadFile(url, filePath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https:') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.downloadFile(response.headers.location, filePath)
            .then(resolve)
            .catch(reject);
        }

        // Check for successful response
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // Create write stream
        const fileStream = require('fs').createWriteStream(filePath);

        // Handle stream errors
        fileStream.on('error', (error) => {
          reject(new Error(`Failed to write file: ${error.message}`));
        });

        // Handle download completion
        fileStream.on('finish', () => {
          fileStream.close();
          const statsFs = require('fs').statSync(filePath);
          this.totalDownloaded = this.totalDownloaded + statsFs.size;
          resolve();
        });

        // Pipe response to file
        response.pipe(fileStream);

      }).on('error', (error) => {
        reject(new Error(`Download request failed: ${error.message}`));
      });

      // Set timeout for request
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout (30 seconds)'));
      });
    });
  }

  /**
   * Creates a clone of this provider with FHIR core packages for the specified version
   * @param {string} fhirVersion - FHIR version (e.g., '4.0.1', '5.0.0')
   * @returns {Promise<Provider>} New provider instance with FHIR packages loaded
   */
  async cloneWithFhirVersion(fhirVersion) {
    // Create new provider instance
    const clonedProvider = new Provider(this.configFile);

    // Clone the maps/arrays (shallow clone of containers, but same underlying objects)
    clonedProvider.codeSystemFactories = new Map(this.codeSystemFactories);
    clonedProvider.codeSystems = new Map(this.codeSystems);
    // Don't clone valueSetProviders yet - we'll build it with correct order

    // Copy other properties
    clonedProvider.baseUrl = this.baseUrl;
    clonedProvider.cacheFolder = this.cacheFolder;
    clonedProvider.startTime = this.startTime;
    clonedProvider.startMemory = this.startMemory;
    clonedProvider.lastTime = this.lastTime;
    clonedProvider.lastMemory = this.lastMemory;
    clonedProvider.totalDownloaded = this.totalDownloaded;

    // Create package manager for FHIR packages
    const packageServers = ['https://packages2.fhir.org/packages'];
    const packageManager = new PackageManager(packageServers, this.cacheFolder);

    // Load FHIR core packages first
    const fhirPackages = this.#getFhirPackagesForVersion(fhirVersion);

    console.log(`Loading FHIR ${fhirVersion} packages`);
    clonedProvider.#logPackagesHeader();

    // Load FHIR packages - these will be added to valueSetProviders first
    for (const packageId of fhirPackages) {
      await clonedProvider.loadNpm(packageManager, packageId, false, "npm");
    }

    // Now add the existing value set providers after the FHIR core packages
    clonedProvider.valueSetProviders.push(...this.valueSetProviders);

    return clonedProvider;
  }

  /**
   * Gets the list of FHIR packages for a specific version
   * @param {string} fhirVersion - FHIR version
   * @returns {string} Package Id
   * @private
   */
  #getFhirPackagesForVersion(ver) {
    if (VersionUtilities.isR3Ver(ver)) {
      return ["hl7.fhir.r3.core"];
    }
    if (VersionUtilities.isR4Ver(ver) ||VersionUtilities.isR4BVer(ver)) {
      return ["hl7.fhir.r4.core"];
    }
    if (VersionUtilities.isR5Ver(ver)) {
      return ["hl7.fhir.r5.core"];
    }
    throw new Error(`Unsupported FHIR version: ${ver}. Supported versions: R3, R4, R5`);
  }
}

module.exports = { Providers: Provider };