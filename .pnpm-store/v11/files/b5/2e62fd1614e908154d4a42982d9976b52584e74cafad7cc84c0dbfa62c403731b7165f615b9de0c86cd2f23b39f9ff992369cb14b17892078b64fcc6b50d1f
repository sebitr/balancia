'use strict';

var fs$1 = require('fs/promises');
var path = require('path');
var watcher = require('@parcel/watcher');
var fs = require('fs');
var module$1 = require('module');
var core = require('@swc/core');

var _documentCurrentScript = typeof document !== 'undefined' ? document.currentScript : null;
function _interopDefaultCompat (e) { return e && typeof e === 'object' && 'default' in e ? e : { default: e }; }

var fs__default$1 = /*#__PURE__*/_interopDefaultCompat(fs$1);
var path__default = /*#__PURE__*/_interopDefaultCompat(path);
var fs__default = /*#__PURE__*/_interopDefaultCompat(fs);

function formatMessage(message) {
  return `\n[next-intl] ${message}\n`;
}
function throwError(message) {
  throw new Error(formatMessage(message));
}
function warn(message) {
  console.warn(formatMessage(message));
}

/**
 * Returns a function that runs the provided callback only once per process.
 * Next.js can call the config multiple times - this ensures we only run once.
 * Uses an environment variable to track execution across config loads.
 */
function once(namespace) {
  return function runOnce(fn) {
    if (process.env[namespace] === '1') {
      return;
    }
    process.env[namespace] = '1';
    fn();
  };
}

function stripTrailingSlash(dirPath) {
  if (dirPath.endsWith('/')) {
    return dirPath.slice(0, -1);
  } else {
    return dirPath;
  }
}
function normalizeMessagesCatalogPaths(messagesPath) {
  const rawPaths = Array.isArray(messagesPath) ? messagesPath : [messagesPath];
  return rawPaths.map(dirPath => stripTrailingSlash(String(dirPath).trim())).filter(dirPath => dirPath.length > 0);
}
function normalizeExtractorConfig(input) {
  if (input.messages == null) {
    throwError('`messages` is required when extracting messages.');
  }
  const extract = input.extract;
  let extractPath;
  let sourceLocale;
  if (extract !== undefined && extract !== true) {
    if (extract.sourceLocale) {
      warn('`extract.sourceLocale` is deprecated in favor of `messages.sourceLocale`.');
      sourceLocale = extract.sourceLocale;
    }
    if (extract.path) {
      extractPath = stripTrailingSlash(extract.path);
    }
  }
  const locales = input.messages.locales;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!locales) {
    throwError('`messages.locales` is required when extracting messages.');
  }
  if (input.messages.sourceLocale) {
    sourceLocale = input.messages.sourceLocale;
  }
  if (!sourceLocale) {
    throwError('`messages.sourceLocale` is required when extracting messages.');
  }
  const srcPath = input.srcPath;
  if (srcPath == null) {
    throwError('`srcPath` is required when extracting messages.');
  }
  const pathIsArray = Array.isArray(input.messages.path);
  const messagesPath = normalizeMessagesCatalogPaths(input.messages.path);
  if (messagesPath.length === 0) {
    throwError('`messages.path` must not be empty.');
  }
  if (extractPath == null) {
    if (pathIsArray) {
      throwError('When `messages.path` is an array, `extract.path` is required to select the writable catalog directory.');
    }
    extractPath = messagesPath[0];
  }
  return {
    extract: {
      locales,
      path: extractPath,
      sourceLocale,
      srcPath
    },
    messages: {
      format: input.messages.format,
      path: messagesPath
    }
  };
}

/**
 * Wrapper around `fs.watch` that provides a workaround
 * for https://github.com/nodejs/node/issues/5039.
 */
function watchFile(filepath, callback) {
  const directory = path__default.default.dirname(filepath);
  const filename = path__default.default.basename(filepath);
  return fs__default.default.watch(directory, {
    persistent: false,
    recursive: false
  }, (event, changedFilename) => {
    if (changedFilename === filename) {
      callback();
    }
  });
}

const runOnce$1 = once('_NEXT_INTL_COMPILE_MESSAGES');
function createMessagesDeclaration(messagesPaths) {
  // Instead of running _only_ in certain cases, it's
  // safer to _avoid_ running for certain known cases.
  // https://github.com/amannn/next-intl/issues/2006
  const shouldBailOut = ['info', 'start'

  // Note: These commands don't consult the
  // Next.js config, so we can't detect them here.
  // - telemetry (however, the `detached-flush` DOES - see `createNextIntlPlugin`)
  // - lint
  //
  // What remains are:
  // - dev
  // - build
  // - typegen
  ].some(arg => process.argv.includes(arg));
  if (shouldBailOut) {
    return;
  }
  runOnce$1(() => {
    for (const messagesPath of messagesPaths) {
      const fullPath = path__default.default.resolve(messagesPath);
      if (!fs__default.default.existsSync(fullPath)) {
        throwError(`\`createMessagesDeclaration\` points to a non-existent file: ${fullPath}`);
      }
      if (!fullPath.endsWith('.json')) {
        throwError(`\`createMessagesDeclaration\` needs to point to a JSON file. Received: ${fullPath}`);
      }

      // Keep this as a runtime check and don't replace
      // this with a constant during the build process
      const env = process.env['NODE_ENV'.trim()];
      compileDeclaration(messagesPath);
      if (env === 'development') {
        startWatching(messagesPath);
      }
    }
  });
}
function startWatching(messagesPath) {
  const watcher = watchFile(messagesPath, () => {
    compileDeclaration(messagesPath, true);
  });
  process.on('exit', () => {
    watcher.close();
  });
}
function compileDeclaration(messagesPath, async = false) {
  const declarationPath = messagesPath.replace(/\.json$/, '.d.json.ts');
  function createDeclaration(content) {
    return `// This file is auto-generated by next-intl, do not edit directly.
// See: https://next-intl.dev/docs/workflows/typescript#messages-arguments

declare const messages: ${content.trim()};
export default messages;`;
  }
  if (async) {
    return fs__default.default.promises.readFile(messagesPath, 'utf-8').then(content => fs__default.default.promises.writeFile(declarationPath, createDeclaration(content)));
  }
  const content = fs__default.default.readFileSync(messagesPath, 'utf-8');
  fs__default.default.writeFileSync(declarationPath, createDeclaration(content));
}

