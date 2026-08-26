import { describe, expect, it } from 'vitest'

import type { Diagnostic } from '../source/diagnostic.ts'
import type { CliOutput } from '../cli/report.ts'

import { groupDiagnostics } from '../cli/check-report.ts'
import { parseCommand } from '../cli/parse.ts'
import { reportProjectedCheckResult } from '../cli/run.ts'

describe('check diagnostic reporting', () => {
  // @evidence CLI-DIAGNOSTIC-CAUSE-GROUPING
  it('coalesces only exact source causes and retains every distinct projection', () => {
    const projections = ['/api', '/internal', '/ports/a', '/ports/b', '/ports/c', '/ports/d', '/ports/e']
    const diagnostics: Diagnostic[] = [
      ...projections.map((pointer) => diagnostic({ pointer })),
      diagnostic({ pointer: '/api' }),
      diagnostic({ pointer: '/api', message: 'A different compiler cause.' }),
      diagnostic({ pointer: '/api', line: 3 }),
      diagnostic({ pointer: '/api', column: 4 }),
      diagnostic({ pointer: '/api', file: 'other/.spec/api.d.ts' }),
      diagnostic({ pointer: '/api', code: 'API_TYPESCRIPT_TS9999' }),
    ]

    const groups = groupDiagnostics(diagnostics)

    expect(groups).toHaveLength(6)
    expect(groups[0]).toMatchObject({
      code: 'API_TYPESCRIPT_TS2536',
      message: 'Type cannot be used to index type.',
      file: 'module/.spec/api.d.ts',
      line: 2,
      column: 3,
      pointers: projections,
    })

    const transcript = capture()
    const result = reportProjectedCheckResult(
      transcript.output,
      checkCommand(),
      snapshot(),
      diagnostics,
      false,
    )

    expect(result.exitCode).toBe(1)
    expect(
      transcript.stderr.filter(
        (line) =>
          line ===
          'module/.spec/api.d.ts:2:3 [API_TYPESCRIPT_TS2536] /api Type cannot be used to index type.',
      ),
    ).toHaveLength(1)
    expect(transcript.stderr).toContain(
      '  repeated in 6 additional projections: /internal, /ports/a, /ports/b, /ports/c, /ports/d (+1 more)',
    )
    expect(transcript.stdout).toEqual([
      'Checked 1 specification: 6 diagnostic causes (12 occurrences).',
    ])
  })

  it('preserves the existing text transcript when a cause has one occurrence', () => {
    const transcript = capture()
    reportProjectedCheckResult(
      transcript.output,
      checkCommand(),
      snapshot(),
      [diagnostic({ pointer: '/api' })],
      false,
    )

    expect(transcript.stderr).toEqual([
      'module/.spec/api.d.ts:2:3 [API_TYPESCRIPT_TS2536] /api Type cannot be used to index type.',
    ])
    expect(transcript.stdout).toEqual(['Checked 1 specification: 1 diagnostic.'])
  })

  it('retains qualification-only failure in a diagnostic-free JSON result', () => {
    const transcript = capture()
    const result = reportProjectedCheckResult(
      transcript.output,
      jsonCheckCommand(),
      snapshot(),
      [],
      true,
    )

    expect(result.exitCode).toBe(1)
    expect(transcript.stderr).toEqual([])
    expect(JSON.parse(transcript.stdout.join('\n'))).toMatchObject({
      status: 'fail',
      qualificationFailed: true,
      diagnostics: [],
      summary: { diagnosticCauses: 0, diagnosticOccurrences: 0 },
    })
  })

  it('escapes additional projection controls and renders a root occurrence explicitly', () => {
    const unsafe = '/ports/evil\u001b[2J\nforged\u202e'
    const diagnostics = [
      diagnostic({ pointer: '/api' }),
      diagnostic({ pointer: unsafe }),
      diagnostic(),
    ]
    expect(groupDiagnostics(diagnostics)[0]?.pointers).toEqual(['/api', unsafe, null])

    const transcript = capture()
    reportProjectedCheckResult(
      transcript.output,
      checkCommand(),
      snapshot(),
      diagnostics,
      false,
    )

    expect(transcript.stderr).toContain(
      '  repeated in 2 additional projections: /ports/evil\\x1b[2J\\x0aforged\\u{202e}, <root>',
    )
    expect(transcript.stderr.join('\n')).not.toContain('\u001b[2J')
  })
})

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: 'API_TYPESCRIPT_TS2536',
    message: 'Type cannot be used to index type.',
    file: 'module/.spec/api.d.ts',
    line: 2,
    column: 3,
    ...overrides,
  }
}

function checkCommand(): Extract<ReturnType<typeof parseCommand>, { readonly name: 'check' }> {
  const command = parseCommand(['check', '.', '--quiet'], {})
  if (command.name !== 'check') throw new Error('Expected a check command.')
  return command
}

function jsonCheckCommand(): Extract<ReturnType<typeof parseCommand>, { readonly name: 'check' }> {
  const command = parseCommand(['check', '.', '--format', 'json'], {})
  if (command.name !== 'check') throw new Error('Expected a check command.')
  return command
}

function snapshot() {
  return {
    id: 'application:test' as const,
    repository: 'repository:test' as never,
    inventory: 'manifest:test' as never,
    selection: { kind: 'full', authority: 'full-ci' } as const,
    specifications: [{ source: 'module' } as never],
  }
}

function capture(): {
  readonly output: CliOutput
  readonly stdout: string[]
  readonly stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    output: {
      out: (message) => stdout.push(message),
      error: (message) => stderr.push(message),
    },
    stdout,
    stderr,
  }
}
