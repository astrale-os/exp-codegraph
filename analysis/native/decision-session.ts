import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { NativeDecisionServiceError, type NativeDecisionSession } from "./decision-model.ts";
import { resolvePackagedNativeAnalysis, resolveOptionalPackagedNativeOxlint } from "../typescript/distribution/resolve.ts";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const UNSUPPORTED = 'astrale-typespec-v2-analysis: unknown command "decision-serve"';

interface DecisionRequest {
  readonly id: number;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
  line?: string;
  state: "queued" | "active" | "settled";
}

export interface NativeDecisionProcessOptions {
  readonly root: string;
  readonly binary?: string;
  readonly signal?: AbortSignal;
  readonly handshakeTimeoutMs?: number;
}

/** Resolve the existing qualified packaged asset through its original owner. */
export async function openNativeDecisionSession(
  options: NativeDecisionProcessOptions,
): Promise<NativeDecisionSession> {
  if (options.signal?.aborted) throw cancelled(options.signal.reason);
  const artifact = await resolvePackagedNativeAnalysis({ binary: options.binary });
  if (options.signal?.aborted) throw cancelled(options.signal.reason);
  const child = spawn(artifact.command, ["decision-serve", "--cwd", options.root], {
    stdio: "pipe",
    // Semantic cwd remains the explicit --cwd operand. A nonexistent Domain
    // still needs configuration/coverage admission before source discovery.
    cwd: process.cwd(),
  });
  // Storage selects the addressing strategy, not a protocol revision. Qualified
  // gzip builds accept the optional explicit path; old raw binaries strictly
  // reject unknown request fields and must retain their original adjacency.
  const transport = new DecisionProcess(child, artifact.compression ? async () =>
    (await resolveOptionalPackagedNativeOxlint())?.command : undefined);
  await transport.ready(options.signal, options.handshakeTimeoutMs ?? 30_000);
  return transport;
}

/** Exported for source-level transport qualification; production uses the asset resolver above. */
export class DecisionProcess implements NativeDecisionSession {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #ownedArtifactPath?: () => Promise<string | undefined>;
  readonly #hello: Promise<void>;
  readonly #exit: Promise<void>;
  #resolveHello!: () => void;
  #rejectHello!: (error: Error) => void;
  #handshaken = false;
  #closed = false;
  #nextId = 1;
  #chunks: Buffer[] = [];
  #bytes = 0;
  #stderr = "";
  #pending?: DecisionRequest;
  readonly #queue: DecisionRequest[] = [];
  #pumpScheduled = false;
  #disposing?: Promise<void>;

