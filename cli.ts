#!/usr/bin/env node
import { clearLine, cursorTo } from 'node:readline'

import { createCliApplicationService } from './cli/application.ts'
import { changedSpecificationScope } from './cli/changes.ts'
import { runCliCommand } from './cli/checkpoint.ts'
import { executeEvidenceTests, planEvidenceTests } from './cli/evidence.ts'
import { parseCommand, USAGE } from './cli/parse.ts'
import { terminalText } from './cli/report.ts'
import { readCodegraphVersion } from './cli/version.ts'
import { initializeModuleSpecification } from './specification/module/init.ts'

const startDev: import('./cli/run.ts').CliServices['startDev'] = async (options) => {
  const server = await import('./server/start.ts')
  return server.startDev(options)
}

try {
  const interactive = process.stdout.isTTY === true && process.env.TERM !== 'dumb'
  const clearProgress = (): void => {
    if (!interactive) return
    clearLine(process.stdout, 0)
    cursorTo(process.stdout, 0)
  }
  const result = await runCliCommand(
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
      out: (message) => {
        clearProgress()
        process.stdout.write(`${message}\n`)
      },
      error: (message) => {
        clearProgress()
        process.stderr.write(`${message}\n`)
      },
      ...(interactive
        ? {
            update: (message: string) => {
              clearProgress()
              process.stdout.write(message)
            },
            clear: clearProgress,
          }
        : {}),
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
