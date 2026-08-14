export interface TtscNativeAnalysisOptions {
  readonly root: string
  readonly config: string
  readonly cacheDirectory?: string
  readonly binary?: string
  readonly environment?: Readonly<Record<string, string | undefined>>
}

export interface ResolvedTtscNativeAnalysis {
  readonly command: string
  readonly sha256: string
  readonly ttscVersion: '0.25.0'
  readonly origin: 'explicit' | 'ttsc-cache'
}

/** Resolve the qualified native analyzer through ttsc's source-plugin cache lifecycle. */
export declare function resolveTtscNativeAnalysis(
  options: TtscNativeAnalysisOptions,
): Promise<ResolvedTtscNativeAnalysis>
