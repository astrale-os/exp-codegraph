import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from '../../protocol/index.ts';
import type { NativeAnalysisArtifact, NativeAnalysisReleaseManifest, NativeAnalysisTarget } from './model.ts';
export declare const NATIVE_RELEASE_FORMAT: 'astrale.codegraph.native-release';
export declare const NATIVE_ARTIFACT_FORMAT: 'astrale.codegraph.native-artifact';
export declare const NATIVE_ARTIFACT_PACKAGES: Readonly<Record<NativeAnalysisTarget, string>>;
export interface NativeArtifactPackageManifest {
    readonly format: typeof NATIVE_ARTIFACT_FORMAT;
    readonly version: 1;
    readonly packageVersion: string;
    readonly protocolVersion: typeof NATIVE_ANALYSIS_PROTOCOL_VERSION;
    readonly artifact: NativeAnalysisArtifact;
}
export declare function readNativeReleaseManifest(path: string, packageVersion: string, target: string): Promise<NativeAnalysisReleaseManifest>;
export declare function admitNativeArtifactPackageManifest(input: unknown, expected: NativeAnalysisArtifact, packageVersion: string): NativeArtifactPackageManifest;
export declare function currentNativeAnalysisTarget(): string;
