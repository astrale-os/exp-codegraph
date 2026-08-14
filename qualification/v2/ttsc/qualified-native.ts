import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface TtscQualificationEvidence {
  readonly format?: unknown
  readonly status?: unknown
  readonly checks?: {
    readonly productionNativePackaging?: { readonly binarySha256?: unknown }
  }
}

/** Read the exact retained production-native digest from governed ttsc evidence. */
export async function qualifiedProductionNativeDigest(path: string): Promise<string> {
  const evidence = JSON.parse(
    await readFile(resolve(path), 'utf8'),
  ) as TtscQualificationEvidence
  const digest = evidence.checks?.productionNativePackaging?.binarySha256
  if (
    evidence.format !== 'astrale.typespec.v2.ttsc-qualification' ||
    evidence.status !== 'qualified' ||
    typeof digest !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(digest)
  ) {
    throw new Error('Governed ttsc evidence does not retain one exact qualified native binary.')
  }
  return digest
}