const formats = {
  json: {
    codec: () => Promise.resolve().then(function () { return require('./JSONCodec-CzA8ubPy.cjs'); }),
    extension: '.json'
  },
  po: {
    codec: () => Promise.resolve().then(function () { return require('./POCodec-CWGHK-Gp.cjs'); }),
    extension: '.po'
  }
};
function isBuiltInFormat(format) {
  return typeof format === 'string' && format in formats;
}
function getFormatExtension(format) {
  if (isBuiltInFormat(format)) {
    return formats[format].extension;
  } else {
    return format.extension;
  }
}
async function resolveCodec(format, projectRoot) {
  if (isBuiltInFormat(format)) {
    const factory = (await formats[format].codec()).default;
    return factory();
  } else {
    const resolvedPath = path__default.default.isAbsolute(format.codec) ? format.codec : path__default.default.resolve(projectRoot, format.codec);
    let module;
    try {
      module = await import(resolvedPath);
    } catch (error) {
      throwError(`Could not load codec from "${resolvedPath}".\n${error}`);
    }
    const factory = module.default;
    if (!factory || typeof factory !== 'function') {
      throwError(`Codec at "${resolvedPath}" must have a default export returned from \`defineCodec\`.`);
    }
    return factory();
  }
}

class SourceFileFilter {
  static EXTENSIONS = ['ts', 'tsx', 'js', 'jsx'];

  // Will not be entered, except if explicitly asked for
  // TODO: At some point we should infer these from .gitignore
  static IGNORED_DIRECTORIES = ['node_modules', '.next', '.git'];
  static isSourceFile(filePath) {
    const ext = path__default.default.extname(filePath);
    return SourceFileFilter.EXTENSIONS.map(cur => '.' + cur).includes(ext);
  }
  static shouldEnterDirectory(dirPath, srcPaths) {
    const dirName = path__default.default.basename(dirPath);
    if (SourceFileFilter.IGNORED_DIRECTORIES.includes(dirName)) {
      return SourceFileFilter.isIgnoredDirectoryExplicitlyIncluded(dirPath, srcPaths);
    }
    return true;
  }
  static isIgnoredDirectoryExplicitlyIncluded(ignoredDirPath, srcPaths) {
    return srcPaths.some(srcPath => SourceFileFilter.isWithinPath(srcPath, ignoredDirPath));
  }
  static isWithinPath(targetPath, basePath) {
    const relativePath = path__default.default.relative(basePath, targetPath);
    return relativePath === '' || !relativePath.startsWith('..');
  }
}

class SourceFileScanner {
  static async walkSourceFiles(dir, srcPaths, acc = []) {
    const entries = await fs__default$1.default.readdir(dir, {
      withFileTypes: true
    });
    for (const entry of entries) {
      const entryPath = path__default.default.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SourceFileFilter.shouldEnterDirectory(entryPath, srcPaths)) {
          continue;
        }
        await SourceFileScanner.walkSourceFiles(entryPath, srcPaths, acc);
      } else {
        if (SourceFileFilter.isSourceFile(entry.name)) {
          acc.push(entryPath);
        }
      }
    }
    return acc;
  }
  static async getSourceFiles(srcPaths) {
    const files = (await Promise.all(srcPaths.map(srcPath => SourceFileScanner.walkSourceFiles(srcPath, srcPaths)))).flat();
    return new Set(files);
  }
}

class SourceFileWatcher {
  subscriptions = [];
  constructor(roots, onChange) {
    this.roots = roots;
    this.onChange = onChange;
  }
  async start() {
    if (this.subscriptions.length > 0) {
      return;
    }
    const ignore = SourceFileFilter.IGNORED_DIRECTORIES.map(dir => `**/${dir}/**`);
    for (const root of this.roots) {
      const sub = await watcher.subscribe(root, async (err, events) => {
        if (err) {
          console.error(err);
          return;
        }
        const filtered = await this.normalizeEvents(events);
        if (filtered.length > 0) {
          await this.onChange(filtered);
        }
      }, {
        ignore
      });
      this.subscriptions.push(sub);
    }
  }
  async normalizeEvents(events) {
    const directoryCreatePaths = [];
    const otherEvents = [];

    // We need to expand directory creates because during rename operations,
    // @parcel/watcher emits a directory create event but may not emit individual
    // file events for the moved files
    await Promise.all(events.map(async event => {
      if (event.type === 'create') {
        try {
          const stats = await fs__default$1.default.stat(event.path);
          if (stats.isDirectory()) {
            directoryCreatePaths.push(event.path);
            return;
          }
        } catch {
          // Path doesn't exist or is inaccessible, treat as file
        }
      }
      otherEvents.push(event);
    }));

    // Expand directory create events to find source files inside
    let expandedCreateEvents = [];
    if (directoryCreatePaths.length > 0) {
      try {
        const sourceFiles = await SourceFileScanner.getSourceFiles(directoryCreatePaths);
        expandedCreateEvents = Array.from(sourceFiles).map(filePath => ({
          type: 'create',
          path: filePath
        }));
      } catch {
        // Directories might have been deleted or are inaccessible
      }
    }

    // Combine original events with expanded directory creates.
    // Deduplicate by path to avoid processing the same file twice
    // in case @parcel/watcher also emitted individual file events.
    const allEvents = [...otherEvents, ...expandedCreateEvents];
    const seenPaths = new Set();
    const deduplicated = [];
    for (const event of allEvents) {
      const key = `${event.type}:${event.path}`;
      if (!seenPaths.has(key)) {
        seenPaths.add(key);
        deduplicated.push(event);
      }
    }
    return deduplicated.filter(event => {
      // Keep all delete events (might be deleted directories that no longer exist)
      if (event.type === 'delete') {
        return true;
      }
      // Keep source files
      return SourceFileFilter.isSourceFile(event.path);
    });
  }
  async expandDirectoryDeleteEvents(events, prevKnownFiles) {
    const expanded = [];
    for (const event of events) {
      if (event.type === 'delete' && !SourceFileFilter.isSourceFile(event.path)) {
        const dirPath = path__default.default.resolve(event.path);
        const filesInDirectory = [];
        for (const filePath of prevKnownFiles) {
          if (SourceFileFilter.isWithinPath(filePath, dirPath)) {
            filesInDirectory.push(filePath);
          }
        }

        // If we found files within this path, it was a directory
        if (filesInDirectory.length > 0) {
          for (const filePath of filesInDirectory) {
            expanded.push({
              type: 'delete',
              path: filePath
            });
          }
        } else {
          // Not a directory or no files in it, pass through as-is
          expanded.push(event);
        }
      } else {
        // Pass through as-is
        expanded.push(event);
      }
    }
    return expanded;
  }
  async stop() {
    await Promise.all(this.subscriptions.map(sub => sub.unsubscribe()));
    this.subscriptions = [];
  }
  [Symbol.dispose]() {
    void this.stop();
  }
}

