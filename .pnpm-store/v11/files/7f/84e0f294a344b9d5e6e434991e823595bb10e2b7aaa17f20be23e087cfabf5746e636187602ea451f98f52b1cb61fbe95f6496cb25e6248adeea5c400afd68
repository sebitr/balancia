import type MessageExtractor from '../extractor/MessageExtractor.js';
import type { ExtractorConfig } from '../types.js';
export default class CatalogManager implements Disposable {
    /**
     * Extraction-derived fields aggregated into `ExtractorMessage`.
     * Source code is the source of truth for these fields, only ancillary
     * codec fields may merge from disk (e.g. flags).
     */
    private static readonly extractorOwnedAggregatorKeys;
    private config;
    /**
     * Source of truth for statically extracted source messages,
     * grouped by file and message ID.
     */
    private sourceMessagesByFile;
    /**
     * Reverse index for rebuilding aggregated messages without scanning all files.
     * Contains the same `SourceMessage` arrays as `sourceMessagesByFile` and is
     * kept in sync with it.
     */
    private sourceMessagesById;
    /**
     * Fast lookup for messages by ID, aggregated across all files. This combines
     * metadata from `sourceMessagesById`, e.g. references and descriptions.
     */
    private messagesById;
    /**
     * This potentially also includes outdated ones that were initially available,
     * but are not used anymore. This allows to restore them if they are used again.
     **/
    private translationsByTargetLocale;
    private lastWriteByLocale;
    private saveScheduler;
    private projectRoot;
    private isDevelopment;
    private persister?;
    private codec?;
    private catalogLocales?;
    private extractor;
    private sourceWatcher?;
    private loadCatalogsPromise?;
    private scanCompletePromise?;
    constructor(config: ExtractorConfig, opts: {
        extractor: MessageExtractor;
        isDevelopment?: boolean;
        projectRoot?: string;
        saveDebounceMs?: number;
        sourceMap?: boolean;
    });
    private getCodec;
    private getPersister;
    private getCatalogLocales;
    private getTargetLocales;
    private getSrcPaths;
    loadMessages(): Promise<void>;
    private loadSourceMessages;
    private loadLocaleMessages;
    private loadTargetMessages;
    private reloadLocaleCatalog;
    private mergeSourceDiskMetadata;
    private processFile;
    private extractFile;
    private applyFileMessages;
    private groupSourceMessagesById;
    private rebuildMessageById;
    private mergeDescriptions;
    private haveMessagesChangedForFile;
    private areSourceMessageArraysEqual;
    private areSourceMessagesEqual;
    save(): Promise<void>;
    private saveImpl;
    private saveLocale;
    private onLocalesChange;
    private handleFileEvents;
    [Symbol.dispose](): void;
}
