import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionProcess } from "../analysis/native/decision-session.ts";
import type { NativeDecisionPrepareRequest } from "../analysis/native/decision-model.ts";

const node = process.execPath;
const hello = { service: "astrale.lint-decision", protocol: 1, contractRevision: 1 };
const request: NativeDecisionPrepareRequest = {
  root: "/private/test",
  basePolicyDigest: "canonical",
  policySource: { rules: "", layers: [], dependencies: [], rootFiles: [], aliases: [] },
  ruleRevisions: [],
  options: {},
};
const transports: DecisionProcess[] = [];
function service(code: string, worker?: () => Promise<string | undefined>): DecisionProcess {
  const child = spawn(node, ["--input-type=module", "-e", code], { stdio: "pipe" });
  const transport = new DecisionProcess(child, worker);
  transports.push(transport);
  return transport;
}
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.dispose();
});

describe("native decision transport source qualification", () => {
  it('offers captured observations only when the selected binary negotiates revision one', async () => {
    const old = service(`console.log(JSON.stringify(${JSON.stringify(hello)}));setInterval(()=>{},10000);`);
    await old.ready();
    expect(old.semanticReaderRevision).toBeUndefined();
    expect(old.openSemanticProjection).toBeUndefined();
    const next = service(`console.log(JSON.stringify(${JSON.stringify({ ...hello, semanticReaderRevision: 1 })}));setInterval(()=>{},10000);`);
    await next.ready();
    expect(next.semanticReaderRevision).toBe(1);
    expect(typeof next.openSemanticProjection).toBe('function');
    const incompatible = service(`console.log(JSON.stringify(${JSON.stringify({ ...hello, semanticReaderRevision: 2 })}));setInterval(()=>{},10000);`);
    await expect(incompatible.ready()).rejects.toMatchObject({ code: 'PROTOCOL' });
  });

  it('owns the queued capture tuple and closes a lease without closing its session', async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify({ ...hello, semanticReaderRevision: 1 })}));let leases=0;
      createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),p=r.params;let result=p;
      if(r.method==='semantic-open')result={...p,lease:'lease-'+(++leases),project:{root:'/owned',config:'tsconfig.json',capabilities:['typescript.body-demand']}};
      if(r.method==='semantic-request')result={token:p.token,generation:p.generation,sourceSnapshotDigest:p.sourceSnapshotDigest,lease:p.lease,...(p.request.kind==='dispose'?{}:{response:{id:p.request.id,kind:'unchanged',generation:p.generation}})};
      setTimeout(()=>console.log(JSON.stringify({id:r.id,result})),10);});`);
    await transport.ready();
    const before = transport.prepare(request);
    const stamp = { token: 'first', generation: 'g1', sourceSnapshotDigest: 'a'.repeat(64) };
    const opening = transport.openSemanticProjection!(stamp);
    stamp.token = 'changed'; stamp.generation = 'changed'; stamp.sourceSnapshotDigest = 'b'.repeat(64);
    await before;
    const port = await opening;
    expect(await port.request({ id: 7, kind: 'refresh' })).toMatchObject({ generation: 'g1' });
    const closing = port.dispose();
    expect(port.dispose()).toBe(closing);
    await closing;
    expect(port.signal.aborted).toBe(true);
    expect(port.ownerSignal.aborted).toBe(false);
    await expect(port.request({ id: 8, kind: 'refresh' })).rejects.toThrow('disposed');
    const next = await transport.openSemanticProjection!({ token: 'next', generation: 'g2', sourceSnapshotDigest: 'c'.repeat(64) });
    expect(await next.request({ id: 1, kind: 'refresh' })).toMatchObject({ generation: 'g2' });
    await next.dispose();
  });

  it.each(['token', 'generation', 'sourceSnapshotDigest', 'lease', 'project'])('rejects an unowned semantic %s and invalidates its actor', async (field) => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify({ ...hello, semanticReaderRevision: 1 })}));
      createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),p=r.params;const result={...p,lease:'owned',project:{root:'/owned',config:'tsconfig.json',capabilities:[]}};result[${JSON.stringify(field)}]=null;console.log(JSON.stringify({id:r.id,result}));});`);
    await transport.ready();
    await expect(transport.openSemanticProjection!({ token: 'owned', generation: 'g', sourceSnapshotDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'PROTOCOL' });
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: 'PROCESS' });
  });

  it('waits for the fact owner exactly once when the native session is disposed', async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify({ ...hello, semanticReaderRevision: 1 })}));
      createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line),p=r.params;console.log(JSON.stringify({id:r.id,result:{...p,lease:'owned',project:{root:'/owned',config:'tsconfig.json',capabilities:[]}}}));});`);
    await transport.ready();
    const port = await transport.openSemanticProjection!({ token: 'owned', generation: 'g', sourceSnapshotDigest: 'a'.repeat(64) });
    let release!: () => void, calls = 0, settled = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    port.onOwnerDispose(async () => { calls++; await held; });
    const closing = transport.dispose().then(() => { settled = true; });
    await Promise.resolve();
    expect(port.ownerSignal.aborted).toBe(true);
    expect(port.signal.aborted).toBe(true);
    expect(settled).toBe(false);
    expect(calls).toBe(1);
    await port.dispose();
    release(); await closing; await transport.dispose();
    expect(calls).toBe(1);
    expect(() => port.onOwnerDispose(async () => {})).toThrow('unavailable');
  });

  it("admits split UTF8 frames and routes only the current request identity", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline'; const line=Buffer.from(JSON.stringify(${JSON.stringify(hello)})+'\\n'); process.stdout.write(line.subarray(0,9)); process.stdout.write(line.subarray(9)); createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line); const bytes=Buffer.from(JSON.stringify({id:r.id,result:{status:'partial',residual:['é🌱']}})+'\\n'); for(let i=0;i<bytes.length;i++)process.stdout.write(bytes.subarray(i,i+1));});`,
    );
    await transport.ready();
    expect(await transport.prepare(request)).toEqual({ status: "partial", residual: ["é🌱"] });
    expect(await transport.seal({ token: "t", reportDigest: "h" })).toEqual({
      status: "partial",
      residual: ["é🌱"],
    });
  });
  it("continues canonical policy on the existing serialized capture channel", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:{method:r.method,token:r.params.token,answers:r.params.answers}}));});`,
    );
    await transport.ready();
    expect(
      await transport.continue({
        token: "owned-token",
        kind: "intrinsics",
        answers: [{ id: "units", kind: "accept-step-id", accepted: true }],
      }),
    ).toEqual({
      method: "continue",
      token: "owned-token",
      answers: [{ id: "units", kind: "accept-step-id", accepted: true }],
    });
  });
  it("routes captured I/O and the bound generic descriptor through the same session", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:{method:r.method,params:r.params}}));});`,
    );
    await transport.ready();
    const probes = {
      token: "capture-token",
      requirements: [
        {
          id: "negative",
          kind: "metadata" as const,
          path: "/captured/oxlint-suppressions.json",
          followLinks: true,
        },
      ],
    };
    expect(await transport.captureProbes(probes)).toEqual({
      method: "capture-probes",
      params: probes,
    });
    const engine = {
      version: "1.81.0",
      artifactDigest: "a".repeat(64),
      packagePath: "/captured/node_modules/oxlint/package.json",
      packageRevision: "b".repeat(64),
    };
    expect(
      await transport.continue({ token: "capture-token", kind: "generic-engine", engine }),
    ).toEqual({
      method: "continue",
      params: { token: "capture-token", kind: "generic-engine", engine },
    });
  });
  it("keeps old strict generic frames unchanged when no encoded addressing is required", async () => {
    const transport = service(`import {createInterface} from 'node:readline'; console.log(JSON.stringify(${JSON.stringify(hello)}));
      createInterface({input:process.stdin}).on('line',line=>{ const r=JSON.parse(line);
        if(r.method==='capture-owned-generic' && 'artifactPath' in r.params) throw Error('unknown field');
        console.log(JSON.stringify({id:r.id,result:r.params})); });`);
    await transport.ready();
    const input = { token: 'raw', configPath: '/raw/.oxlintrc.json', config: {}, commandIgnorePatterns: [] };
    expect(await transport.captureOwnedGeneric(input)).toEqual(input);
  });

  it("materializes only at generic use and owns request bytes before the lazy yield", async () => {
    let calls = 0;
    let resolveWorker!: (path: string) => void;
    const worker = () => { calls++; return new Promise<string>((resolve) => { resolveWorker = resolve; }); };
    const transport = service(`import {createInterface} from 'node:readline'; console.log(JSON.stringify(${JSON.stringify(hello)})); let genericSeen=false;
      createInterface({input:process.stdin}).on('line',line=>{ const r=JSON.parse(line); if(r.method==='capture-owned-generic') genericSeen=true; if(r.method==='seal'&&!genericSeen) throw Error('overtaken'); console.log(JSON.stringify({id:r.id,result:r.params})); });`, worker);
    await transport.ready();
    await transport.prepare(request);
    await transport.continue({ token: 'source-only', kind: 'source-open', generation: 'g', sourceSnapshotDigest: 's' });
    expect(calls).toBe(0);
    const input = { token: 'original', configPath: '/cache/.oxlintrc.json', config: { rules: {} }, commandIgnorePatterns: [] as string[] };
    const pending = transport.captureOwnedGeneric(input);
    const later = transport.seal({ token: 'later', reportDigest: 'digest' });
    input.token = 'changed'; input.commandIgnorePatterns.push('changed');
    resolveWorker('/cache/worker-sha');
    expect(await pending).toEqual({ token: 'original', configPath: '/cache/.oxlintrc.json', config: { rules: {} }, commandIgnorePatterns: [], artifactPath: '/cache/worker-sha' });
    expect(await later).toEqual({ token: 'later', reportDigest: 'digest' });
    expect(calls).toBe(1);
  });

  it("keeps the unavailable Go-only worker's request shape unchanged", async () => {
    const transport = service(`import {createInterface} from 'node:readline'; console.log(JSON.stringify(${JSON.stringify(hello)}));
      createInterface({input:process.stdin}).on('line',line=>{ const r=JSON.parse(line); console.log(JSON.stringify({id:r.id,result:r.params})); });`, async () => undefined);
    await transport.ready();
    const input = { token: 'go-only', configPath: '/go/.oxlintrc.json', config: {}, commandIgnorePatterns: [] };
    expect(await transport.captureOwnedGeneric(input)).toEqual(input);
  });

  it("negotiates exact old unsupported command without masking unrelated native crash", async () => {
    const old = service(
      `process.stderr.write('astrale-typespec-v2-analysis: unknown command "decision-serve"\\n');process.exitCode=1;`,
    );
    await expect(old.ready()).rejects.toMatchObject({ code: "UNSUPPORTED" });
    const crash = service(`process.stderr.write('permission denied\\n');process.exitCode=1;`);
    await expect(crash.ready()).rejects.toMatchObject({ code: "PROCESS" });
  });
  it.each([
    ["stale response ID", "{id:r.id+1,result:{}}"],
    ["dual error/result", '{id:r.id,result:{},error:{code:"x",message:"x"}}'],
    ["malformed error", '{id:r.id,error:{code:1,message:"x"}}'],
  ])("rejects %s and invalidates the process", async (_name, response) => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)})); createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify(${response}));});`,
    );
    await transport.ready();
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROTOCOL" });
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROCESS" });
  });
  it("rejects fatal UTF8 decoding rather than replacing protocol bytes", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',()=>process.stdout.write(Buffer.from([0xff,10])));`,
    );
    await transport.ready();
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROTOCOL" });
  });
  it("keeps native canonical error code/message, then admits the next request", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));let n=0;createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify(n++ ? {id:r.id,result:{status:'partial',residual:['unimplemented']}} : {id:r.id,error:{code:'LINTER_PROJECT_INVALID',message:'Captured input invalid.'}}));});`,
    );
    await transport.ready();
    await expect(transport.prepare(request)).rejects.toMatchObject({
      code: "NATIVE_ERROR",
      nativeError: { code: "LINTER_PROJECT_INVALID", message: "Captured input invalid." },
    });
    expect(await transport.prepare(request)).toMatchObject({ status: "partial" });
  });
  it("cancels an in-flight process and cannot replay its private candidate", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',()=>{});`,
    );
    await transport.ready();
    const controller = new AbortController();
    const pending = transport.prepare(request, controller.signal);
    controller.abort("cancelled");
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROCESS" });
  });
  it("owns concurrent requests in FIFO order without overlapping native work", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));let active=false;createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(active)process.exit(9);active=true;setTimeout(()=>{active=false;console.log(JSON.stringify({id:r.id,result:{id:r.id,method:r.method,token:r.params.token}}));},10);});`,
    );
    await transport.ready();
    const first = transport.prepare(request);
    const second = transport.captureProbes({ token: "epoch1", requirements: [] });
    const third = transport.seal({ token: "epoch2", reportDigest: "h" });
    expect(await Promise.all([first, second, third])).toEqual([
      { id: 1, method: "prepare" },
      { id: 2, method: "capture-probes", token: "epoch1" },
      { id: 3, method: "seal", token: "epoch2" },
    ]);
  });
  it("captures queued params before caller mutation and never rewrites their epoch", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({id:r.id,result:r.params})),10);});`);
    await transport.ready();
    const first = transport.prepare(request);
    const params = { token: "old-epoch", requirements: [{ id: "a", kind: "metadata" as const, path: "/original", followLinks: true }] };
    const queued = transport.captureProbes(params);
    params.token = "new-epoch";
    params.requirements[0]!.path = "/changed";
    await first;
    expect(await queued).toEqual({ token: "old-epoch", requirements: [{ id: "a", kind: "metadata", path: "/original", followLinks: true }] });
  });
  it("cancels a queued request without sending it or invalidating its actor", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({id:r.id,result:{id:r.id,token:r.params.token}})),10);});`);
    await transport.ready();
    const first = transport.prepare(request);
    const abort = new AbortController();
    const queued = transport.captureProbes({ token: "cancel-me", requirements: [] }, abort.signal);
    const failure = expect(queued).rejects.toMatchObject({ code: "CANCELLED", cause: "queued" });
    const last = transport.seal({ token: "live", reportDigest: "h" });
    abort.abort("queued");
    await failure;
    expect(await first).toEqual({ id: 1 });
    expect(await last).toEqual({ id: 3, token: "live" });
    expect(await transport.prepare(request)).toEqual({ id: 4 });
  });
  it("invalidates active and queued jobs on active cancellation, then permits a fresh actor", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',()=>{});`);
    await transport.ready();
    const abort = new AbortController();
    const first = transport.prepare(request, abort.signal);
    const queued = transport.seal({ token: "old", reportDigest: "h" });
    const failures = Promise.allSettled([first, queued]);
    abort.abort("active");
    expect(await failures).toMatchObject([{ status: "rejected", reason: { code: "CANCELLED", cause: "active" } }, { status: "rejected", reason: { code: "CANCELLED", cause: "active" } }]);
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROCESS" });
    const fresh = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:r.params}));});`);
    await fresh.ready();
    expect(await fresh.seal({ token: "fresh", reportDigest: "h" })).toEqual({ token: "fresh", reportDigest: "h" });
  });
  it("detaches settled request cancellation and shares a single disposal", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:{id:r.id}}));});`);
    await transport.ready();
    const abort = new AbortController();
    expect(await transport.prepare(request, abort.signal)).toEqual({ id: 1 });
    abort.abort("finished");
    expect(await transport.prepare(request)).toEqual({ id: 2 });
    const closing = transport.dispose();
    expect(transport.dispose()).toBe(closing);
    await closing;
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROCESS" });
  });
  it("rejects every owned job on disposal or a malformed physical response", async () => {
    for (const response of ["none", "invalid"]) {
      const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',()=>{${response === "invalid" ? "setTimeout(()=>process.stdout.write('not-json\\n'),10);" : ""}});`);
      await transport.ready();
      const first = transport.prepare(request);
      const second = transport.captureProbes({ token: "t", requirements: [] });
      const failures = Promise.allSettled([first, second]);
      if (response === "none") await transport.dispose();
      const code = response === "none" ? "PROCESS" : "PROTOCOL";
      expect(await failures).toMatchObject([{ status: "rejected", reason: { code } }, { status: "rejected", reason: { code } }]);
    }
  });
  it("keeps native errors request-local while the queued request progresses", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));let n=0;createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify(n++ ? {id:r.id,result:{token:r.params.token}} : {id:r.id,error:{code:'LINTER_PROJECT_INVALID',message:'Captured input invalid.'}}));});`);
    await transport.ready();
    const first = transport.prepare(request);
    const second = transport.seal({ token: "actual", reportDigest: "h" });
    await expect(first).rejects.toMatchObject({ code: "NATIVE_ERROR", nativeError: { code: "LINTER_PROJECT_INVALID", message: "Captured input invalid." } });
    expect(await second).toEqual({ token: "actual" });
  });
  it("does not let an unsolicited extra frame impersonate the next queued response", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,result:{first:true}})+'\\n'+JSON.stringify({id:r.id+1,result:{forged:true}})+'\\n');});`);
    await transport.ready();
    const first = transport.prepare(request);
    const second = transport.seal({ token: "t", reportDigest: "h" });
    const settled = await Promise.allSettled([first, second]);
    expect(settled).toMatchObject([{ status: "fulfilled", value: { first: true } }, { status: "rejected", reason: { code: "PROTOCOL" } }]);
  });
  it("reserves FIFO ownership during reentrant encoding and recovers from local encode failure", async () => {
    const transport = service(`import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);console.log(JSON.stringify({id:r.id,result:{id:r.id,method:r.method}}));});`);
    await transport.ready();
    let queued!: Promise<unknown>;
    const reentrant = { ...request, toJSON() { queued = transport.seal({ token: "t", reportDigest: "h" }); return request; } };
    const first = transport.prepare(reentrant);
    expect(await Promise.all([first, queued])).toEqual([{ id: 1, method: "prepare" }, { id: 2, method: "seal" }]);
    const failure = new TypeError("cannot encode");
    const invalid = { ...request, toJSON() { queued = transport.prepare(request); throw failure; } };
    await expect(transport.prepare(invalid)).rejects.toBe(failure);
    expect(await queued).toEqual({ id: 4, method: "prepare" });
  });
  it("contains pipe failures within the actor and rejects queued work", async () => {
    const transport = service(`import {closeSync} from 'node:fs';closeSync(0);console.log(JSON.stringify(${JSON.stringify(hello)}));setInterval(()=>{},10000);`);
    await transport.ready();
    const jobs = [transport.prepare(request), transport.seal({ token: "t", reportDigest: "h" })];
    expect(await Promise.allSettled(jobs)).toMatchObject([{ status: "rejected", reason: { code: "PROCESS" } }, { status: "rejected", reason: { code: "PROCESS" } }]);
  });
});