function normalizePathToPosix(filePath) {
  // `path.relative` uses OS-specific separators. For stable `.po` references we
  // always use POSIX separators, regardless of the OS that ran extraction.
  return path__default.default.posix.normalize(filePath.split(path__default.default.win32.sep).join(path__default.default.posix.sep));
}
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function isForbiddenObjectKey(key) {
  return FORBIDDEN_OBJECT_KEYS.has(key);
}
function hasLocalesToExtract(config) {
  const {
    locales
  } = config.extract;
  return locales === 'infer' || locales.length > 0;
}

// Essentialls lodash/set, but we avoid this dependency
function setNestedProperty(obj, keyPath, value) {
  const keys = keyPath.split('.');
  for (const key of keys) {
    if (isForbiddenObjectKey(key)) {
      throw new Error(`Invalid message id segment: ${key}`);
    }
  }
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(current, key) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = Object.create(null);
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}
function getSortedMessages(messages) {
  const warnedMissingReferenceIds = new Set();
  return messages.toSorted((messageA, messageB) => {
    const refA = messageA.references[0];
    const refB = messageB.references[0];

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refA == null) {
      warnAboutMissingReference(messageA.id, warnedMissingReferenceIds);
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refB == null) {
      warnAboutMissingReference(messageB.id, warnedMissingReferenceIds);
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (refA == null || refB == null) {
      return 0;
    }

    // Sort by path, then line. Same path+line: preserve original order
    return compareReferences(refA, refB);
  });
}
function warnAboutMissingReference(id, warnedMissingReferenceIds) {
  if (warnedMissingReferenceIds.has(id)) return;
  warnedMissingReferenceIds.add(id);
  warn(`Missing file reference for extracted message: ${id}`);
}
function localeCompare(a, b) {
  return a.localeCompare(b, 'en');
}
function compareReferences(refA, refB) {
  const pathCompare = localeCompare(refA.path, refB.path);
  if (pathCompare !== 0) return pathCompare;
  return (refA.line ?? 0) - (refB.line ?? 0);
}
function getDefaultProjectRoot() {
  return process.cwd();
}

class CatalogLocales {
  onChangeCallbacks = new Set();
  constructor(params) {
    this.messagesDir = params.messagesDir;
    this.sourceLocale = params.sourceLocale;
    this.extension = params.extension;
    this.locales = params.locales;
  }
  async getTargetLocales() {
    if (this.targetLocales) {
      return this.targetLocales;
    }
    if (this.locales === 'infer') {
      this.targetLocales = await this.readTargetLocales();
    } else {
      this.targetLocales = this.locales.filter(locale => locale !== this.sourceLocale);
    }
    return this.targetLocales;
  }
  async readTargetLocales() {
    try {
      const files = await fs__default$1.default.readdir(this.messagesDir);
      return files.filter(file => file.endsWith(this.extension)).map(file => path__default.default.basename(file, this.extension)).filter(locale => locale !== this.sourceLocale);
    } catch {
      return [];
    }
  }
  subscribeLocalesChange(callback) {
    this.onChangeCallbacks.add(callback);
    if (this.locales === 'infer' && !this.watcher) {
      void this.startWatcher();
    }
  }
  unsubscribeLocalesChange(callback) {
    this.onChangeCallbacks.delete(callback);
    if (this.onChangeCallbacks.size === 0) {
      this.stopWatcher();
    }
  }
  async startWatcher() {
    if (this.watcher) {
      return;
    }
    await fs__default$1.default.mkdir(this.messagesDir, {
      recursive: true
    });
    this.watcher = fs__default.default.watch(this.messagesDir, {
      persistent: false,
      recursive: false
    }, (event, filename) => {
      const isCatalogFile = filename != null && filename.endsWith(this.extension) && !filename.includes(path__default.default.sep);
      if (isCatalogFile) {
        void this.onChange();
      }
    });
  }
  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
  async onChange() {
    const oldLocales = new Set(this.targetLocales || []);
    this.targetLocales = await this.readTargetLocales();
    const newLocalesSet = new Set(this.targetLocales);
    const added = this.targetLocales.filter(locale => !oldLocales.has(locale));
    const removed = Array.from(oldLocales).filter(locale => !newLocalesSet.has(locale));
    if (added.length > 0 || removed.length > 0) {
      for (const callback of this.onChangeCallbacks) {
        callback({
          added,
          removed
        });
      }
    }
  }
}

class CatalogPersister {
  constructor(params) {
    this.messagesPath = params.messagesPath;
    this.codec = params.codec;
    this.extension = params.extension;
  }
  getFileName(locale) {
    return locale + this.extension;
  }
  getFilePath(locale) {
    return path__default.default.join(this.messagesPath, this.getFileName(locale));
  }
  async read(locale) {
    const filePath = this.getFilePath(locale);
    let content;
    try {
      content = await fs__default$1.default.readFile(filePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw new Error(`Error while reading ${this.getFileName(locale)}:\n> ${error}`, {
        cause: error
      });
    }
    try {
      return this.codec.decode(content, {
        locale
      });
    } catch (error) {
      throw new Error(`Error while decoding ${this.getFileName(locale)}:\n> ${error}`, {
        cause: error
      });
    }
  }
  async write(messages, context) {
    const filePath = this.getFilePath(context.locale);
    const content = this.codec.encode(messages, context);
    try {
      const outputDir = path__default.default.dirname(filePath);
      await fs__default$1.default.mkdir(outputDir, {
        recursive: true
      });
      await fs__default$1.default.writeFile(filePath, content);
    } catch (error) {
      console.error(`❌ Failed to write catalog: ${error}`);
    }
  }
  async getLastModified(locale) {
    const filePath = this.getFilePath(locale);
    try {
      const stats = await fs__default$1.default.stat(filePath);
      return stats.mtime;
    } catch {
      return undefined;
    }
  }
}

/**
 * De-duplicates excessive save invocations,
 * while keeping a single one instant.
 */
class SaveScheduler {
  isSaving = false;
  pendingResolvers = [];
  constructor(delayMs = 50) {
    this.delayMs = delayMs;
  }
  async schedule(saveTask) {
    return new Promise((resolve, reject) => {
      this.pendingResolvers.push({
        resolve,
        reject
      });
      this.nextSaveTask = saveTask;
      if (!this.isSaving && !this.saveTimeout) {
        // Not currently saving and no scheduled save, save immediately
        this.executeSave();
      } else if (this.saveTimeout) {
        // A save is already scheduled, reschedule to debounce
        this.scheduleSave();
      }
      // If isSaving is true and no timeout is scheduled, the current save
      // will check for pending resolvers when it completes and schedule
      // another save if needed (see finally block in executeSave)
    });
  }
  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = undefined;
      this.executeSave();
    }, this.delayMs);
  }
  async executeSave() {
    if (this.isSaving) {
      return;
    }
    const saveTask = this.nextSaveTask;
    if (!saveTask) {
      return;
    }

    // Capture current pending resolvers for this save
    const resolversForThisSave = this.pendingResolvers;
    this.pendingResolvers = [];
    this.nextSaveTask = undefined;
    this.isSaving = true;
    try {
      const result = await saveTask();

      // Resolve only the promises that were pending when this save started
      resolversForThisSave.forEach(({
        resolve
      }) => resolve(result));
    } catch (error) {
      // Reject only the promises that were pending when this save started
      resolversForThisSave.forEach(({
        reject
      }) => reject(error));
    } finally {
      this.isSaving = false;

      // If new saves were requested during this save, schedule another
      if (this.pendingResolvers.length > 0) {
        this.scheduleSave();
      }
    }
  }
  [Symbol.dispose]() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = undefined;
    }
    this.pendingResolvers = [];
    this.nextSaveTask = undefined;
    this.isSaving = false;
  }
}

