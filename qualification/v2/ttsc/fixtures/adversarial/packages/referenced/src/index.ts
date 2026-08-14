export function referencedBuilder(value: string): string {
  return value
}

export interface ReferencedLeaf {
  readonly value: string
}

export interface ReferencedType {
  readonly leaf: ReferencedLeaf
}
