/** Stable identity of one statically declared test inside an explicit evidence file. */
export interface TestEvidenceReference {
  readonly file: string
  readonly id: string
}

/** Implementation location a law constrains: one file, optionally one declaration inside it. */
export interface CodeAnchorReference {
  readonly file: string
  /** A top-level declaration name or `Class.member`; JavaScript and TypeScript files only. */
  readonly symbol?: string
}
