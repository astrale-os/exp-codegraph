/** Deterministic identity namespace for one module inside a specification anchor. */
export function specificationModuleId(source: string, declarationPointer: string): string {
  return declarationPointer ? `${source}#${declarationPointer}` : source
}
