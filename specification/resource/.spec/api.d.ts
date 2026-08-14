/** Stable authored resource identity retained by an immutable SpecificationSnapshot. */
export interface SpecificationTextResource {
  readonly ref: string
  readonly source: string
  readonly text: string
  readonly revision: string
}