class CatalogManager {
  /**
   * Extraction-derived fields aggregated into `ExtractorMessage`.
   * Source code is the source of truth for these fields, only ancillary
   * codec fields may merge from disk (e.g. flags).
   */
  static extractorOwnedAggregatorKeys = new Set(['description', 'id', 'message', 'references']);
  /**
   * Source of truth for statically extracted source messages,
   * grouped by file and message ID.
   */
  sourceMessagesByFile = new Map();

  /**
   * Reverse index for rebuilding aggregated messages without scanning all files.
   * Contains the same `SourceMessage` arrays as `sourceMessagesByFile` and is
   * kept in sync with it.
   */
  sourceMessagesById = new Map();

  /**
   * Fast lookup for messages by ID, aggregated across all files. This combines
   * metadata from `sourceMessagesById`, e.g. references and descriptions.
   */
  messagesById = new Map();

  /**
   * This potentially also includes outdated ones that were initially available,
   * but are not used anymore. This allows to restore them if they are used again.
   **/
  translationsByTargetLocale = new Map();
  lastWriteByLocale = new Map();

  // Cached instances

  // Resolves when all catalogs are loaded

  // Resolves when the initial project scan and processing is complete

  constructor(config, opts) {
    this.config = config;
    this.saveScheduler = new SaveScheduler(opts.saveDebounceMs ?? 50);
    this.projectRoot = opts.projectRoot ?? getDefaultProjectRoot();
    this.isDevelopment = opts.isDevelopment ?? false;
    this.extractor = opts.extractor;
    if (this.isDevelopment) {
      // We kick this off as early as possible, so we get notified about changes
      // that happen during the initial project scan (while awaiting it to
      // complete though)
      this.sourceWatcher = new SourceFileWatcher(this.getSrcPaths(), this.handleFileEvents.bind(this));
      void this.sourceWatcher.start();
    }
  }
  async getCodec() {
    if (!this.codec) {
      this.codec = await resolveCodec(this.config.messages.format, this.projectRoot);
    }
    return this.codec;
  }
  async getPersister() {
    if (this.persister) {
      return this.persister;
    } else {
      this.persister = new CatalogPersister({
        messagesPath: this.config.extract.path,
        codec: await this.getCodec(),
        extension: getFormatExtension(this.config.messages.format)
      });
      return this.persister;
    }
  }
  getCatalogLocales() {
    if (this.catalogLocales) {
      return this.catalogLocales;
    } else {
      const messagesDir = path__default.default.join(this.projectRoot, this.config.extract.path);
      this.catalogLocales = new CatalogLocales({
        messagesDir,
        extension: getFormatExtension(this.config.messages.format),
        locales: this.config.extract.locales,
        sourceLocale: this.config.extract.sourceLocale
      });
      return this.catalogLocales;
    }
  }
  async getTargetLocales() {
    return this.getCatalogLocales().getTargetLocales();
  }
  getSrcPaths() {
    return (Array.isArray(this.config.extract.srcPath) ? this.config.extract.srcPath : [this.config.extract.srcPath]).map(srcPath => path__default.default.join(this.projectRoot, srcPath));
  }
  async loadMessages() {
    const sourceDiskMessages = await this.loadSourceMessages();
    this.loadCatalogsPromise = this.loadTargetMessages();
    await this.loadCatalogsPromise;
    this.scanCompletePromise = (async () => {
      const sourceFiles = Array.from(await SourceFileScanner.getSourceFiles(this.getSrcPaths()))
      // Stable file order keeps catalog ties independent of processing timing
      .toSorted(localeCompare);
      const extractedFiles = await Promise.all(sourceFiles.map(async filePath => ({
        filePath,
        messages: await this.extractFile(filePath)
      })));
      for (const {
        filePath,
        messages
      } of extractedFiles) {
        if (messages) {
          this.applyFileMessages(filePath, messages);
        }
      }
      this.mergeSourceDiskMetadata(sourceDiskMessages);
    })();
    await this.scanCompletePromise;
    if (this.isDevelopment) {
      const catalogLocales = this.getCatalogLocales();
      catalogLocales.subscribeLocalesChange(this.onLocalesChange);
    }
  }
  async loadSourceMessages() {
    // Load source catalog to hydrate metadata (e.g. flags) later without
    // treating catalog entries as source of truth.
    const diskMessages = await this.loadLocaleMessages(this.config.extract.sourceLocale);
    const byId = new Map();
    for (const diskMessage of diskMessages) {
      byId.set(diskMessage.id, diskMessage);
    }
    return byId;
  }
  async loadLocaleMessages(locale) {
    const persister = await this.getPersister();
    const messages = await persister.read(locale);
    const fileTime = await persister.getLastModified(locale);
    this.lastWriteByLocale.set(locale, fileTime);
    return messages;
  }
  async loadTargetMessages() {
    const targetLocales = await this.getTargetLocales();
    await Promise.all(targetLocales.map(locale => this.reloadLocaleCatalog(locale)));
  }
  async reloadLocaleCatalog(locale) {
    const diskMessages = await this.loadLocaleMessages(locale);
    if (locale === this.config.extract.sourceLocale) {
      // For source: Merge additional properties like flags
      for (const diskMessage of diskMessages) {
        const prev = this.messagesById.get(diskMessage.id);
        if (prev) {
          for (const key of Object.keys(diskMessage)) {
            if (!CatalogManager.extractorOwnedAggregatorKeys.has(key)) {
              // For unknown properties (like flags), disk wins
              prev[key] = diskMessage[key];
            }
          }
        }
      }
    } else {
      // For target: disk wins completely, BUT preserve existing translations
      // if we read empty (likely a write in progress by an external tool
      // that causes the file to temporarily be empty)
      const existingTranslations = this.translationsByTargetLocale.get(locale);
      const hasExistingTranslations = existingTranslations && existingTranslations.size > 0;
      if (diskMessages.length > 0) {
        // We got content from disk, replace with it
        const translations = new Map();
        for (const message of diskMessages) {
          translations.set(message.id, message);
        }
        this.translationsByTargetLocale.set(locale, translations);
      } else if (hasExistingTranslations) ; else {
        // We read empty and have no existing translations
        const translations = new Map();
        this.translationsByTargetLocale.set(locale, translations);
      }
    }
  }
  mergeSourceDiskMetadata(diskMessages) {
    for (const [id, diskMessage] of diskMessages) {
      const existing = this.messagesById.get(id);
      if (!existing) continue;

      // Fill unknown metadata from disk without replacing extraction-owned fields.
      for (const key of Object.keys(diskMessage)) {
        if (!CatalogManager.extractorOwnedAggregatorKeys.has(key) && existing[key] == null) {
          existing[key] = diskMessage[key];
        }
      }
    }
  }
  async processFile(absoluteFilePath) {
    const messages = await this.extractFile(absoluteFilePath);

    // `undefined` only when `extractFile()` throws. An empty array is success
    // and must still run `applyFileMessages` to clear stale ids for this file.
    if (!messages) return false;
    return this.applyFileMessages(absoluteFilePath, messages);
  }
  async extractFile(absoluteFilePath) {
    let messages = [];
    try {
      const content = await fs__default$1.default.readFile(absoluteFilePath, 'utf8');
      let extraction;
      try {
        extraction = await this.extractor.extract(absoluteFilePath, content);
      } catch {
        return undefined;
      }
      messages = extraction.messages;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
      // ENOENT -> treat as no messages
    }
    return messages;
  }
  applyFileMessages(absoluteFilePath, messages) {
    const prevFileMessages = this.sourceMessagesByFile.get(absoluteFilePath);
    const nextFileMessages = this.groupSourceMessagesById(messages);
    const affectedIds = new Set([...(prevFileMessages?.keys() ?? []), ...nextFileMessages.keys()]);
    if (nextFileMessages.size > 0) {
      this.sourceMessagesByFile.set(absoluteFilePath, nextFileMessages);
    } else {
      this.sourceMessagesByFile.delete(absoluteFilePath);
    }

    // Clear this file's contribution from the reverse index, then re-insert
    // fresh rows and rebuild aggregates (messagesById) per touched id.
    for (const id of affectedIds) {
      const sourceMessagesForId = this.sourceMessagesById.get(id);
      if (sourceMessagesForId) {
        sourceMessagesForId.delete(absoluteFilePath);
        // No files left for this id: drop the reverse-index entry.
        if (sourceMessagesForId.size === 0) {
          this.sourceMessagesById.delete(id);
        }
      }
      const nextSourceMessagesForId = nextFileMessages.get(id);
      if (nextSourceMessagesForId) {
        let sourceMessagesByFile = this.sourceMessagesById.get(id);
        if (!sourceMessagesByFile) {
          sourceMessagesByFile = new Map();
          this.sourceMessagesById.set(id, sourceMessagesByFile);
        }
        sourceMessagesByFile.set(absoluteFilePath, nextSourceMessagesForId);
      }
      this.rebuildMessageById(id);
    }
    const changed = this.haveMessagesChangedForFile(prevFileMessages, nextFileMessages);
    return changed;
  }
  groupSourceMessagesById(messages) {
    const result = new Map();
    for (const message of messages) {
      const messagesById = result.get(message.id);
      if (messagesById) {
        messagesById.push(message);
      } else {
        result.set(message.id, [message]);
      }
    }
    return result;
  }
  rebuildMessageById(id) {
    const sourceMessages = Array.from(this.sourceMessagesById.get(id)?.values() ?? []).flat();
    if (sourceMessages.length === 0) {
      this.messagesById.delete(id);
      return;
    }
    const previousMessage = this.messagesById.get(id);
    const aggregate = {
      description: this.mergeDescriptions(sourceMessages),
      id,
      message: sourceMessages[0].message,
      references: sourceMessages.map(message => message.reference).sort(compareReferences)
    };
    if (previousMessage) {
      for (const key of Object.keys(previousMessage)) {
        // Preserve extra fields (e.g. from disk/codec) across rebuilds; the
        // four core fields above are always recomputed from source messages.
        if (!CatalogManager.extractorOwnedAggregatorKeys.has(key) && aggregate[key] == null) {
          aggregate[key] = previousMessage[key];
        }
      }
    }
    this.messagesById.set(id, aggregate);
  }
  mergeDescriptions(messages) {
    const sortedByReference = messages.toSorted((a, b) => compareReferences(a.reference, b.reference));
    const merged = [];
    for (const message of sortedByReference) {
      const {
        description
      } = message;
      if (description != null && !merged.includes(description)) {
        merged.push(description);
      }
    }
    return merged;
  }
  haveMessagesChangedForFile(beforeMessages, afterMessages) {
    // If one exists and the other doesn't, there's a change
    if (!beforeMessages) {
      return afterMessages.size > 0;
    }

    // Different sizes means changes
    if (beforeMessages.size !== afterMessages.size) {
      return true;
    }

    // Check differences in beforeMessages vs afterMessages
    for (const [id, prevSourceMessages] of beforeMessages) {
      const nextSourceMessages = afterMessages.get(id);
      if (!nextSourceMessages) {
        return true;
      }
      if (!this.areSourceMessageArraysEqual(prevSourceMessages, nextSourceMessages)) {
        return true; // Early exit on first difference
      }
    }
    return false;
  }
  areSourceMessageArraysEqual(messages1, messages2) {
    return messages1.length === messages2.length && messages1.every((message, index) => this.areSourceMessagesEqual(message, messages2[index]));
  }
  areSourceMessagesEqual(msg1, msg2) {
    return msg1.id === msg2.id && msg1.message === msg2.message && msg1.description === msg2.description && msg1.reference.path === msg2.reference.path && msg1.reference.line === msg2.reference.line;
  }
  async save() {
    return this.saveScheduler.schedule(() => this.saveImpl());
  }
  async saveImpl() {
    await this.saveLocale(this.config.extract.sourceLocale);
    const targetLocales = await this.getTargetLocales();
    await Promise.all(targetLocales.map(locale => this.saveLocale(locale)));
  }
  async saveLocale(locale) {
    await this.loadCatalogsPromise;
    const messages = Array.from(this.messagesById.values());
    const persister = await this.getPersister();
    const isSourceLocale = locale === this.config.extract.sourceLocale;

    // Check if file was modified externally (poll-at-save is cheaper than
    // watchers here since stat() is fast and avoids continuous overhead)
    const lastWriteTime = this.lastWriteByLocale.get(locale);
    const currentFileTime = await persister.getLastModified(locale);
    if (currentFileTime && lastWriteTime && currentFileTime > lastWriteTime) {
      await this.reloadLocaleCatalog(locale);
    }
    const localeMessages = isSourceLocale ? this.messagesById : this.translationsByTargetLocale.get(locale);
    const messagesToPersist = messages.map(message => {
      const localeMessage = localeMessages?.get(message.id);
      return {
        ...localeMessage,
        id: message.id,
        description: message.description,
        references: message.references,
        message: isSourceLocale ? message.message : localeMessage?.message ?? ''
      };
    });
    await persister.write(messagesToPersist, {
      locale,
      sourceMessagesById: this.messagesById
    });

    // Update timestamps
    const newTime = await persister.getLastModified(locale);
    this.lastWriteByLocale.set(locale, newTime);
  }
  onLocalesChange = async params => {
    // Chain to existing promise
    this.loadCatalogsPromise = Promise.all([this.loadCatalogsPromise, ...params.added.map(locale => this.reloadLocaleCatalog(locale))]);
    for (const locale of params.added) {
      await this.saveLocale(locale);
    }
    for (const locale of params.removed) {
      this.translationsByTargetLocale.delete(locale);
      this.lastWriteByLocale.delete(locale);
    }
  };
  async handleFileEvents(events) {
    if (this.loadCatalogsPromise) {
      await this.loadCatalogsPromise;
    }

    // Wait for initial scan to complete to avoid race conditions
    if (this.scanCompletePromise) {
      await this.scanCompletePromise;
    }
    let changed = false;
    const expandedEvents = await this.sourceWatcher.expandDirectoryDeleteEvents(events, Array.from(this.sourceMessagesByFile.keys()));
    // Stable file order keeps catalog ties independent of event timing.
    for (const event of expandedEvents.toSorted((a, b) => localeCompare(a.path, b.path))) {
      const hasChanged = await this.processFile(event.path);
      changed ||= hasChanged;
    }
    if (changed) {
      await this.save();
    }
  }
  [Symbol.dispose]() {
    this.sourceWatcher?.stop();
    this.sourceWatcher = undefined;
    this.saveScheduler[Symbol.dispose]();
    if (this.catalogLocales && this.isDevelopment) {
      this.catalogLocales.unsubscribeLocalesChange(this.onLocalesChange);
    }
  }
}

