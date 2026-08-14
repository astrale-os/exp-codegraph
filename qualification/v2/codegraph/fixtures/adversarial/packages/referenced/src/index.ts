export function referencedBuilder(name: string): Readonly<{ name: string }> {
  return Object.freeze({ name })
}
