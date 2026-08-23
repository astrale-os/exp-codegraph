/** Execute independent physical checkpoint work with one explicit concurrency ceiling. */
export async function mapCheckpointWork<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  operation: (value: Input) => Promise<Output>,
): Promise<readonly Output[]> {
  const output = new Array<Output>(values.length)
  let next = 0
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const index = next++
      if (index >= values.length) return
      try {
        output[index] = await operation(values[index]!)
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  if (failure !== undefined) throw failure
  return output
}
