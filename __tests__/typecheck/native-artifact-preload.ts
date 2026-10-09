import {
  preloadNativeArtifacts,
  resolvePackagedNativeAnalysis,
  resolvePackagedNativeOxlint,
  type PreloadedNativeArtifacts,
} from '@astrale-os/codegraph/analysis/native'

const signal = new AbortController().signal
const preload: Promise<PreloadedNativeArtifacts> = preloadNativeArtifacts({ generic: true, signal })
const admitted = await preload
admitted.analysis.command satisfies string
admitted.generic?.engineVersion satisfies '1.81.0' | undefined
await resolvePackagedNativeAnalysis({ signal })
await resolvePackagedNativeOxlint({ signal })
// @ts-expect-error Artifact identity is selected by the installed package, never an arbitrary URL.
await preloadNativeArtifacts({ url: 'https://another.host/artifact' })
// @ts-expect-error Generic preload is a capability selection, not an executable path.
await preloadNativeArtifacts({ generic: '/binary' })
