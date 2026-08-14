/** Stable identity of one statically declared test inside an explicit evidence file. */
export interface TestEvidenceReference {
  readonly file: string
  readonly id: string
}
