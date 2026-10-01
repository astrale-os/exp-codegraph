/** Compact final products; no generic analysis facts cross this boundary. */
export const NATIVE_DECISION_PROTOCOL_VERSION = 1 as const;
export const NATIVE_DECISION_CONTRACT_REVISION = 1 as const;

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
  readonly options: {
    readonly requiredRuleIds?: readonly string[];
    readonly generic?: boolean;
    readonly fix?: boolean;
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
      implementationContracts: readonly {
        ruleId: string;
        ruleRevision: string;
        requiredFacts: readonly string[];
        implementation: { id: string; version: string };
      }[];
      leafAuthority: { neutralClassIconSVG: string };
    }>
  | Readonly<{
      token: string;
      kind: "intrinsics";
      answers: readonly (
        | Readonly<{ id: string; kind: "accept-step-id"; accepted: boolean }>
        | Readonly<{ id: string; kind: "locale-sort"; groups: readonly (readonly number[])[] }>
      )[];
    }>;

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

export interface NativeDecisionSession {
  prepare(request: NativeDecisionPrepareRequest, signal?: AbortSignal): Promise<unknown>;
  /** Continue the same private capture with canonical policy/intrinsic observations. */
  continue?(request: NativeDecisionContinuation, signal?: AbortSignal): Promise<unknown>;
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
