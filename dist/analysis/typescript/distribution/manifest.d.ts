import type { NativeAnalysisArtifact, NativeAnalysisReleaseManifest } from "./model.ts";
export declare const NATIVE_RELEASE_FORMAT: "astrale.codegraph.native-release";
/** Each target's executables live in this directory of the one published package. */
export declare const NATIVE_ARTIFACT_DIRECTORY: "native-artifacts";
export declare function readNativeReleaseManifest(path: string, packageVersion: string, target: string): Promise<NativeAnalysisReleaseManifest>;
export declare function currentNativeAnalysisTarget(): string;
/** Admit only the companion capability; Go consumers do not consume its metadata. */
export declare function admitNativeOxlintArtifact(expected: NativeAnalysisArtifact): NonNullable<NativeAnalysisArtifact["oxlint"]>;
