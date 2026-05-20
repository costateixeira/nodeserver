//
// Atom syndication consumer (Phase 2).
//
// Given an Atom feed URL, fetches the feed, downloads every <entry>'s
// enclosure into the terminology-cache folder, and returns a list of
// virtual `library.yml` source lines that point at the now-cached
// artifacts. The caller (Library.processSource for `atom:` sources)
// then runs the existing per-type loaders against those sub-sources.
//
// Recognised <category term="..."> values match the Phase 1 producer:
//   fhir-package      -> NPM package (.tgz)            -> "npm:<id>#<ver>"
//   snomed-cache      -> SNOMED .cache binary          -> "snomed:<filename>"
//   terminology-db    -> SQLite .db binary             -> "<loinc|rxnorm|...>:<filename>"
//   xml-resource      -> UCUM / similar XML            -> "ucum:<relative-path>"
//
// Entries with unknown categories are skipped with a warning.
//

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const stream = require('stream');
const zlib = require('zlib');
const tar = require('tar');
const { XMLParser } = require('fast-xml-parser');

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

class AtomConsumer {
  /**
   * @param {string} cacheFolder - absolute path to the terminology-cache folder
   * @param {object} log         - logger with .info/.warn/.error
   */
  constructor(cacheFolder, log) {
    this.cacheFolder = cacheFolder;
    this.log = log;
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true, // strip sy:, fs:, atom: prefixes for easier access
    });
  }

  /**
   * Fetch an Atom feed and resolve every entry into a cached artifact.
   * @param {string} feedUrl
   * @returns {Promise<string[]>} virtual source lines for downstream processSource
   */
  async expand(feedUrl) {
    this.log.info(`Atom feed: ${feedUrl}`);
    const response = await axios.get(feedUrl, {
      responseType: 'text',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    const parsed = this.parser.parse(response.data);
    const entries = this.#asArray(parsed.feed?.entry);

    const sources = [];
    for (const entry of entries) {
      try {
        const sub = await this.#processEntry(entry, feedUrl);
        if (sub) sources.push(sub);
      } catch (err) {
        const title = entry?.title || '<no title>';
        this.log.warn(`  skipping entry "${title}": ${err.message}`);
      }
    }
    return sources;
  }

  // ---------- per-entry ----------

  async #processEntry(entry, feedBase) {
    const category = this.#firstCategoryTerm(entry.category);
    const enclosure = this.#findEnclosure(entry.link);
    if (!enclosure) throw new Error('no <link rel="alternate">');

    const downloadUrl = this.#resolveUrl(enclosure['@_href'], feedBase);

    switch (category) {
      case 'fhir-package':
        return await this.#handlePackage(entry, downloadUrl);
      case 'snomed-cache':
        return await this.#handleBinary(downloadUrl, 'snomed');
      case 'terminology-db':
        return await this.#handleBinary(downloadUrl, this.#guessDbType(downloadUrl));
      case 'xml-resource':
        return await this.#handleBinary(downloadUrl, 'ucum');
      default:
        throw new Error(`unsupported category "${category}"`);
    }
  }

  async #handlePackage(entry, url) {
    const version = entry.contentItemVersion;
    if (!version) throw new Error('package entry missing <sy:contentItemVersion>');

    // Derive package id. Producer URLs follow .../packages/<id>/<version>/package.tgz.
    let id = null;
    const m = url.match(/\/packages\/([^/]+)\/[^/]+\/package\.tgz(?:\?.*)?$/);
    if (m) id = decodeURIComponent(m[1]);
    // Fallback: sy:contentItemIdentifier may carry the id directly (non-URL form)
    if (!id) {
      const ident = entry.contentItemIdentifier;
      if (ident && !/^https?:/.test(ident)) id = ident;
    }
    if (!id) throw new Error('cannot determine package id from URL or identifier');

    const cacheKey = `${id}#${version}`;
    const cacheDir = path.join(this.cacheFolder, cacheKey);

    if (await this.#exists(cacheDir)) {
      this.log.info(`  cached: ${cacheKey}`);
    } else {
      this.log.info(`  fetching: ${cacheKey} (${url})`);
      await this.#downloadAndExtractTgz(url, cacheDir);
    }
    return `npm:${id}#${version}`;
  }

  async #handleBinary(url, sourceType) {
    const filename = this.#basename(url);
    if (!filename) throw new Error(`cannot derive filename from URL: ${url}`);
    const dest = path.join(this.cacheFolder, filename);

    if (await this.#exists(dest)) {
      this.log.info(`  cached: ${filename}`);
    } else {
      this.log.info(`  fetching: ${filename} (${url})`);
      await this.#downloadToFile(url, dest);
    }
    return `${sourceType}:${filename}`;
  }

  // ---------- IO ----------

  async #downloadToFile(url, dest) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    await fs.writeFile(dest, Buffer.from(response.data));
  }

  async #downloadAndExtractTgz(url, destDir) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: DOWNLOAD_TIMEOUT_MS,
    });
    await fs.mkdir(destDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const extract = tar.extract({ cwd: destDir });
      stream.Readable.from(Buffer.from(response.data))
        .pipe(gunzip)
        .pipe(extract)
        .on('finish', resolve)
        .on('error', reject);
      gunzip.on('error', reject);
      extract.on('error', reject);
    });
  }

  // ---------- helpers ----------

  #asArray(v) {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
  }

  #firstCategoryTerm(categoryNode) {
    const arr = this.#asArray(categoryNode);
    for (const c of arr) {
      if (c && c['@_term']) return c['@_term'];
    }
    return null;
  }

  #findEnclosure(linkNode) {
    const arr = this.#asArray(linkNode);
    return arr.find(l => (l['@_rel'] || 'alternate') === 'alternate') || arr[0] || null;
  }

  #resolveUrl(href, base) {
    if (!href) return null;
    if (/^https?:/.test(href)) return href;
    return new URL(href, base).toString();
  }

  #basename(url) {
    try {
      const u = new URL(url);
      const last = u.pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : null;
    } catch {
      return null;
    }
  }

  #guessDbType(url) {
    const lower = this.#basename(url)?.toLowerCase() || '';
    if (lower.includes('loinc')) return 'loinc';
    if (lower.includes('rxnorm')) return 'rxnorm';
    if (lower.includes('ndc')) return 'ndc';
    if (lower.includes('unii')) return 'unii';
    if (lower.includes('cpt')) return 'cpt';
    if (lower.includes('omop')) return 'omop';
    return 'loinc'; // default; operator can rename the file or override
  }

  async #exists(p) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = AtomConsumer;
