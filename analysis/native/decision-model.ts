import type { NativeCapturedAnalysisSource } from '../protocol/model.ts';
export type { NativeCapturedAnalysisStamp as NativeCapturedSemanticStamp } from '../protocol/model.ts';

/** Compact decisions and optional revision-owned generic semantic observations. */
export const NATIVE_DECISION_PROTOCOL_VERSION = 1 as const;
export const NATIVE_DECISION_CONTRACT_REVISION = 1 as const;

export type NativeDecisionImplementationContract = Readonly<{
  ruleId: string;
  ruleRevision: string;
  requiredFacts: readonly string[];
  implementation: Readonly<{ id: string; version: string }>;
}>;

export interface NativeDecisionPrepareRequest {
  readonly projectionMode?: "sdk-rule-products";
  readonly root: string;
  readonly basePolicyDigest: string;
  readonly policySource: {
    readonly rules: string;
    readonly layers: readonly {
      readonly id: string;
      readonly sourcePath: string;
      readonly facade?: string;
      readonly required: boolean;
    }[];
    readonly dependencies: readonly {
      readonly source: string;
      readonly target: string;
      readonly kind: "runtime" | "type-only" | "composition" | "evidence";
      readonly condition: string;
    }[];
    readonly rootFiles: readonly {
      readonly id: string;
      readonly sourcePath: string;
      readonly role: "configuration" | "composition" | "package-facade" | "tooling";
      readonly required: boolean;
    }[];
    readonly aliases: readonly {
      readonly layer: string;
      readonly kind: "facade" | "submodule";
      readonly specifier: string;
      readonly typescriptTarget: string;
      readonly packageTarget: string;
    }[];
  };
  readonly ruleRevisions: readonly { readonly id: string; readonly revision: string }[];
  /** Source-owner revision 3: announce the complete immutable caller inventory once.
   * An empty array explicitly offers zero implementations; absence preserves legacy admission. */
  readonly implementationContracts?: readonly NativeDecisionImplementationContract[];
  readonly options: {
    /** Offered private SDK source owner; absence preserves older products/fallback. */
    readonly sourcePolicyOwnerRevision?: 2 | 3;
    readonly requiredRuleIds?: readonly string[];
    readonly generic?: boolean;
    readonly fix?: boolean;
    /** Actual canonical SDK option validator product. Errors are observed only
     * when current admitted semantic layers request the original value reader. */
    readonly budgetValidation?:
      | { readonly kind: "valid"; readonly limits: { readonly maximumDepth: number; readonly maximumSteps: number; readonly maximumAlternatives: number } }
      | { readonly kind: "invalid"; readonly field: string; readonly reason: "positive-integer" };
    readonly budget?: {
      readonly maximumDepth?: number;
      readonly maximumSteps?: number;
      readonly maximumAlternatives?: number;
    };
  };
  /** Hints never substitute for uncached positive and negative input observations. */
  readonly changed?: readonly string[];
}

export interface NativeDecisionCandidate {
  readonly status: "candidate";
  readonly token: string;
  readonly generation: string;
  readonly inputCertificate: string;
  readonly governanceDigest: string;
  readonly basePolicyDigest: string;
  readonly policyDigest: string;
  readonly contractRevision: 1;
  /** SHA256 of exact UTF8 reportJSON, independent of either runtime's JSON ordering. */
  readonly reportDigest: string;
  readonly reportJSON: string;
}

export type NativeDecisionPreparation =
  | NativeDecisionCandidate
  | NativeDecisionConfiguration
  | NativeDecisionProductsCandidate
  | NativeDecisionGenericRequest
  | {
      readonly status: "intrinsics";
      readonly token: string;
      readonly requirements: readonly NativeDecisionIntrinsicRequirement[];
    }
  | { readonly status: "retry" }
  | { readonly status: "partial"; readonly residual: readonly string[] };

export interface NativeDecisionConfiguration {
  /** Realpath observed by the retained native capture, never reread by JS. */
  readonly canonicalRoot?: string;
  readonly status: "configuration";
  readonly token: string;
  readonly root: string;
  readonly configPath: string;
  readonly configKind:
    | "absent"
    | "regular"
    | "symlink"
    | "other"
    | "inspection-error"
    | "read-error";
  readonly configSize?: number;
  readonly configRawBase64: string | null;
  readonly configError?: Readonly<{ code?: string; message: string }>;
}
export interface NativeDecisionProductsCandidate {
  readonly status: "products";
  readonly contractRevision: 1;
  readonly token: string;
  readonly generation: string;
  readonly inputCertificate: string;
  readonly governanceDigest: string;
  readonly basePolicyDigest: string;
  readonly policyDigest: string;
  readonly productsDigest: string;
  readonly productsJSON: string;
}
export type NativeDecisionIntrinsicRequirement =
  | Readonly<{ id: string; kind: "accept-step-id"; units: readonly number[] }>
  | Readonly<{ id: string; kind: "locale-sort"; values: readonly (readonly number[])[] }>;
