export interface MutationOptions {
  readonly name: string
  readonly callback: (input: string) => string
}

export function defineMutation(options: MutationOptions): MutationOptions {
  return options
}
