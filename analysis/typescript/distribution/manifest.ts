import { readFile } from "node:fs/promises";

import { NATIVE_ANALYSIS_PROTOCOL_VERSION } from "../../protocol/model.ts";
import type {
  NativeAnalysisArtifact,
  NativeAnalysisReleaseManifest,
  NativeAnalysisTarget,
} from "./model.ts";
import { NativeAnalysisDistributionError } from "./model.ts";

export const NATIVE_RELEASE_FORMAT = "astrale.codegraph.native-release" as const;

/** Each target's executables live in this directory of the one published package. */
export const NATIVE_ARTIFACT_DIRECTORY = "native-artifacts" as const;

const NATIVE_ANALYSIS_TARGETS: readonly NativeAnalysisTarget[] = Object.freeze([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);

export async function readNativeReleaseManifest(
  path: string,
  packageVersion: string,
  target: string,
): Promise<NativeAnalysisReleaseManifest> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch (cause) {
    throw new NativeAnalysisDistributionError(
      "NATIVE_RELEASE_MANIFEST_INVALID",
      "Codegraph native release manifest is missing or invalid JSON.",
      target,
      { cause },
    );
  }
  const value = record(input);
  if (
    value.format !== NATIVE_RELEASE_FORMAT ||
    value.version !== 1 ||
    value.packageVersion !== packageVersion ||
    value.protocolVersion !== NATIVE_ANALYSIS_PROTOCOL_VERSION ||
    typeof value.sourceRevision !== "string" ||
    !/^[a-f0-9]{40}$/u.test(value.sourceRevision) ||
    !validToolchain(value.toolchain) ||
    !recordOrUndefined(value.artifacts)
  ) {
    throw new NativeAnalysisDistributionError(
      "NATIVE_RELEASE_MANIFEST_INVALID",
      "Codegraph native release manifest does not match the installed package or protocol.",
      target,
    );
  }
  const artifacts = value.artifacts as Readonly<Record<string, unknown>>;
  for (const [key, artifact] of Object.entries(artifacts)) {
    if (!isTarget(key) || !validArtifact(artifact, key)) {
      throw new NativeAnalysisDistributionError(
        "NATIVE_RELEASE_MANIFEST_INVALID",
        `Codegraph native release manifest contains an invalid ${key} artifact.`,
        target,
      );
    }
  }
  return input as NativeAnalysisReleaseManifest;
}

export function currentNativeAnalysisTarget(): string {
  return `${process.platform}-${process.arch}`;
}

function validArtifact(input: unknown, target: string): boolean {
  const value = record(input);
  return (
    value.target === target &&
    typeof value.executable === "string" &&
    portableArtifactPath(value.executable) &&
    Number.isSafeInteger(value.bytes) &&
    (value.bytes as number) > 0 &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

/** Admit only the companion capability; Go consumers do not consume its metadata. */
export function admitNativeOxlintArtifact(
  expected: NativeAnalysisArtifact,
): NonNullable<NativeAnalysisArtifact["oxlint"]> {
  if (!expected.oxlint || !["darwin-arm64", "linux-x64"].includes(expected.target)) {
    throw new NativeAnalysisDistributionError("NATIVE_OXLINT_UNAVAILABLE",
      `Codegraph has no packaged Oxlint worker for ${expected.target}.`, expected.target);
  }
  if (!validOxlint(expected.oxlint)) {
    throw new NativeAnalysisDistributionError("NATIVE_ARTIFACT_INVALID",
      `Oxlint worker descriptor is invalid for ${expected.target}.`, expected.target);
  }
  return expected.oxlint;
}

function validOxlint(input: unknown): boolean {
  const value = record(input);
  const source = record(value.source);
  return (
    value.executable === "bin/codegraph-oxlint" &&
    Number.isSafeInteger(value.bytes) && (value.bytes as number) > 0 &&
    typeof value.sha256 === "string" && /^[a-f0-9]{64}$/u.test(value.sha256) &&
    value.engineVersion === "1.81.0" && value.protocolVersion === 1 &&
    typeof source.revision === "string" && /^[a-f0-9]{40}$/u.test(source.revision) &&
    typeof source.patchSha256 === "string" && /^[a-f0-9]{64}$/u.test(source.patchSha256)
  );
}

function portableArtifactPath(value: string): boolean {
  return (
    Boolean(value) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function validToolchain(input: unknown): boolean {
  const value = record(input);
  return ["ttsc", "typescriptGo", "go"].every(
    (key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()),
  );
}

function recordOrUndefined(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return recordOrUndefined(value) ? value : {};
}

function isTarget(value: string): value is NativeAnalysisTarget {
  return (NATIVE_ANALYSIS_TARGETS as readonly string[]).includes(value);
}
