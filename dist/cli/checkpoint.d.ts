import type { CliCommand } from './parse.ts';
import type { CliOutput } from './report.ts';
import type { CliResult, CliServices } from './run.ts';
/**
 * Admit an exact previous check result before constructing the application. Any cache uncertainty
 * is advisory: the canonical command runs and is the only producer of publishable output.
 */
export declare function runCliCommand(command: CliCommand, services: CliServices, output: CliOutput): Promise<CliResult>;