class LRUCache {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }
  set(key, value) {
    const isNewKey = !this.cache.has(key);
    if (isNewKey && this.cache.size >= this.maxSize) {
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }
    this.cache.set(key, {
      key,
      value
    });
  }
  get(key) {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      this.cache.set(key, item);
      return item.value;
    }
    return undefined;
  }
}

const require$2 = module$1.createRequire((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('plugin-DlFYUFWh.cjs', document.baseURI).href)));
class MessageExtractor {
  compileCache = new LRUCache(750);
  constructor(opts) {
    this.isDevelopment = opts.isDevelopment ?? false;
    this.projectRoot = opts.projectRoot ?? getDefaultProjectRoot();
    this.sourceMap = opts.sourceMap ?? false;
  }
  async extract(absoluteFilePath, source) {
    const cacheKey = [source, absoluteFilePath].join('!');
    const cached = this.compileCache.get(cacheKey);
    if (cached) return cached;

    // Shortcut parsing if hook is not used. The Turbopack integration already
    // pre-filters this, but for webpack this feature doesn't exist, so we need
    // to do it here.
    if (!source.includes('useExtracted') && !source.includes('getExtracted')) {
      return {
        messages: [],
        code: source
      };
    }
    const filePath = normalizePathToPosix(path__default.default.relative(this.projectRoot, absoluteFilePath));
    const result = await core.transform(source, {
      jsc: {
        target: 'esnext',
        parser: {
          syntax: 'typescript',
          tsx: true,
          decorators: true
        },
        experimental: {
          cacheRoot: 'node_modules/.cache/swc',
          disableBuiltinTransformsForInternalTesting: true,
          disableAllLints: true,
          plugins: [[require$2.resolve('next-intl-swc-plugin-extractor'), {
            isDevelopment: this.isDevelopment,
            filePath
          }]]
        }
      },
      sourceMaps: this.sourceMap,
      sourceFileName: filePath,
      filename: filePath
    });

    // TODO: Improve the typing of @swc/core
    const output = result.output;
    const messages = JSON.parse(JSON.parse(output).results);
    const extractionResult = {
      code: result.code,
      map: result.map,
      messages
    };
    this.compileCache.set(cacheKey, extractionResult);
    return extractionResult;
  }
}

