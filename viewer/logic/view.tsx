import { useEffect, useRef, useState } from 'preact/hooks'

import type { ViewerQualification, ViewerQualificationRule } from '../../viewer-host/qualification.ts'
import type { ViewerSpecification } from '../../viewer-host/specification.ts'
import type { VerificationAdapter } from '../../application/interaction/qualification.ts'

import { viewerSpecificationDiagnostics } from '../../viewer-host/specification.ts'
import { VerificationAdapterError } from '../../application/interaction/qualification.ts'
import { RuleResult, VerificationView } from './results.tsx'

interface LogicViewProps {
  spec: ViewerSpecification
  adapter?: VerificationAdapter
  onVerification?(verification: ViewerQualification): void
}

interface AdapterFailure {
  code: string
  message: string
}

export function LogicView({ spec, adapter, onVerification }: LogicViewProps) {
  const [localVerification, setLocalVerification] = useState<ViewerQualification>()
  const [running, setRunning] = useState(false)
  const [failure, setFailure] = useState<AdapterFailure>()
  const controller = useRef<AbortController | null>(null)
  const verification = spec.verification ?? localVerification
  const validationDiagnostics = viewerSpecificationDiagnostics(spec)
  const valid = validationDiagnostics.length === 0
  const verifiable = spec.contracts.length > 0
  const validation: ViewerQualificationRule = {
    id: 'specification',
    status: valid ? 'pass' : 'fail',
    diagnostics: validationDiagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      location: {
        file: diagnostic.file,
        line: diagnostic.line,
        column: diagnostic.column,
        pointer: diagnostic.pointer,
      },
    })),
  }

  useEffect(() => {
    controller.current?.abort()
    setLocalVerification(undefined)
    setFailure(undefined)
    setRunning(false)
  }, [spec.source, spec.verificationRevision])

  useEffect(() => {
    if (spec.verification) setLocalVerification(undefined)
  }, [spec.verification])

  useEffect(() => () => controller.current?.abort(), [])

  const run = async () => {
    if (!adapter || !verifiable || running) return
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setRunning(true)
    setFailure(undefined)
    try {
      const result = await adapter.run(
        { source: spec.source, revision: spec.verificationRevision },
        { signal: next.signal },
      )
      if (next.signal.aborted) return
      setLocalVerification(result)
      onVerification?.(result)
    } catch (error) {
      if (next.signal.aborted) return
      setFailure({
        code: error instanceof VerificationAdapterError ? error.code : 'ADAPTER_ERROR',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (!next.signal.aborted) setRunning(false)
    }
  }

  return (
    <div class="logic-view">
      <section class="logic-section" aria-labelledby="logic-validation-title">
        <header class="logic-section-header">
          <div>
            <p class="eyebrow">Document</p>
            <h2 id="logic-validation-title">Validation</h2>
          </div>
        </header>
        <ol class="verification-rules">
          <RuleResult rule={validation} statusLabel={valid ? 'valid' : 'invalid'} />
        </ol>
      </section>

      {verifiable && (
        <section class="logic-section" aria-labelledby="logic-verification-title">
          <header class="logic-section-header">
            <div>
              <p class="eyebrow">Code</p>
              <h2 id="logic-verification-title">Verification</h2>
            </div>
            {adapter && (
              <button
                class="logic-action"
                type="button"
                disabled={running}
                onClick={() => void run()}
              >
                <RunIcon running={running} />
                {running ? 'Running' : verification ? 'Run again' : 'Run verification'}
              </button>
            )}
          </header>
          {failure && (
            <ol class="verification-rules">
              <RuleResult
                rule={{
                  id: 'verification.adapter',
                  status: 'error',
                  diagnostics: [
                    {
                      code: failure.code,
                      message: failure.message,
                    },
                  ],
                }}
              />
            </ol>
          )}
          {verification ? (
            <VerificationView verification={verification} />
          ) : (
            !failure && (
              <ol class="verification-rules">
                <RuleResult
                  rule={{
                    id: 'verification',
                    status: 'idle',
                    diagnostics: adapter
                      ? []
                      : [
                          {
                            severity: 'info',
                            message: 'No verification adapter is available.',
                          },
                        ],
                  }}
                  statusLabel={running ? 'running' : undefined}
                />
              </ol>
            )
          )}
        </section>
      )}
    </div>
  )
}

function RunIcon({ running }: { running: boolean }) {
  return (
    <svg class={running ? 'spin' : undefined} viewBox="0 0 20 20" aria-hidden="true">
      {running ? <path d="M16 10a6 6 0 1 1-2-4.5" /> : <path d="m7.2 5.5 7 4.5-7 4.5z" />}
    </svg>
  )
}
