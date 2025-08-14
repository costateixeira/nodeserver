const inquirer = require('inquirer');
const chalk = require('chalk');
const cliProgress = require('cli-progress');
const fs = require('fs');
const path = require('path');
const { getConfigManager } = require('./tx-import-settings');

/**
 * Base class for terminology import modules
 * All terminology importers should extend this class
 */
class BaseTerminologyModule {
  constructor() {
    this.progressBar = null;
    this.configManager = getConfigManager();
  }

  // Abstract methods - must be implemented by subclasses
  getName() {
    throw new Error('getName() must be implemented by subclass');
  }

  getDescription() {
    throw new Error('getDescription() must be implemented by subclass');
  }

  registerCommands(terminologyCommand, globalOptions) {
    throw new Error('registerCommands() must be implemented by subclass');
  }

  // Optional methods - can be overridden by subclasses
  getSupportedFormats() {
    return ['txt', 'csv', 'tsv'];
  }

  getEstimatedDuration() {
    return 'varies';
  }

  getDefaultConfig() {
    return {
      verbose: true,
      overwrite: false,
      createIndexes: true
    };
  }

  // Common utility methods available to all modules
  async gatherCommonConfig(options = {}) {
    const terminology = this.getName();

    // Get intelligent defaults based on previous usage
    const smartDefaults = this.configManager.generateDefaults(terminology);
    const recentSources = this.configManager.getRecentSources(terminology, 3);

    const questions = [];

    // Source file/directory
    if (!options.source) {
      const sourceQuestion = {
        type: 'input',
        name: 'source',
        message: `Source file/directory for ${terminology}:`,
        validate: (input) => {
          if (!input) return 'Source is required';
          if (!fs.existsSync(input)) return 'Source path does not exist';
          return true;
        },
        filter: (input) => path.resolve(input)
      };

      // Add default if we have a previous source
      if (smartDefaults.source) {
        sourceQuestion.default = smartDefaults.source;
      }

      // If we have recent sources, offer them as choices
      if (recentSources.length > 0) {
        sourceQuestion.type = 'list';
        sourceQuestion.choices = [
          ...recentSources.map(src => ({
            name: `${src} ${src === smartDefaults.source ? '(last used)' : ''}`.trim(),
            value: src
          })),
          { name: 'Enter new path...', value: 'NEW_PATH' }
        ];
        sourceQuestion.message = `Select source for ${terminology}:`;

        // Follow up question for new path
        questions.push({
          type: 'input',
          name: 'source',
          message: `Enter new source path for ${terminology}:`,
          when: (answers) => answers.source === 'NEW_PATH',
          validate: sourceQuestion.validate,
          filter: sourceQuestion.filter
        });
      }

      questions.push(sourceQuestion);
    }

    // Destination database
    if (!options.dest) {
      questions.push({
        type: 'input',
        name: 'dest',
        message: 'Destination database path:',
        default: smartDefaults.dest || `./data/${terminology}.db`,
        validate: (input) => {
          if (!input) return 'Destination path is required';
          const dir = path.dirname(input);
          if (!fs.existsSync(dir)) {
            return `Directory does not exist: ${dir}`;
          }
          return true;
        },
        filter: (input) => path.resolve(input)
      });
    }

    // Overwrite confirmation
    questions.push({
      type: 'confirm',
      name: 'overwrite',
      message: 'Overwrite existing database if it exists?',
      default: smartDefaults.overwrite !== undefined ? smartDefaults.overwrite : false,
      when: (answers) => {
        const destPath = options.dest || answers.dest;
        return fs.existsSync(destPath);
      }
    });

    questions.push({
      type: 'confirm',
      name: 'verbose',
      message: 'Show verbose progress output?',
      default: smartDefaults.verbose !== undefined ? smartDefaults.verbose : true
    });

    const answers = await inquirer.prompt(questions);

    const finalConfig = {
      ...this.getDefaultConfig(),
      ...smartDefaults,
      ...options,
      ...answers
    };

    return finalConfig;
  }

  createProgressBar(format = null) {
    const defaultFormat = chalk.cyan('Progress') + ' |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s';

    this.progressBar = new cliProgress.SingleBar({
      format: format || defaultFormat,
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true
    });

    return this.progressBar;
  }

  updateProgress(current, total = null) {
    if (this.progressBar) {
      if (total !== null) {
        this.progressBar.start(total, current);
      } else {
        this.progressBar.update(current);
      }
    }
  }

  stopProgress() {
    if (this.progressBar) {
      this.progressBar.stop();
      this.progressBar = null;
    }
  }

  logInfo(message) {
    console.log(chalk.blue('ℹ'), message);
  }

  logSuccess(message) {
    console.log(chalk.green('✓'), message);
  }

  logWarning(message) {
    console.log(chalk.yellow('⚠'), message);
  }

  logError(message) {
    console.log(chalk.red('✗'), message);
  }

  async validatePrerequisites(config) {
    // Base validation - can be extended by subclasses
    const checks = [
      {
        name: 'Source exists',
        check: () => fs.existsSync(config.source)
      },
      {
        name: 'Destination directory writable',
        check: () => {
          const dir = path.dirname(config.dest);
          return fs.existsSync(dir);
        }
      }
    ];

    let allPassed = true;

    for (const { name, check } of checks) {
      try {
        const passed = await check();
        if (passed) {
          this.logSuccess(name);
        } else {
          this.logError(name);
          allPassed = false;
        }
      } catch (error) {
        this.logError(`${name}: ${error.message}`);
        allPassed = false;
      }
    }

    return allPassed;
  }

  // Helper method for batch processing with progress updates
  async processBatch(items, batchSize, processor, progressMessage = 'Processing') {
    const total = items.length;
    let processed = 0;

    this.createProgressBar(
      chalk.cyan(progressMessage) + ' |{bar}| {percentage}% | {value}/{total} items'
    );
    this.updateProgress(0, total);

    for (let i = 0; i < total; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await processor(batch);
      processed += batch.length;
      this.updateProgress(processed);
    }

    this.stopProgress();
    return processed;
  }

  // Abstract method for actual import logic
  async executeImport(config) {
    throw new Error('executeImport() must be implemented by subclass');
  }

  // Common import workflow
  async runImport(config) {
    try {
      console.log(chalk.blue.bold(`🏥 Starting ${this.getName()} Import...\n`));

      // Pre-flight checks
      this.logInfo('Running pre-flight checks...');
      const prerequisitesPassed = await this.validatePrerequisites(config);

      if (!prerequisitesPassed) {
        throw new Error('Pre-flight checks failed');
      }

      // Execute the import
      await this.executeImport(config);

      // Remember successful configuration for future use
      this.rememberSuccessfulConfig(config);

      this.logSuccess(`${this.getName()} import completed successfully!`);

    } catch (error) {
      this.stopProgress(); // Ensure progress bar is cleaned up
      this.logError(`${this.getName()} import failed: ${error.message}`);
      if (config.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  // Remember successful configuration
  rememberSuccessfulConfig(config) {
    try {
      const terminology = this.getName();

      // Remember the source path in recent sources
      if (config.source) {
        this.configManager.rememberSource(terminology, config.source);
      }

      // Remember the full configuration
      this.configManager.rememberConfig(terminology, config);

      this.logInfo('Configuration saved for future use');
    } catch (error) {
      // Don't fail the import if we can't save config
      this.logWarning(`Could not save configuration: ${error.message}`);
    }
  }
}

module.exports = { BaseTerminologyModule };