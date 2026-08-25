import MessageExtractor from './extractor/MessageExtractor.js';
import type { ExtractorConfig } from './types.js';
export default class ExtractionCompiler implements Disposable {
    private manager;
    constructor(config: ExtractorConfig, opts?: {
        extractor?: MessageExtractor;
        isDevelopment?: boolean;
        projectRoot?: string;
        saveDebounceMs?: number;
        sourceMap?: boolean;
    });
    extractAll(): Promise<void>;
    [Symbol.dispose](): void;
    private installExitHandlers;
    private uninstallExitHandlers;
}
