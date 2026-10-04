import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openNativeDecisionSession } from "../analysis/native/decision-session.ts";
import type { NativeDecisionConfiguration, NativeDecisionSession } from "../analysis/native/decision-model.ts";

const roots: string[] = [];
const sessions: NativeDecisionSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "decision-fifo-")));
  roots.push(root);
  const packages = await Promise.all(["sdk", "kernel", "client"].map(async (name) => {
    const directory = join(root, "node_modules", "@astrale-os", name);
    await mkdir(directory, { recursive: true });
    const manifest = JSON.stringify({ name: `@astrale-os/${name}`, version: "0.0.0-test", exports: "./index.js" });
    await writeFile(join(directory, "package.json"), manifest);
    await writeFile(join(directory, "index.js"), "export {};\n");
    return { directory, manifest };
  }));
  const session = await openNativeDecisionSession({ root, ...(process.env.CODEGRAPH_TEST_NATIVE_BINARY ? { binary: process.env.CODEGRAPH_TEST_NATIVE_BINARY } : {}) });
  sessions.push(session);
  const prepare = () => session.prepare({ projectionMode: "sdk-rule-products", root, basePolicyDigest: "canonical", policySource: { rules: "", layers: [], dependencies: [], rootFiles: [], aliases: [] }, ruleRevisions: [], options: {} }) as Promise<NativeDecisionConfiguration>;
  const configuration = await prepare();
  expect(configuration.status).toBe("configuration");
  return { root, packages, session, configuration, prepare };
}

describe("native decision FIFO capture ownership", () => {
  it("retries product-less seals without consuming a pending products capture", async () => {
    const { root, session, configuration, prepare } = await fixture();
    const request = { token: configuration.token, reportDigest: "a".repeat(64) };
    const requirements = [{ id: "root", kind: "directory" as const, path: root }];
    const probe = { token: configuration.token, requirements };
    const before = await session.captureProbes!(probe);
    expect(await session.seal(request)).toEqual({ status: "retry" });
    expect(await session.seal(request)).toEqual({ status: "retry" });
    expect(await session.captureProbes!(probe)).toEqual(before);
    expect(await session.seal({ ...request, productsDigest: "b".repeat(64) })).toEqual({ status: "retry" });
    expect(await session.captureProbes!(probe)).toEqual(before);
    const next = await prepare();
    expect(next.status).toBe("configuration");
    expect(await session.seal(request)).toEqual({ status: "retry" });
    const current = { token: next.token, reportDigest: "a".repeat(64) };
    const currentProbe = { token: next.token, requirements };
    const after = await session.captureProbes!(currentProbe);
    expect(await session.seal(current)).toEqual({ status: "retry" });
    expect(await session.seal(current)).toEqual({ status: "retry" });
    expect(await session.captureProbes!(currentProbe)).toEqual(after);
  });

  it("admits parallel canonical package reads on one actual native capture", async () => {
    const { packages, session, configuration } = await fixture();
    const results = await Promise.all(packages.map(({ directory }) => session.captureProbes!({ token: configuration.token, requirements: [
      { id: "path", kind: "canonicalize", path: directory },
      { id: "manifest", kind: "read-bytes", path: join(directory, "package.json") },
      { id: "metadata", kind: "metadata", path: join(directory, "package.json"), followLinks: true },
    ] })));
    for (let index = 0; index < results.length; index++) {
      expect(results[index]).toMatchObject({ token: configuration.token, observations: [
        { id: "path", status: "known", value: { path: packages[index]!.directory } },
        { id: "manifest", status: "known", value: { bytesBase64: Buffer.from(packages[index]!.manifest).toString("base64") } },
        { id: "metadata", status: "known", value: { isFile: true } },
      ] });
    }
  });

  it("preserves a queued old token across prepare instead of borrowing the new capture", async () => {
    const { root, session, configuration, prepare } = await fixture();
    const next = prepare();
    const stale = session.captureProbes!({ token: configuration.token, requirements: [{ id: "root", kind: "directory", path: root }] });
    const current = await next;
    expect(current.token).not.toBe(configuration.token);
    expect(await stale).toEqual({ status: "retry" });
    expect(await session.captureProbes!({ token: current.token, requirements: [{ id: "root", kind: "directory", path: root }] })).toMatchObject({ token: current.token, observations: [{ id: "root", status: "known" }] });
  });

  it("keeps an actual native batch error local while queued valid work progresses", async () => {
    const { root, session, configuration } = await fixture();
    const invalid = session.captureProbes!({ token: configuration.token, requirements: [] });
    const valid = session.captureProbes!({ token: configuration.token, requirements: [{ id: "root", kind: "directory", path: root }] });
    await expect(invalid).rejects.toMatchObject({ code: "NATIVE_ERROR", nativeError: { code: "LINTER_PROJECT_INVALID", message: "captured I/O batch outside admission bounds" } });
    expect(await valid).toMatchObject({ token: configuration.token, observations: [{ id: "root", status: "known" }] });
  });
});
