import type { ApiModel, ApiModelV2 } from '../api/model.ts';
import type { ApiCompiler } from '../compiler/contract.ts';
import type { Diagnostic } from '../source/diagnostic.ts';
import type { DeclarationResource } from './resource/index.ts';
import type { DeclarationSurfaceSemantics } from '../typescript/surface/semantics.ts';
import type { SpecificationSnapshot } from './snapshot/model.ts';
/** Select presentation-only declaration navigation for one coherent specification operation. */
export declare function configureSpecificationDeclarationNavigation(include: boolean): void;
/** Select complete normalized declaration models for one coherent specification operation. */
export declare function configureSpecificationDeclarationModels(include: boolean): void;
export interface DeclarationResourceLoad<Model extends ApiModel = ApiModelV2> {
    readonly resource?: DeclarationResource<Model>;
    readonly diagnostics: readonly Diagnostic[];
}
export declare function createDeclarationResourceLoader<Model extends ApiModel>(compiler: ApiCompiler, semantics: DeclarationSurfaceSemantics, version: Model['version']): (root: string, containingFile: string, ownerSource: string, reference: string, pointer: string) => Promise<DeclarationResourceLoad<Model>>;
/** Restore declaration results only when the exact inventory delta cannot affect declaration input. */
export declare function seedSpecificationDeclarationResources(specifications: readonly SpecificationSnapshot[], changed: readonly string[]): ReadonlySet<string>;
export declare const loadDeclarationResource: (root: string, containingFile: string, ownerSource: string, reference: string, pointer: string) => Promise<DeclarationResourceLoad<ApiModelV2>>;
/** V2 authored declaration compiler used only by immutable specification snapshots. */
export declare const loadSpecificationDeclarationResource: (root: string, containingFile: string, ownerSource: string, reference: string, pointer: string) => Promise<DeclarationResourceLoad<ApiModelV2>>;
