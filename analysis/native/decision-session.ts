import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { NativeDecisionServiceError, type NativeDecisionSession } from "./decision-model.ts";
import { resolvePackagedNativeAnalysis } from "../typescript/distribution/resolve.ts";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const UNSUPPORTED = 'astrale-typespec-v2-analysis: unknown command "decision-serve"';

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
    cwd: options.root,
  });
  const transport = new DecisionProcess(child);
  await transport.ready(options.signal, options.handshakeTimeoutMs ?? 30_000);
  return transport;
}

/** Exported for source-level transport qualification; production uses the asset resolver above. */
export class DecisionProcess implements NativeDecisionSession {
  readonly #child: ChildProcessWithoutNullStreams;
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
  #pending?: { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void };

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    this.#exit = new Promise((resolve) => child.once("close", () => resolve()));
    this.#hello = new Promise((resolve, reject) => {
      this.#resolveHello = resolve;
      this.#rejectHello = reject;
    });
    child.stdout.on("data", (chunk: Buffer) => this.#read(chunk));
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
    return this.#request("capture-owned-generic", request, signal);
  }

  seal(
    request: Parameters<NativeDecisionSession["seal"]>[0],
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request("seal", request, signal);
  }

  async dispose(): Promise<void> {
    this.#fail(new NativeDecisionServiceError("PROCESS", "Decision session disposed."));
    const timer = setTimeout(() => this.#child.kill("SIGKILL"), 2_000);
    try {
      await this.#exit;
    } finally {
      clearTimeout(timer);
    }
  }

  #request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.#closed || !this.#handshaken)
      return Promise.reject(
        new NativeDecisionServiceError("PROCESS", "Decision session is unavailable."),
      );
    if (this.#pending)
      return Promise.reject(
        new NativeDecisionServiceError("PROTOCOL", "Decision requests must be serialized."),
      );
    if (signal?.aborted) return Promise.reject(cancelled(signal.reason));
    const id = this.#nextId++;
    const line = JSON.stringify({ id, method, params }) + "\n";
    if (Buffer.byteLength(line) > MAX_FRAME_BYTES)
      return Promise.reject(
        new NativeDecisionServiceError("PROTOCOL", "Decision request exceeds its byte limit."),
      );
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending = { id, resolve, reject };
      this.#child.stdin.write(line, (cause) => {
        if (cause)
          this.#fail(
            new NativeDecisionServiceError("PROCESS", "Decision request write failed.", { cause }),
          );
      });
    });
    return this.#abortable(response, signal);
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
      this.#pending = undefined;
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
          pending.reject(malformed);
          this.#fail(malformed);
          return;
        }
        pending.reject(
          new NativeDecisionServiceError(
            "NATIVE_ERROR",
            error.message,
            undefined,
            Object.freeze({ code: error.code, message: error.message }),
          ),
        );
      } else pending.resolve(frame.result);
    }
  }

  #fail(error: Error): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectHello(error);
    this.#pending?.reject(error);
    this.#pending = undefined;
    this.#child.kill();
    this.#chunks = [];
    this.#bytes = 0;
  }
}

function cancelled(cause?: unknown): NativeDecisionServiceError {
  return new NativeDecisionServiceError("CANCELLED", "Decision operation cancelled.", { cause });
}
