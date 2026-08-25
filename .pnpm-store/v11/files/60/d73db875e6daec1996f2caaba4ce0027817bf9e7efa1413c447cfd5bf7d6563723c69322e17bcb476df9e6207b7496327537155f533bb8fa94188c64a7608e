export { getRegistries, getRegistriesConfig, getRegistriesIndex, getRegistry, getRegistryItems, resolveRegistryItems } from '../index.js';
import { C as Config } from '../get-config-D6gTsP_D.js';
import '../schema/index.js';
import 'zod';

declare function addRegistryItems(items: string[], options?: {
    cwd?: string;
    config?: Partial<Config>;
    overwrite?: boolean;
    overwriteCssVars?: boolean;
    silent?: boolean;
    skipFonts?: boolean;
    path?: string;
}): Promise<void>;

type SearchRegistriesOptions = {
    query?: string;
    types?: string[];
    limit?: number;
    offset?: number;
    config?: Partial<Config>;
    useCache?: boolean;
    continueOnError?: boolean;
};
declare function searchRegistries(registries: string[], options?: SearchRegistriesOptions): Promise<{
    items: {
        registry: string;
        name: string;
        addCommandArgument: string;
        type?: string | undefined;
        title?: string | undefined;
        description?: string | undefined;
    }[];
    pagination: {
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
    };
    errors?: {
        message: string;
        registry: string;
    }[] | undefined;
}>;