  constructor(child: ChildProcessWithoutNullStreams, ownedArtifactPath?: () => Promise<string | undefined>) {
    this.#child = child;
    this.#ownedArtifactPath = ownedArtifactPath;
    this.#exit = new Promise((resolve) => child.once("close", () => resolve()));
    this.#hello = new Promise((resolve, reject) => {
      this.#resolveHello = resolve;
      this.#rejectHello = reject;
    });
    child.stdout.on("data", (chunk: Buffer) => this.#read(chunk));
    child.stdin.on("error", (cause) =>
      this.#fail(new NativeDecisionServiceError("PROCESS", "Decision request write failed.", { cause })),
    );
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-MAX_STDERR_BYTES);
    });
    child.on("error", (cause) =>
      this.#fail(
        new NativeDecisionServiceError("PROCESS", "Decision service failed to start.", { cause }),
      ),
    );
    child.on("close", (code) => {
      if (this.#closed) return;
      const unsupported = !this.#handshaken && this.#stderr.trim() === UNSUPPORTED;
      this.#fail(
        new NativeDecisionServiceError(
          unsupported ? "UNSUPPORTED" : "PROCESS",
          `Decision service closed (${code}): ${this.#stderr}`,
        ),
      );
    });
  }

  async ready(signal?: AbortSignal, timeoutMs = 30_000): Promise<void> {
    const timer = setTimeout(
      () =>
        this.#fail(
          new NativeDecisionServiceError("PROCESS", "Decision service handshake timed out."),
        ),
      timeoutMs,
    );
    try {
      await this.#abortable(this.#hello, signal);
    } finally {
      clearTimeout(timer);
    }
  }

  prepare(
    request: Parameters<NativeDecisionSession["prepare"]>[0],
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request("prepare", request, signal);
  }

  continue(
    request: import("./decision-model.ts").NativeDecisionContinuation,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request("continue", request, signal);
  }

  captureProbes(
    request: Parameters<NonNullable<NativeDecisionSession["captureProbes"]>>[0],
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request("capture-probes", request, signal);
  }

  captureOwnedGeneric(request: Parameters<NonNullable<NativeDecisionSession["captureOwnedGeneric"]>>[0], signal?: AbortSignal): Promise<unknown> {
    return this.#request("capture-owned-generic", request, signal, this.#ownedArtifactPath);
  }

  seal(
    request: Parameters<NativeDecisionSession["seal"]>[0],
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request("seal", request, signal);
  }

  dispose(): Promise<void> {
    if (this.#disposing) return this.#disposing;
    this.#fail(new NativeDecisionServiceError("PROCESS", "Decision session disposed."));
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 2_000);
    this.#disposing = this.#exit.finally(() => {
      clearTimeout(timer);
    });
    return this.#disposing;
  }

  #request(method: string, params: unknown, signal?: AbortSignal, ownedArtifactPath?: () => Promise<string | undefined>): Promise<unknown> {
    if (this.#closed || !this.#handshaken)
      return Promise.reject(
        new NativeDecisionServiceError("PROCESS", "Decision session is unavailable."),
      );
    if (signal?.aborted) return Promise.reject(cancelled(signal.reason));
    return new Promise<unknown>((resolve, reject) => {
      const request: DecisionRequest = {
        id: this.#nextId++, resolve, reject, signal, state: "queued",
      };
      // Reserve the FIFO position before encoding. Even a reentrant toJSON
      // cannot dispatch a later request before this admission is complete.
      this.#queue.push(request);
      request.abort = () => {
        const error = cancelled(signal?.reason);
        if (request.state === "active") this.#fail(error);
        else if (request.state === "queued") this.#rejectQueued(request, error);
      };
      signal?.addEventListener("abort", request.abort, { once: true });
      if (signal?.aborted) request.abort();
      if (request.state !== "queued") return;
      try {
        // Immutable admission bytes own the params and token. They are never
        // reread from the caller or remapped to a subsequent capture epoch.
        const line = JSON.stringify({ id: request.id, method, params }) + "\n";
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES)
          throw new NativeDecisionServiceError(
            "PROTOCOL", "Decision request exceeds its byte limit.",
          );
        if (ownedArtifactPath) {
          // Reserve FIFO and own serialized caller bytes before lazy extraction.
          // A later request cannot overtake this request while storage is prepared.
          const captured = JSON.parse(line) as { id: number; method: string; params: Record<string, unknown> };
          void ownedArtifactPath().then((artifactPath) => {
            if (request.state !== "queued") return;
            const ready = artifactPath ? JSON.stringify({ ...captured, params: { ...captured.params, artifactPath } }) + "\n" : line;
            if (Buffer.byteLength(ready) > MAX_FRAME_BYTES) throw new NativeDecisionServiceError("PROTOCOL", "Decision request exceeds its byte limit.");
            request.line = ready;
            this.#pump();
          }).catch((cause: unknown) => { if (request.state === "queued") this.#rejectQueued(request, cause); });
        } else if (request.state === "queued") request.line = line;
      } catch (cause) {
        if (request.state === "queued") this.#rejectQueued(request, cause);
      }
      this.#pump();
    });
  }

  #settled(request: DecisionRequest): void {
    request.state = "settled";
    if (request.abort) request.signal?.removeEventListener("abort", request.abort);
  }

  #rejectQueued(request: DecisionRequest, error: unknown): void {
    const index = this.#queue.indexOf(request);
    if (index < 0) return;
    this.#queue.splice(index, 1);
    this.#settled(request);
    request.reject(error);
    this.#pump();
  }

  #schedulePump(): void {
    if (this.#pumpScheduled || this.#closed) return;
    this.#pumpScheduled = true;
    // Drain the complete incoming chunk first. An extra unsolicited frame
    // cannot borrow the next queued request's response identity.
    queueMicrotask(() => {
      this.#pumpScheduled = false;
      this.#pump();
    });
  }

  // This actor alone owns the physical protocol. At most one job is active;
  // queued jobs own admission bytes but gain no authority over an active token.
  #pump(): void {
    if (this.#closed || this.#pending || this.#pumpScheduled) return;
    const request = this.#queue[0];
    if (!request?.line) return;
    this.#queue.shift();
    request.state = "active";
    this.#pending = request;
    this.#child.stdin.write(request.line, (cause) => {
      if (cause)
        this.#fail(
          new NativeDecisionServiceError("PROCESS", "Decision request write failed.", { cause }),
        );
    });
  }

  async #abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    const abort = () => this.#fail(cancelled(signal?.reason));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      return await promise;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  #read(chunk: Buffer): void {
    if (this.#closed) return;
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const piece = chunk.subarray(offset, end < 0 ? chunk.length : end);
      this.#bytes += piece.length;
      if (this.#bytes > MAX_FRAME_BYTES) {
        this.#fail(
          new NativeDecisionServiceError("PROTOCOL", "Decision response exceeds its byte limit."),
        );
        return;
      }
      this.#chunks.push(piece);
      if (end < 0) return;
      const bytes = Buffer.concat(this.#chunks, this.#bytes);
      this.#chunks = [];
      this.#bytes = 0;
      offset = end + 1;
      let frame: Record<string, unknown>;
      try {
        const decoded: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
          throw new Error("Not an object");
        frame = decoded as Record<string, unknown>;
      } catch (cause) {
        this.#fail(
          new NativeDecisionServiceError("PROTOCOL", "Malformed decision frame.", { cause }),
        );
        return;
      }
      if (!this.#handshaken) {
        if (
          frame.service !== "astrale.lint-decision" ||
          frame.protocol !== 1 ||
          frame.contractRevision !== 1
        ) {
          this.#fail(
            new NativeDecisionServiceError(
              "PROTOCOL",
              "Decision service contract is incompatible.",
            ),
          );
          return;
        }
        this.#handshaken = true;
        this.#resolveHello();
        continue;
      }
      const pending = this.#pending;
      if (!pending || frame.id !== pending.id || "result" in frame === "error" in frame) {
        this.#fail(
          new NativeDecisionServiceError(
            "PROTOCOL",
            "Decision response does not own the pending request.",
          ),
        );
        return;
      }
      if ("error" in frame) {
        const error = frame.error as Record<string, unknown> | null;
        if (
          !error ||
          typeof error !== "object" ||
          typeof error.code !== "string" ||
          typeof error.message !== "string"
        ) {
          const malformed = new NativeDecisionServiceError(
            "PROTOCOL",
            "Malformed native decision error.",
          );
          this.#fail(malformed);
          return;
        }
        this.#pending = undefined;
        this.#settled(pending);
        this.#schedulePump();
        pending.reject(
          new NativeDecisionServiceError(
            "NATIVE_ERROR",
            error.message,
            undefined,
            Object.freeze({ code: error.code, message: error.message }),
          ),
        );
      } else {
        this.#pending = undefined;
        this.#settled(pending);
        this.#schedulePump();
        pending.resolve(frame.result);
      }
    }
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectHello(error);
    if (this.#pending) {
      this.#settled(this.#pending);
      this.#pending.reject(error);
    }
    this.#pending = undefined;
    for (const request of this.#queue.splice(0)) {
      this.#settled(request);
      request.reject(error);
    }
    this.#child.kill();
    this.#chunks = [];
    this.#bytes = 0;
  }
}

function cancelled(cause?: unknown): NativeDecisionServiceError {
  return new NativeDecisionServiceError("CANCELLED", "Decision operation cancelled.", { cause });
}
