export interface PackageDependencyDefinition<Name extends string = string> {
  readonly package: Name
  readonly purpose: string
}

export interface PackagePatternDefinition<Pattern extends string = string> {
  readonly pattern: Pattern
  readonly reason: string
}

/** Preserve one exact third-party dependency justification. */
export function definePackage<const Definition extends PackageDependencyDefinition>(
  definition: Definition,
): Definition {
  return definition
}

/** Preserve one explicit package-family exception and its reason. */
export function definePackagePattern<const Definition extends PackagePatternDefinition>(
  definition: Definition,
): Definition {
  return definition
}
