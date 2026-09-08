import { type InlineConfig, type Plugin, type ViteDevServer } from 'vite';
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts';
import type { AnalysisTelemetrySink } from '../analysis/index.ts';
import { type LiveSpecsOptions } from './live-plugin.ts';
export interface DevOptions {
    root: string;
    port?: number;
    open?: boolean;
    verify?: boolean;
    cache?: boolean;
    /** Explicit native analyzer for source-checkout development and controlled qualification. */
    native?: CodegraphApplicationSessionOptions;
    /** Diagnostic-only operational telemetry; it cannot influence semantic output. */
    telemetry?: AnalysisTelemetrySink;
}
export interface RunningDevServer {
    server: ViteDevServer;
    url: string;
    close(): Promise<void>;
}
export interface DevelopmentServerDependencies {
    createServer(config: InlineConfig): Promise<ViteDevServer>;
    createPlugin(options: LiveSpecsOptions): Plugin;
    allocatePort(): Promise<number>;
}
export declare function createDevelopmentServer(dependencies: DevelopmentServerDependencies): (options: DevOptions) => Promise<RunningDevServer>;
export declare const startDev: (options: DevOptions) => Promise<RunningDevServer>;
