export interface Diagnostic {
  code: string
  message: string
  file: string
  line: number
  column: number
  pointer?: string
}

export function errorDiagnostic(code: string, error: unknown, file: string): Diagnostic {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    file,
    line: 1,
    column: 1,
  }
}