type LoadRegistryOptions = {
    cwd?: string;
    registryFile?: string;
};
declare function loadRegistry(options?: LoadRegistryOptions): Promise<{
    items: ({
        files: ({
            path: string;
            type: "registry:page" | "registry:file";
            target: string;
        } | {
            path: string;
            type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
            target?: string | undefined;
        })[] | undefined;
        type: "registry:base";
        name: string;
        tailwind?: {
            config?: {
                theme?: Record<string, any> | undefined;
                content?: string[] | undefined;
                plugins?: string[] | undefined;
            } | undefined;
        } | undefined;
        docs?: string | undefined;
        $schema?: string | undefined;
        config?: {
            tailwind?: {
                baseColor?: string | undefined;
                config?: string | undefined;
                css?: string | undefined;
                cssVariables?: boolean | undefined;
                prefix?: string | undefined;
            } | undefined;
            menuColor?: "default" | "inverted" | "default-translucent" | "inverted-translucent" | undefined;
            menuAccent?: "subtle" | "bold" | undefined;
            iconLibrary?: string | undefined;
            style?: string | undefined;
            $schema?: string | undefined;
            rsc?: boolean | undefined;
            tsx?: boolean | undefined;
            rtl?: boolean | undefined;
            aliases?: {
                components?: string | undefined;
                ui?: string | undefined;
                utils?: string | undefined;
                lib?: string | undefined;
                hooks?: string | undefined;
            } | undefined;
            registries?: Record<string, string | {
                url: string;
                params?: Record<string, string> | undefined;
                headers?: Record<string, string> | undefined;
            }> | undefined;
        } | undefined;
        css?: Record<string, any> | undefined;
        extends?: string | undefined;
        title?: string | undefined;
        author?: string | undefined;
        description?: string | undefined;
        dependencies?: string[] | undefined;
        devDependencies?: string[] | undefined;
        registryDependencies?: string[] | undefined;
        cssVars?: {
            theme?: Record<string, string> | undefined;
            light?: Record<string, string> | undefined;
            dark?: Record<string, string> | undefined;
        } | undefined;
        envVars?: Record<string, string> | undefined;
        meta?: Record<string, any> | undefined;
        categories?: string[] | undefined;
    } | {
        files: ({
            path: string;
            type: "registry:page" | "registry:file";
            target: string;
        } | {
            path: string;
            type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
            target?: string | undefined;
        })[] | undefined;
        font: {
            family: string;
            provider: "google";
            import: string;
            variable: string;
            weight?: string[] | undefined;
            subsets?: string[] | undefined;
            selector?: string | undefined;
            dependency?: string | undefined;
        };
        type: "registry:font";
        name: string;
        tailwind?: {
            config?: {
                theme?: Record<string, any> | undefined;
                content?: string[] | undefined;
                plugins?: string[] | undefined;
            } | undefined;
        } | undefined;
        docs?: string | undefined;
        $schema?: string | undefined;
        css?: Record<string, any> | undefined;
        extends?: string | undefined;
        title?: string | undefined;
        author?: string | undefined;
        description?: string | undefined;
        dependencies?: string[] | undefined;
        devDependencies?: string[] | undefined;
        registryDependencies?: string[] | undefined;
        cssVars?: {
            theme?: Record<string, string> | undefined;
            light?: Record<string, string> | undefined;
            dark?: Record<string, string> | undefined;
        } | undefined;
        envVars?: Record<string, string> | undefined;
        meta?: Record<string, any> | undefined;
        categories?: string[] | undefined;
    } | {
        files: ({
            path: string;
            type: "registry:page" | "registry:file";
            target: string;
        } | {
            path: string;
            type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
            target?: string | undefined;
        })[] | undefined;
        type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:page" | "registry:file" | "registry:theme" | "registry:style" | "registry:item" | "registry:example" | "registry:internal";
        name: string;
        tailwind?: {
            config?: {
                theme?: Record<string, any> | undefined;
                content?: string[] | undefined;
                plugins?: string[] | undefined;
            } | undefined;
        } | undefined;
        docs?: string | undefined;
        $schema?: string | undefined;
        css?: Record<string, any> | undefined;
        extends?: string | undefined;
        title?: string | undefined;
        author?: string | undefined;
        description?: string | undefined;
        dependencies?: string[] | undefined;
        devDependencies?: string[] | undefined;
        registryDependencies?: string[] | undefined;
        cssVars?: {
            theme?: Record<string, string> | undefined;
            light?: Record<string, string> | undefined;
            dark?: Record<string, string> | undefined;
        } | undefined;
        envVars?: Record<string, string> | undefined;
        meta?: Record<string, any> | undefined;
        categories?: string[] | undefined;
    })[];
    name: string;
    homepage: string;
    $schema?: string | undefined;
    include?: string[] | undefined;
    pagination?: {
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
    } | undefined;
}>;
declare function loadRegistryItem(itemName: string, options?: LoadRegistryOptions): Promise<{
    type: "registry:base";
    name: string;
    tailwind?: {
        config?: {
            theme?: Record<string, any> | undefined;
            content?: string[] | undefined;
            plugins?: string[] | undefined;
        } | undefined;
    } | undefined;
    docs?: string | undefined;
    $schema?: string | undefined;
    config?: {
        tailwind?: {
            baseColor?: string | undefined;
            config?: string | undefined;
            css?: string | undefined;
            cssVariables?: boolean | undefined;
            prefix?: string | undefined;
        } | undefined;
        menuColor?: "default" | "inverted" | "default-translucent" | "inverted-translucent" | undefined;
        menuAccent?: "subtle" | "bold" | undefined;
        iconLibrary?: string | undefined;
        style?: string | undefined;
        $schema?: string | undefined;
        rsc?: boolean | undefined;
        tsx?: boolean | undefined;
        rtl?: boolean | undefined;
        aliases?: {
            components?: string | undefined;
            ui?: string | undefined;
            utils?: string | undefined;
            lib?: string | undefined;
            hooks?: string | undefined;
        } | undefined;
        registries?: Record<string, string | {
            url: string;
            params?: Record<string, string> | undefined;
            headers?: Record<string, string> | undefined;
        }> | undefined;
    } | undefined;
    css?: Record<string, any> | undefined;
    extends?: string | undefined;
    title?: string | undefined;
    author?: string | undefined;
    description?: string | undefined;
    dependencies?: string[] | undefined;
    devDependencies?: string[] | undefined;
    registryDependencies?: string[] | undefined;
    files?: ({
        path: string;
        type: "registry:page" | "registry:file";
        target: string;
        content?: string | undefined;
    } | {
        path: string;
        type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
        content?: string | undefined;
        target?: string | undefined;
    })[] | undefined;
    cssVars?: {
        theme?: Record<string, string> | undefined;
        light?: Record<string, string> | undefined;
        dark?: Record<string, string> | undefined;
    } | undefined;
    envVars?: Record<string, string> | undefined;
    meta?: Record<string, any> | undefined;
    categories?: string[] | undefined;
} | {
    font: {
        family: string;
        provider: "google";
        import: string;
        variable: string;
        weight?: string[] | undefined;
        subsets?: string[] | undefined;
        selector?: string | undefined;
        dependency?: string | undefined;
    };
    type: "registry:font";
    name: string;
    tailwind?: {
        config?: {
            theme?: Record<string, any> | undefined;
            content?: string[] | undefined;
            plugins?: string[] | undefined;
        } | undefined;
    } | undefined;
    docs?: string | undefined;
    $schema?: string | undefined;
    css?: Record<string, any> | undefined;
    extends?: string | undefined;
    title?: string | undefined;
    author?: string | undefined;
    description?: string | undefined;
    dependencies?: string[] | undefined;
    devDependencies?: string[] | undefined;
    registryDependencies?: string[] | undefined;
    files?: ({
        path: string;
        type: "registry:page" | "registry:file";
        target: string;
        content?: string | undefined;
    } | {
        path: string;
        type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
        content?: string | undefined;
        target?: string | undefined;
    })[] | undefined;
    cssVars?: {
        theme?: Record<string, string> | undefined;
        light?: Record<string, string> | undefined;
        dark?: Record<string, string> | undefined;
    } | undefined;
    envVars?: Record<string, string> | undefined;
    meta?: Record<string, any> | undefined;
    categories?: string[] | undefined;
} | {
    type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:page" | "registry:file" | "registry:theme" | "registry:style" | "registry:item" | "registry:example" | "registry:internal";
    name: string;
    tailwind?: {
        config?: {
            theme?: Record<string, any> | undefined;
            content?: string[] | undefined;
            plugins?: string[] | undefined;
        } | undefined;
    } | undefined;
    docs?: string | undefined;
    $schema?: string | undefined;
    css?: Record<string, any> | undefined;
    extends?: string | undefined;
    title?: string | undefined;
    author?: string | undefined;
    description?: string | undefined;
    dependencies?: string[] | undefined;
    devDependencies?: string[] | undefined;
    registryDependencies?: string[] | undefined;
    files?: ({
        path: string;
        type: "registry:page" | "registry:file";
        target: string;
        content?: string | undefined;
    } | {
        path: string;
        type: "registry:lib" | "registry:block" | "registry:component" | "registry:ui" | "registry:hook" | "registry:theme" | "registry:style" | "registry:item" | "registry:base" | "registry:font" | "registry:example" | "registry:internal";
        content?: string | undefined;
        target?: string | undefined;
    })[] | undefined;
    cssVars?: {
        theme?: Record<string, string> | undefined;
        light?: Record<string, string> | undefined;
        dark?: Record<string, string> | undefined;
    } | undefined;
    envVars?: Record<string, string> | undefined;
    meta?: Record<string, any> | undefined;
    categories?: string[] | undefined;
}>;

