export function forward<Options, Result>(
  builder: (options: Options) => Result,
  options: Options,
): Result {
  return builder(options)
}

export function callbackFactory(prefix: string): (input: string) => string {
  return function returnedCallback(input: string): string {
    return `${prefix}:${input}`
  }
}
