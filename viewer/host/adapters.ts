import type { SourceEditAdapter } from '../../application/interaction/editing.ts'
import type { SpecRevealAdapter } from '../../application/interaction/reveal.ts'
import type { VerificationAdapter } from '../../application/interaction/qualification.ts'
import type { ViewerAdapterManifest } from '../../viewer-host/manifest.ts'

import { SOURCE_EDIT_PROTOCOL } from '../../application/interaction/editing.ts'
import { SPEC_REVEAL_PROTOCOL } from '../../application/interaction/reveal.ts'
import { VERIFICATION_PROTOCOL } from '../../application/interaction/qualification.ts'
import { httpSourceEditAdapter } from './editing-http.ts'
import { httpSpecRevealAdapter } from './reveal-http.ts'
import { httpVerificationAdapter } from './verification-http.ts'

export interface ViewerAdapters {
  editing?: SourceEditAdapter
  reveal?: SpecRevealAdapter
  verification?: VerificationAdapter
}

export function adaptersFromManifest(manifest: ViewerAdapterManifest): ViewerAdapters {
  const editing = manifest.editing
  const reveal = manifest.reveal
  const verification = manifest.verification
  return {
    editing:
      editing?.transport === 'http' && editing.protocol === SOURCE_EDIT_PROTOCOL
        ? httpSourceEditAdapter(editing.endpoint)
        : undefined,
    reveal:
      reveal?.transport === 'http' && reveal.protocol === SPEC_REVEAL_PROTOCOL
        ? httpSpecRevealAdapter(reveal.endpoint)
        : undefined,
    verification:
      verification?.transport === 'http' && verification.protocol === VERIFICATION_PROTOCOL
        ? httpVerificationAdapter(verification.endpoint)
        : undefined,
  }
}