declare const RegistryErrorCode: {
    readonly NETWORK_ERROR: "NETWORK_ERROR";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly GONE: "GONE";
    readonly UNAUTHORIZED: "UNAUTHORIZED";
    readonly FORBIDDEN: "FORBIDDEN";
    readonly FETCH_ERROR: "FETCH_ERROR";
    readonly NOT_CONFIGURED: "NOT_CONFIGURED";
    readonly INVALID_CONFIG: "INVALID_CONFIG";
    readonly MISSING_ENV_VARS: "MISSING_ENV_VARS";
    readonly LOCAL_FILE_ERROR: "LOCAL_FILE_ERROR";
    readonly PARSE_ERROR: "PARSE_ERROR";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly UNKNOWN_ERROR: "UNKNOWN_ERROR";
};
type RegistryErrorCode = (typeof RegistryErrorCode)[keyof typeof RegistryErrorCode];
declare class RegistryError extends Error {
    readonly code: RegistryErrorCode;
    readonly statusCode?: number;
    readonly context?: Record<string, unknown>;
    readonly suggestion?: string;
    readonly timestamp: Date;
    readonly cause?: unknown;
    constructor(message: string, options?: {
        code?: RegistryErrorCode;
        statusCode?: number;
        cause?: unknown;
        context?: Record<string, unknown>;
        suggestion?: string;
    });
    toJSON(): {
        name: string;
        message: string;
        code: RegistryErrorCode;
        statusCode: number | undefined;
        context: Record<string, unknown> | undefined;
        suggestion: string | undefined;
        timestamp: Date;
        stack: string | undefined;
    };
}
declare class RegistryNotFoundError extends RegistryError {
    readonly url: string;
    constructor(url: string, cause?: unknown);
}
declare class RegistryUnauthorizedError extends RegistryError {
    readonly url: string;
    constructor(url: string, cause?: unknown);
}
declare class RegistryForbiddenError extends RegistryError {
    readonly url: string;
    constructor(url: string, cause?: unknown);
}
declare class RegistryFetchError extends RegistryError {
    readonly url: string;
    readonly responseBody?: string | undefined;
    constructor(url: string, statusCode?: number, responseBody?: string | undefined, cause?: unknown);
}
declare class RegistryNotConfiguredError extends RegistryError {
    readonly registryName: string | null;
    constructor(registryName: string | null);
}
declare class RegistryLocalFileError extends RegistryError {
    readonly filePath: string;
    constructor(filePath: string, cause?: unknown, options?: {
        message?: string;
        context?: Record<string, unknown>;
        suggestion?: string;
    });
}
declare class RegistryParseError extends RegistryError {
    readonly item: string;
    readonly parseError: unknown;
    constructor(item: string, parseError: unknown, options?: {
        subject?: string;
        context?: Record<string, unknown>;
        suggestion?: string;
    });
}
declare class RegistryValidationError extends RegistryError {
    constructor(message: string, options?: {
        registryFile?: string;
        cause?: unknown;
        context?: Record<string, unknown>;
        suggestion?: string;
    });
}
declare class RegistryItemNotFoundError extends RegistryError {
    readonly itemName: string;
    constructor(itemName: string);
}
declare class RegistryMissingEnvironmentVariablesError extends RegistryError {
    readonly registryName: string;
    readonly missingVars: string[];
    constructor(registryName: string, missingVars: string[]);
}
declare class RegistryInvalidNamespaceError extends RegistryError {
    readonly name: string;
    constructor(name: string);
}
declare class RegistriesIndexParseError extends RegistryError {
    readonly parseError: unknown;
    constructor(parseError: unknown);
}

export { type LoadRegistryOptions, RegistriesIndexParseError, RegistryError, RegistryErrorCode, RegistryFetchError, RegistryForbiddenError, RegistryInvalidNamespaceError, RegistryItemNotFoundError, RegistryLocalFileError, RegistryMissingEnvironmentVariablesError, RegistryNotConfiguredError, RegistryNotFoundError, RegistryParseError, RegistryUnauthorizedError, RegistryValidationError, addRegistryItems, loadRegistry, loadRegistryItem, searchRegistries };
