import type { SourceMessage } from '../types.js';
export default class MessageExtractor {
    private isDevelopment;
    private projectRoot;
    private sourceMap;
    private compileCache;
    constructor(opts: {
        isDevelopment?: boolean;
        projectRoot?: string;
        sourceMap?: boolean;
    });
    extract(absoluteFilePath: string, source: string): Promise<{
        messages: Array<SourceMessage>;
        code: string;
        map?: string;
    }>;
}
