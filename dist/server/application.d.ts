import type { TypeSpecApplicationService } from '../application/index.ts';
import type { CodegraphApplicationSessionOptions } from '../application/analysis/index.ts';
import type { AnalysisTelemetrySink } from '../analysis/index.ts';
/** Dev-server application composition; the live plugin owns and disposes the returned service. */
export declare function createServerApplicationService(root: string, cache: boolean, native?: CodegraphApplicationSessionOptions, telemetry?: AnalysisTelemetrySink): Promise<TypeSpecApplicationService>;
