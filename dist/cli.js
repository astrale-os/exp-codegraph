#!/usr/bin/env node
import { changedSpecificationScope } from './cli/changes.js';
import { createCliApplicationService } from './cli/application.js';
import { executeEvidenceTests, planEvidenceTests } from './cli/evidence.js';
import { parseCommand, USAGE } from './cli/parse.js';
import { terminalText } from './cli/report.js';
import { runCommand } from './cli/run.js';
import { readCodegraphVersion } from './cli/version.js';
import { initializeModuleSpecification } from './specification/module/init.js';
const startDev = async (options) => {
    const server = await import('./server/start.js');
    return server.startDev(options);
};
try {
    const result = await runCommand(parseCommand(process.argv.slice(2)), {
        version: readCodegraphVersion,
        initializeModule: initializeModuleSpecification,
        createApplication: createCliApplicationService,
        startDev,
        changedSpecificationScope,
        planEvidenceTests,
        executeEvidenceTests,
    }, {
        out: (message) => process.stdout.write(`${message}\n`),
        error: (message) => process.stderr.write(`${message}\n`),
    });
    process.exitCode = result.exitCode;
    if (result.server) {
        const close = async () => {
            await result.server.close();
            process.exit(0);
        };
        process.once('SIGINT', () => void close());
        process.once('SIGTERM', () => void close());
    }
}
catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message === USAGE ? message : terminalText(message)}\n`);
    process.exitCode = 2;
}
//# sourceMappingURL=cli.js.map