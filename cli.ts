#!/usr/bin/env node
import { changedSpecificationScope } from './cli/changes.ts'
import { createCliApplicationService } from './cli/application.ts'
import { executeEvidenceTests, planEvidenceTests } from './cli/evidence.ts'
import { parseCommand, USAGE } from './cli/parse.ts'
import { terminalText } from './cli/report.ts'
import { runCommand } from './cli/run.ts'
import { readCodegraphVersion } from './cli/version.ts'
import { startDev } from './server/start.ts'
import { initializeModuleSpecification } from './specification/module/init.ts'

try {
  const result = await runCommand(
    parseCommand(process.argv.slice(2)),
    {
      version: readCodegraphVersion,
      initializeModule: initializeModuleSpecification,
      createApplication: createCliApplicationService,
      startDev,
      changedSpecificationScope,
      planEvidenceTests,
      executeEvidenceTests,
    },
    {
      out: (message) => process.stdout.write(`${message}\n`),
      error: (message) => process.stderr.write(`${message}\n`),
    },
  )
  process.exitCode = result.exitCode
  if (result.server) {
    const close = async (): Promise<void> => {
      await result.server!.close()
      process.exit(0)
    }
    process.once('SIGINT', () => void close())
    process.once('SIGTERM', () => void close())
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message === USAGE ? message : terminalText(message)}\n`)
  process.exitCode = 2
}
