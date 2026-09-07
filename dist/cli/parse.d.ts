import type { CliCheckOutputFormat } from './check-report.ts';
export declare const USAGE = "Usage:\n  cg --version\n  cg init [module-directory]\n  cg check [root] [--select <relative-path>]... [--exclude <relative-path>]... [--require-complete-layout] [--require-exact-layout] [--format <text|json>] [--quiet] [--no-cache]\n  cg changed [root] [base] [--exclude <relative-path>]... [--require-complete-layout] [--scope-only] [--quiet] [--no-cache]\n  cg test [module-path]... [--root <directory>] [--quiet] [--no-cache]\n  cg test changed [base] [--root <directory>] [--quiet] [--no-cache]\n  cg verify [root] [--select <relative-path>]... [--schema-root <directory>]... [--require-pass] [--details] [--quiet]\n  cg dev [root] [--port <number>] [--open] [--verify] [--no-cache]";
export type CliCommand = {
    name: 'help';
    successful: boolean;
} | {
    name: 'version';
} | {
    name: 'init';
    root: string;
} | {
    name: 'check';
    root: string;
    exclude: readonly string[];
    select: readonly string[];
    requireCompleteLayout: boolean;
    requireExactLayout: boolean;
    format: CliCheckOutputFormat;
    quiet: boolean;
    cache: boolean;
} | {
    name: 'verify';
    root: string;
    select: readonly string[];
    schemaRoots: readonly string[];
    requirePass: boolean;
    details: boolean;
    quiet: boolean;
} | {
    name: 'changed';
    root: string;
    base?: string;
    exclude: readonly string[];
    requireCompleteLayout: boolean;
    scopeOnly: boolean;
    quiet: boolean;
    cache: boolean;
} | {
    name: 'test';
    root: string;
    select: readonly string[];
    changed: boolean;
    base?: string;
    quiet: boolean;
    cache: boolean;
} | {
    name: 'dev';
    root: string;
    port?: number;
    open: boolean;
    verify: boolean;
    cache: boolean;
};
export declare function parseCommand(input: readonly string[], environment?: NodeJS.ProcessEnv): CliCommand;
