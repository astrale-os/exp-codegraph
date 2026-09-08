import type { ObservedSurface } from '../../analysis/typescript/surface/model.ts';
import type { DeclarationTypeScriptProject } from './project.ts';
import type { DeclarationSurfaceSemantics } from './semantics.ts';
export interface ObservePublicSurfaceOptions {
    readonly explicitExportsOnly?: boolean;
    readonly ownedFiles?: ReadonlySet<string>;
    readonly semantics?: DeclarationSurfaceSemantics;
}
export declare function observePublicSurface(catalogRoot: string, project: DeclarationTypeScriptProject, entrypoint: string, options?: ObservePublicSurfaceOptions): ObservedSurface;
