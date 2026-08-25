import fs from 'fs/promises';
import path from 'path';
import { resolveCodec, getFormatExtension } from '../format/index.js';
import SourceFileScanner from '../source/SourceFileScanner.js';
import SourceFileWatcher from '../source/SourceFileWatcher.js';
import { getDefaultProjectRoot, localeCompare, compareReferences } from '../utils.js';
import CatalogLocales from './CatalogLocales.js';
import CatalogPersister from './CatalogPersister.js';
import SaveScheduler from './SaveScheduler.js';

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
      const messagesDir = path.join(this.projectRoot, this.config.extract.path);
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
    return (Array.isArray(this.config.extract.srcPath) ? this.config.extract.srcPath : [this.config.extract.srcPath]).map(srcPath => path.join(this.projectRoot, srcPath));
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
      const content = await fs.readFile(absoluteFilePath, 'utf8');
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

export { CatalogManager as default };