export type NativeDecisionContinuation =
  | Readonly<{ token: string; kind: "source-observe"; request: unknown }>
  | Readonly<{ token: string; kind: "source-open"; generation: string; sourceSnapshotDigest: string }>
  | Readonly<{ token: string; kind: "source-complete"; generation: string; sourceSnapshotDigest: string; decisions: readonly unknown[] }>
  | Readonly<{
      token: string;
      kind: "policy";
      policy: {
        source: NativeDecisionPrepareRequest["policySource"];
        digest: string;
        disabled: readonly { ruleId: string; reason: string }[];
        ignorePatterns: readonly string[];
        ignorePatternUnits: readonly (readonly number[])[];
      };
      /** Required for legacy preparation; an initial offer can be omitted or repeated exactly. */
      implementationContracts?: readonly NativeDecisionImplementationContract[];
      leafAuthority: { neutralClassIconSVG: string };
    }>
  | Readonly<{
      token: string;
      kind: "intrinsics";
      answers: readonly (
        | Readonly<{ id: string; kind: "accept-step-id"; accepted: boolean }>
        | Readonly<{ id: string; kind: "locale-sort"; groups: readonly (readonly number[])[] }>
      )[];
    }>
  | Readonly<{ token: string; kind: "generic-retire" }>
  | Readonly<{ token: string; kind: "generic-engine"; engine: NativeDecisionGenericEngine }>
  | Readonly<{
      token: string;
      kind: "generic";
      engine: NativeDecisionGenericEngine;
      inputCertificate: string;
      generic: Readonly<{ status: "complete"; files: number; diagnostics: readonly unknown[] }>;
    }>;

export interface NativeDecisionGenericEngine {
  readonly version: string;
  readonly artifactDigest: string;
  /** Absolute selected installed oxlint/package.json, observed by this capture. */
  readonly packagePath: string;
  /** SHA256 of exactly that captured package file, including the actual version. */
  readonly packageRevision: string;
}
export interface NativeDecisionGenericRequest {
  readonly speculative?: boolean;
  readonly status: "generic";
  readonly token: string;
  readonly generation: string;
  readonly root: string;
  readonly requestedRoot: string;
  readonly inputCertificate: string;
  readonly engine?: NativeDecisionGenericEngine;
}
export interface NativeDecisionCaptureRequirement {
  readonly id: string;
  readonly kind: "metadata" | "read-bytes" | "directory" | "canonicalize" | "content-digest";
  readonly path: string;
  readonly followLinks?: boolean;
}
export type NativeDecisionCaptureObservation =
  | Readonly<{ id: string; status: "known"; value: unknown }>
  | Readonly<{
      id: string;
      status: "error";
      error: Readonly<{ kind: string; code: string; message: string }>;
    }>
  | Readonly<{ id: string; status: "unsupported"; value?: unknown }>;
export type NativeDecisionCaptureResult =
  | Readonly<{
      token: string;
      inputCertificate: string;
      observations: readonly NativeDecisionCaptureObservation[];
    }>
  | Readonly<{ status: "retry" }>;

export interface NativeDecisionSealRequest {
  readonly token: string;
  readonly reportDigest: string;
  readonly productsDigest?: string;
}

export type NativeDecisionSeal =
  | {
      readonly status: "committed";
      readonly token: string;
      readonly generation: string;
      readonly inputCertificate: string;
      readonly reportDigest: string;
      readonly productsDigest?: string;
    }
  | { readonly status: "retry" };

export interface NativeDecisionSession extends NativeCapturedAnalysisSource {
  prepare(request: NativeDecisionPrepareRequest, signal?: AbortSignal): Promise<unknown>;
  /** Continue the same private capture with canonical policy/intrinsic observations. */
  continue?(request: NativeDecisionContinuation, signal?: AbortSignal): Promise<unknown>;
  /** Reads belong to the same retained private capture, before products freeze. */
  captureProbes?(
    request: Readonly<{ token: string; requirements: readonly NativeDecisionCaptureRequirement[] }>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  /** Original worker belongs to the native capture, on its private verified channel. */
  captureOwnedGeneric?(request: Readonly<{token: string; configPath: string; config?: unknown; configBytes?: readonly number[]; commandIgnorePatterns: readonly string[]}>, signal?: AbortSignal): Promise<unknown>;
  /** The final whole-input barrier runs after the client privately admits the candidate. */
  seal(request: NativeDecisionSealRequest, signal?: AbortSignal): Promise<unknown>;
  dispose(): Promise<void>;
}

export class NativeDecisionServiceError extends Error {
  readonly name = "NativeDecisionServiceError";
  constructor(
    readonly code: "UNSUPPORTED" | "CANCELLED" | "PROTOCOL" | "PROCESS" | "NATIVE_ERROR",
    message: string,
    options?: ErrorOptions,
    readonly nativeError?: Readonly<{ code: string; message: string }>,
  ) {
    super(message, options);
  }
}
