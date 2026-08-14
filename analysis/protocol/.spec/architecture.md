# Native analysis protocol

The protocol adapter owns a bounded JSONL trust boundary between a resident native analyzer and
portable JavaScript consumers. The native process may keep compiler objects private, but every
consumer-visible result is a validated `NativeAnalysisResponse`.

Small transactions use one terminal `transaction` frame. A transaction that does not fit the
configured frame ceiling is encoded as canonical JSON and transported through an integrity-checked
sequence:

```mermaid
sequenceDiagram
  participant Consumer
  participant Native
  Consumer->>Native: refresh request
  Native-->>Consumer: transaction-start(bytes, chunks, sha256)
  loop exact ordered chunk count
    Native-->>Consumer: transaction-chunk(sequence, base64-json)
  end
  Native-->>Consumer: transaction-end(bytes, chunks, sha256)
  Note over Consumer: validate, assemble, parse, admit FactTransaction
```

Chunking is a wire concern only. It does not create partially visible generations, expose a native
wire type to analysis consumers, or change the atomic fact-transaction contract. A missing,
duplicate, reordered, oversized, malformed, or digest-invalid frame fails the session without
publishing a response.