class ExtractionCompiler {
  constructor(config, opts = {}) {
    const extractor = opts.extractor ?? new MessageExtractor(opts);
    this.manager = new CatalogManager(config, {
      ...opts,
      extractor
    });
    this[Symbol.dispose] = this[Symbol.dispose].bind(this);
    this.installExitHandlers();
  }
  async extractAll() {
    // We can't rely on all files being compiled (e.g. due to persistent
    // caching), so loading the messages initially is necessary.
    await this.manager.loadMessages();
    await this.manager.save();
  }
  [Symbol.dispose]() {
    this.uninstallExitHandlers();
    this.manager[Symbol.dispose]();
  }
  installExitHandlers() {
    const cleanup = this[Symbol.dispose];
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }
  uninstallExitHandlers() {
    const cleanup = this[Symbol.dispose];
    process.off('exit', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  }
}

// Avoid rollup's `replace` plugin to compile this away
const nodeEnvKey = 'NODE_ENV'.trim();

// We avoid reading `argv.includes('dev')` related to
// https://github.com/amannn/next-intl/issues/2006
const isDevelopment = process.env[nodeEnvKey] === 'development';
const isNextBuild = process.argv.includes('build');
const isDevelopmentOrNextBuild = isDevelopment || isNextBuild;

// Single compiler instance, initialized once per process
let compiler;
const runOnce = once('_NEXT_INTL_EXTRACT');
function initExtractionCompiler(extractorConfig) {
  if (!extractorConfig || !hasLocalesToExtract(extractorConfig)) {
    return;
  }

  // Avoid running for:
  // - info
  // - start
  // - typegen
  //
  // Doesn't consult Next.js config anyway:
  // - lint
  // - telemetry (however, the `detached-flush` DOES - see `createNextIntlPlugin`)
  //
  // What remains are:
  // - dev (NODE_ENV=development)
  // - build (NODE_ENV=production)
  const shouldRun = isDevelopment || isNextBuild;
  if (!shouldRun) return;
  runOnce(() => {
    compiler = new ExtractionCompiler(extractorConfig, {
      isDevelopment,
      projectRoot: process.cwd()
    });

    // Fire-and-forget: Start extraction, don't block config return.
    // In dev mode, this also starts the file watcher.
    // In prod, ideally we would wait until the extraction is complete,
    // but we can't `await` anywhere (at least for Turbopack).
    // The result is ok though, as if we encounter untranslated messages,
    // we'll simply add empty messages to the catalog. So for actually
    // running the app, there is no difference.
    compiler.extractAll();
    function cleanup() {
      if (compiler) {
        compiler[Symbol.dispose]();
        compiler = undefined;
      }
    }
    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}

function getCurrentVersion() {
  try {
    const require$1 = module$1.createRequire((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('plugin-DlFYUFWh.cjs', document.baseURI).href)));
    const pkg = require$1('next/package.json');
    return pkg.version;
  } catch (error) {
    throw new Error('Failed to get current Next.js version. This can happen if next-intl/plugin is imported into your app code outside of your next.config.js.', {
      cause: error
    });
  }
}
function compareVersions(version1, version2) {
  const v1Parts = version1.split('.').map(Number);
  const v2Parts = version2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const v1 = v1Parts[i] || 0;
    const v2 = v2Parts[i] || 0;
    if (v1 > v2) return 1;
    if (v1 < v2) return -1;
  }
  return 0;
}
function hasStableTurboConfig() {
  return compareVersions(getCurrentVersion(), '15.3.0') >= 0;
}
function isNextJs16OrHigher() {
  return compareVersions(getCurrentVersion(), '16.0.0') >= 0;
}

const require$1 = module$1.createRequire((typeof document === 'undefined' ? require('u' + 'rl').pathToFileURL(__filename).href : (_documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === 'SCRIPT' && _documentCurrentScript.src || new URL('plugin-DlFYUFWh.cjs', document.baseURI).href)));
function withExtensions(localPath) {
  return [`${localPath}.ts`, `${localPath}.tsx`, `${localPath}.js`, `${localPath}.jsx`];
}
function normalizeTurbopackAliasPath(pathname) {
  // Turbopack alias targets should use forward slashes; Windows backslashes can
  // break resolution in dev (see `next-intl/config` alias path style).
  return pathname.replace(/\\/g, '/');
}
function resolveI18nPath(providedPath, cwd) {
  function resolvePath(pathname) {
    const parts = [];
    if (cwd) parts.push(cwd);
    parts.push(pathname);
    return path__default.default.resolve(...parts);
  }
  function pathExists(pathname) {
    return fs__default.default.existsSync(resolvePath(pathname));
  }
  if (providedPath) {
    // We use the `isNextDevOrBuild` condition to avoid throwing errors
    // if `next.config.ts` is read by a non-Next.js process.
    // https://github.com/amannn/next-intl/discussions/2209#discussioncomment-15650927
    if (isDevelopmentOrNextBuild && !pathExists(providedPath)) {
      throwError(`Could not find i18n config at ${providedPath}, please provide a valid path.`);
    }
    return providedPath;
  } else {
    for (const candidate of [...withExtensions('./i18n/request'), ...withExtensions('./src/i18n/request')]) {
      if (pathExists(candidate)) {
        return candidate;
      }
    }
    if (isDevelopmentOrNextBuild) {
      throwError(`Could not locate request configuration module.\n\nThis path is supported by default: ./(src/)i18n/request.{js,jsx,ts,tsx}\n\nAlternatively, you can specify a custom location in your Next.js config:\n\nconst withNextIntl = createNextIntlPlugin(\n  './path/to/i18n/request.tsx'\n);`);
    }

    // Default as fallback
    if (pathExists('./src')) {
      return './src/i18n/request.ts';
    } else {
      return './i18n/request.ts';
    }
  }
}
function getNextConfig(pluginConfig, nextConfig, extractorConfig) {
  const useTurbo = process.env.TURBOPACK != null;

  // `experimental-analyze` doesn’t set the TURBOPACK env param. Since Next.js
  // 16 doesn't print a warning when we configure both Turbo- and Webpack, just
  // always configure Turbopack just in case.
  const shouldConfigureTurbo = useTurbo || isNextJs16OrHigher();
  const nextIntlConfig = {};
  let messageLoadPaths = [];
  if (pluginConfig.experimental?.messages) {
    messageLoadPaths = normalizeMessagesCatalogPaths(pluginConfig.experimental.messages.path);
  }
  function getExtractMessagesLoaderConfig(config) {
    return {
      loader: 'next-intl/extractor/extractionLoader',
      options: config
    };
  }
  function getCatalogLoaderConfig() {
    const messages = pluginConfig.experimental.messages;
    return {
      loader: 'next-intl/extractor/catalogLoader',
      options: {
        messages: {
          format: messages.format,
          ...(messages.precompile !== undefined && {
            precompile: messages.precompile
          })
        }
      }
    };
  }
  function getTurboRules() {
    return nextConfig?.turbopack?.rules ||
    // @ts-expect-error -- For Next.js <16
    nextConfig?.experimental?.turbo?.rules || {};
  }
  function addTurboRule(rules, glob, rule) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (rules[glob]) {
      if (Array.isArray(rules[glob])) {
        rules[glob].push(rule);
      } else {
        rules[glob] = [rules[glob], rule];
      }
    } else {
      rules[glob] = rule;
    }
  }
  if (shouldConfigureTurbo) {
    if (pluginConfig.requestConfig && path__default.default.isAbsolute(pluginConfig.requestConfig)) {
      throwError("Turbopack support for next-intl currently does not support absolute paths, please provide a relative one (e.g. './src/i18n/config.ts').\n\nFound: " + pluginConfig.requestConfig);
    }

    // Assign alias for `next-intl/config`
    const resolveAlias = {
      // Turbo aliases don't work with absolute
      // paths (see error handling above)
      'next-intl/config': resolveI18nPath(pluginConfig.requestConfig)
    };

    // Add alias for precompiled message formatting
    if (pluginConfig.experimental?.messages?.precompile) {
      // Workaround for https://github.com/vercel/next.js/issues/88540
      let formatOnlyPath = path__default.default.relative(process.cwd(), require$1.resolve('use-intl/format-message/format-only'));

      // Turbopack seems to require this, otherwise `use-intl/format-message` is
      // still bundled (despite the code correctly calling into `format-only`).
      // Note that in this monorepo this is not necessary, because we'll end
      // up with a path like `../…` — but for actual consumers this is required.
      if (!formatOnlyPath.startsWith('.')) {
        formatOnlyPath = `./${formatOnlyPath}`;
      }
      resolveAlias['use-intl/format-message'] = normalizeTurbopackAliasPath(formatOnlyPath);
    }

    // Add loaders
    let rules;

    // Add loader for extractor
    if (pluginConfig.experimental?.extract) {
      if (!isNextJs16OrHigher()) {
        throwError('Message extraction requires Next.js 16 or higher.');
      }
      rules ??= getTurboRules();
      addTurboRule(rules, `*.{${SourceFileFilter.EXTENSIONS.join(',')}}`, {
        loaders: [getExtractMessagesLoaderConfig(extractorConfig)],
        condition: {
          // We don't filter for `path` here to allow transformation
          // of `useExtracted` calls in external packages (e.g. monorepos)
          content: /(useExtracted|getExtracted)/
        }
      });
    }

    // Add loader for catalog
    if (pluginConfig.experimental?.messages) {
      if (!isNextJs16OrHigher()) {
        throwError('Message catalog loading requires Next.js 16 or higher.');
      }
      rules ??= getTurboRules();
      const extension = getFormatExtension(pluginConfig.experimental.messages.format);
      addTurboRule(rules, `*${extension}`, {
        loaders: [getCatalogLoaderConfig()],
        condition: {
          path: `{${messageLoadPaths.join(',')}}/**/*`
        },
        as: '*.js'
      });
    }
    if (hasStableTurboConfig() &&
    // @ts-expect-error -- For Next.js <16
    !nextConfig?.experimental?.turbo) {
      nextIntlConfig.turbopack = {
        ...nextConfig?.turbopack,
        ...(rules && {
          rules
        }),
        resolveAlias: {
          ...nextConfig?.turbopack?.resolveAlias,
          ...resolveAlias
        }
      };
    } else {
      nextIntlConfig.experimental = {
        ...nextConfig?.experimental,
        // @ts-expect-error -- For Next.js <16
        turbo: {
          // @ts-expect-error -- For Next.js <16
          ...nextConfig?.experimental?.turbo,
          ...(rules && {
            rules
          }),
          resolveAlias: {
            // @ts-expect-error -- For Next.js <16
            ...nextConfig?.experimental?.turbo?.resolveAlias,
            ...resolveAlias
          }
        }
      };
    }
  }
  if (!useTurbo) {
    nextIntlConfig.webpack = function webpack(config, context) {
      if (!config.resolve) config.resolve = {};
      if (!config.resolve.alias) config.resolve.alias = {};

      // Assign alias for `next-intl/config`
      // (Webpack requires absolute paths)
      config.resolve.alias['next-intl/config'] = path__default.default.resolve(config.context, resolveI18nPath(pluginConfig.requestConfig, config.context));

      // Add alias for precompiled message formatting
      if (pluginConfig.experimental?.messages?.precompile) {
        // Use require.resolve to get the actual file path, since
        // bundlers don't properly resolve package subpath exports
        // when used as alias targets
        config.resolve.alias['use-intl/format-message'] = require$1.resolve('use-intl/format-message/format-only');
      }

      // Add loader for extractor
      if (pluginConfig.experimental?.extract) {
        if (!config.module) config.module = {};
        if (!config.module.rules) config.module.rules = [];
        config.module.rules.push({
          test: new RegExp(`\\.(${SourceFileFilter.EXTENSIONS.join('|')})$`),
          use: [getExtractMessagesLoaderConfig(extractorConfig)]
        });
      }

      // Add loader for catalog
      if (pluginConfig.experimental?.messages) {
        if (!config.module) config.module = {};
        if (!config.module.rules) config.module.rules = [];
        const extension = getFormatExtension(pluginConfig.experimental.messages.format);
        config.module.rules.push({
          test: new RegExp(`${extension.replace(/\./g, '\\.')}$`),
          include: messageLoadPaths.map(dirPath => path__default.default.resolve(config.context, dirPath)),
          use: [getCatalogLoaderConfig()],
          type: 'javascript/auto'
        });
      }
      if (typeof nextConfig?.webpack === 'function') {
        return nextConfig.webpack(config, context);
      }
      return config;
    };
  }

