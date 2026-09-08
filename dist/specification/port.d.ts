import type { ApiModel } from '../api/model.ts';
import type { Diagnostic } from '../source/diagnostic.ts';
import type { DeclarationResource, PortResource } from './resource/index.ts';
export interface PortResolution<Model extends ApiModel = ApiModel> {
    readonly port?: PortResource<Model>;
    readonly diagnostics: readonly Diagnostic[];
}
/** Resolve the one locally declared interface that gives a Port resource its identity. */
export declare function resolvePort<Model extends ApiModel>(resource: DeclarationResource<Model>, pointer: string, namespace?: string): PortResolution<Model>;
export declare function duplicatePortNameDiagnostics<Model extends ApiModel>(ports: readonly PortResource<Model>[], declarationSource: string): Diagnostic[];
