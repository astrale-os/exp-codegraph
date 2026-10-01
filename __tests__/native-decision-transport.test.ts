import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { DecisionProcess } from "../analysis/native/decision-session.ts";
import type { NativeDecisionPrepareRequest } from "../analysis/native/decision-model.ts";

const node =
  "/Users/bryandjafer/Documents/astrale/.worktrees/linter-field-study-20260930/tools/node-v26.7.0-darwin-arm64/bin/node";
const hello = { service: "astrale.lint-decision", protocol: 1, contractRevision: 1 };
const request: NativeDecisionPrepareRequest = {
  root: "/private/test",
  basePolicyDigest: "canonical",
  policySource: { rules: "", layers: [], dependencies: [], rootFiles: [], aliases: [] },
  ruleRevisions: [],
  options: {},
};
const transports: DecisionProcess[] = [];
function service(code: string): DecisionProcess {
  const child = spawn(node, ["--input-type=module", "-e", code], { stdio: "pipe" });
  const transport = new DecisionProcess(child);
  transports.push(transport);
  return transport;
}
afterEach(async () => {
  for (const transport of transports.splice(0)) await transport.dispose();
});

describe("native decision transport source qualification", () => {
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
  it("rejects concurrent unowned requests without corrupting the first request", async () => {
    const transport = service(
      `import {createInterface} from 'node:readline';console.log(JSON.stringify(${JSON.stringify(hello)}));createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);setTimeout(()=>console.log(JSON.stringify({id:r.id,result:{status:'partial',residual:['unimplemented']}})),10);});`,
    );
    await transport.ready();
    const first = transport.prepare(request);
    await expect(transport.prepare(request)).rejects.toMatchObject({ code: "PROTOCOL" });
    expect(await first).toMatchObject({ status: "partial" });
  });
});