  // Forward config
  if (nextConfig?.trailingSlash) {
    nextIntlConfig.env = {
      ...nextConfig.env,
      _next_intl_trailing_slash: 'true'
    };
  }
  return Object.assign({}, nextConfig, nextIntlConfig);
}

function initPlugin(pluginConfig, nextConfig) {
  if (nextConfig?.i18n != null) {
    warn("An `i18n` property was found in your Next.js config. This likely causes conflicts and should therefore be removed if you use the App Router.\n\nIf you're in progress of migrating from the Pages Router, you can refer to this example: https://next-intl.dev/examples#app-router-migration\n");
  }
  const skipWatchers = isNextTelemetryDetachedFlushProcess();
  const messagesPathOrPaths = pluginConfig.experimental?.createMessagesDeclaration;
  if (messagesPathOrPaths && !skipWatchers) {
    createMessagesDeclaration(typeof messagesPathOrPaths === 'string' ? [messagesPathOrPaths] : messagesPathOrPaths);
  }
  let extractorConfig;
  const experimental = pluginConfig.experimental;
  const extract = experimental?.extract;
  if (extract) {
    extractorConfig = normalizeExtractorConfig({
      extract,
      messages: experimental.messages,
      srcPath: experimental.srcPath
    });
  }
  if (!skipWatchers) {
    initExtractionCompiler(extractorConfig);
  }
  return getNextConfig(pluginConfig, nextConfig, extractorConfig);
}
function createNextIntlPlugin(i18nPathOrConfig = {}) {
  const config = typeof i18nPathOrConfig === 'string' ? {
    requestConfig: i18nPathOrConfig
  } : i18nPathOrConfig;
  return function withNextIntl(nextConfig) {
    return initPlugin(config, nextConfig);
  };
}

/**
 * Next runs `telemetry/detached-flush.js` in a detached process to flush telemetry
 * (often when `next dev` exits). That loads dev `next.config` with inherited
 * `NODE_ENV=development`, which would otherwise start orphan plugin watchers.
 */
function isNextTelemetryDetachedFlushProcess() {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;
  const normalized = scriptPath.replace(/\\/g, '/');
  return normalized.includes('/telemetry/detached-flush');
}

exports.createNextIntlPlugin = createNextIntlPlugin;
exports.getSortedMessages = getSortedMessages;
exports.isForbiddenObjectKey = isForbiddenObjectKey;
exports.setNestedProperty = setNestedProperty;
