export type ViewerCodeAnalysisStatus = 'complete' | 'partial' | 'unavailable'
export type ViewerCodeDependencyKind = 'runtime' | 'type' | 'side-effect' | 'dynamic'

export interface ViewerCodeLocation {
  readonly file?: string
  readonly line?: number
  readonly column?: number
  readonly pointer?: string
}

export interface ViewerCodeIssue {
  readonly code: string
  readonly message: string
  readonly location?: ViewerCodeLocation
  readonly related?: ViewerCodeLocation[]
  readonly expected?: unknown
  readonly actual?: unknown
}

export interface ViewerCodeLineMetrics {
  readonly total: number
  readonly code: number
  readonly comment: number
  readonly blank: number
  readonly unclassified?: number
}

export interface ViewerCodeFile {
  readonly path: string
  readonly module: string
  readonly entrypoint: boolean
  readonly reachable: boolean
  readonly lines: ViewerCodeLineMetrics
  readonly inbound: number
  readonly outbound: number
}

export interface ViewerCodeModule {
  readonly id: string
  readonly path: string
  readonly files: number
  readonly reachableFiles: number
  readonly lines: ViewerCodeLineMetrics
  readonly inbound: number
  readonly outbound: number
}

export interface ViewerCodeDependency {
  readonly id: string
  readonly sourceFile: string
  readonly targetFile?: string
  readonly sourceModule: string
  readonly targetModule: string
  readonly kind: ViewerCodeDependencyKind
  readonly typeOnly: boolean
  readonly specifier: string
  readonly external: boolean
  readonly location: ViewerCodeLocation
}

export interface ViewerCodeCycle {
  readonly id: string
  readonly kind: 'runtime' | 'type'
  readonly files: readonly string[]
  readonly modules: readonly string[]
  readonly dependencies: readonly string[]
}

export interface ViewerCodeAnalysis {
  readonly status: ViewerCodeAnalysisStatus
  readonly evidenceRevision?: string
  readonly scope: {
    readonly project: string
    readonly configurationFiles?: readonly string[]
    readonly root: string
    readonly entrypoint: string
    readonly facades?: readonly string[]
    readonly aliases: readonly string[]
    readonly internals?: readonly string[]
  }
  readonly summary: {
    readonly files: number
    readonly reachableFiles: number
    readonly detachedFiles: number
    readonly modules: number
    readonly lines: ViewerCodeLineMetrics
    readonly averageCodeLines: number
    readonly medianCodeLines: number
    readonly p95CodeLines: number
    readonly largestFile?: { readonly path: string; readonly codeLines: number }
    readonly internalDependencies: number
    readonly externalDependencies: number
    readonly runtimeCycles: number
    readonly typeCycles: number
  }
  readonly files: readonly ViewerCodeFile[]
  readonly modules: readonly ViewerCodeModule[]
  readonly dependencies: readonly ViewerCodeDependency[]
  readonly cycles: readonly ViewerCodeCycle[]
  readonly issues: readonly ViewerCodeIssue[]
}
