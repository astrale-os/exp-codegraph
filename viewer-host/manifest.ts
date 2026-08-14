import type { SourceEditHttpAdapterManifest } from '../application/interaction/editing.ts'
import type { SpecRevealHttpAdapterManifest } from '../application/interaction/reveal.ts'
import type { VerificationHttpAdapterManifest } from '../application/interaction/qualification.ts'

export interface ViewerAdapterManifest {
  editing?: SourceEditHttpAdapterManifest
  reveal?: SpecRevealHttpAdapterManifest
  verification?: VerificationHttpAdapterManifest
}
