export interface MutationOptions {
  readonly name: string
  readonly run?: () => unknown
  readonly marker?: null
}

export function defineMutation<const Options extends MutationOptions>(options: Options): Options {
  return options
}
