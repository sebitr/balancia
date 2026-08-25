#!/usr/bin/env node
import { registryIndexSchema, registryItemSchema, registryConfigSchema } from './schema/index.js';
import { C as Config } from './get-config-D6gTsP_D.js';
import { z } from 'zod';

type RegistryApiOptions = {
    config?: Partial<Config>;
    useCache?: boolean;
};
type RegistrySearchParams = {
    query?: string;
    types?: string[];
    limit?: number;
    offset?: number;
};
type GetRegistryOptions = RegistryApiOptions & {
    searchParams?: RegistrySearchParams;
};
declare function getRegistry(name: string, options?: GetRegistryOptions): Promise<{
    name: string;
    homepage: string;
    items: ({
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
    })[];
    $schema?: string | undefined;
    include?: string[] | undefined;
    pagination?: {
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
    } | undefined;
} | {
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
declare function getRegistryItems(items: string[], options?: RegistryApiOptions): Promise<({
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
})[]>;
declare function resolveRegistryItems(items: string[], options?: RegistryApiOptions): Promise<{
    tailwind?: {
        config?: {
            theme?: Record<string, any> | undefined;
            content?: string[] | undefined;
            plugins?: string[] | undefined;
        } | undefined;
    } | undefined;
    docs?: string | undefined;
    css?: Record<string, any> | undefined;
    dependencies?: string[] | undefined;
    devDependencies?: string[] | undefined;
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
    fonts?: {
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
    }[] | undefined;
} | null>;
declare function getRegistriesConfig(cwd: string, options?: {
    useCache?: boolean;
}): Promise<{
    registries: {
        [x: string]: string | {
            url: string;
            params?: Record<string, string> | undefined;
            headers?: Record<string, string> | undefined;
        };
    };
}>;
declare function getPackageJsonRegistries(cwd: string): Promise<z.infer<typeof registryConfigSchema>>;
declare function getShadcnRegistryIndex(): Promise<({
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
})[]>;
declare function getRegistryStyles(): Promise<{
    name: string;
    label: string;
}[]>;
declare function getRegistryIcons(): Promise<Record<string, Record<string, string>>>;
declare function getRegistryBaseColors(): Promise<readonly [{
    readonly name: "neutral";
    readonly label: "Neutral";
}, {
    readonly name: "zinc";
    readonly label: "Zinc";
}, {
    readonly name: "stone";
    readonly label: "Stone";
}, {
    readonly name: "mauve";
    readonly label: "Mauve";
}, {
    readonly name: "olive";
    readonly label: "Olive";
}, {
    readonly name: "mist";
    readonly label: "Mist";
}, {
    readonly name: "taupe";
    readonly label: "Taupe";
}]>;
declare function getRegistryBaseColor(baseColor: string): Promise<{
    cssVars: {
        theme?: Record<string, string> | undefined;
        light?: Record<string, string> | undefined;
        dark?: Record<string, string> | undefined;
    };
    inlineColors: {
        light: Record<string, string>;
        dark: Record<string, string>;
    };
    inlineColorsTemplate: string;
    cssVarsTemplate: string;
    cssVarsV4?: {
        theme?: Record<string, string> | undefined;
        light?: Record<string, string> | undefined;
        dark?: Record<string, string> | undefined;
    } | undefined;
}>;
/**
 * @deprecated This function is deprecated and will be removed in a future version.
 */
declare function resolveTree(index: z.infer<typeof registryIndexSchema>, names: string[]): Promise<({
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
})[]>;
/**
 * @deprecated This function is deprecated and will be removed in a future version.
 */
declare function fetchTree(style: string, tree: z.infer<typeof registryIndexSchema>): Promise<({
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
})[]>;
/**
 * @deprecated This function is deprecated and will be removed in a future version.
 */
declare function getItemTargetPath(config: Config, item: Pick<z.infer<typeof registryItemSchema>, "type">, override?: string): Promise<string | null>;
declare function getRegistries(options?: {
    useCache?: boolean;
}): Promise<{
    url: string;
    name: string;
    description?: string | undefined;
    homepage?: string | undefined;
}[]>;
/**
 * @deprecated Use getRegistries() instead.
 */
declare function getRegistriesIndex(options?: {
    useCache?: boolean;
}): Promise<Record<string, string> | null>;
declare function getPresets(options?: {
    useCache?: boolean;
}): Promise<{
    base: string;
    menuColor: "default" | "inverted" | "default-translucent" | "inverted-translucent";
    menuAccent: "subtle" | "bold";
    radius: string;
    font: string;
    iconLibrary: string;
    theme: string;
    baseColor: string;
    style: string;
    rtl: boolean;
    name: string;
    title: string;
    description: string;
}[]>;
declare function getPreset(name: string, options?: {
    useCache?: boolean;
}): Promise<{
    base: string;
    menuColor: "default" | "inverted" | "default-translucent" | "inverted-translucent";
    menuAccent: "subtle" | "bold";
    radius: string;
    font: string;
    iconLibrary: string;
    theme: string;
    baseColor: string;
    style: string;
    rtl: boolean;
    name: string;
    title: string;
    description: string;
} | null>;

export { fetchTree, getItemTargetPath, getPackageJsonRegistries, getPreset, getPresets, getRegistries, getRegistriesConfig, getRegistriesIndex, getRegistry, getRegistryBaseColor, getRegistryBaseColors, getRegistryIcons, getRegistryItems, getRegistryStyles, getShadcnRegistryIndex, resolveRegistryItems, resolveTree };
