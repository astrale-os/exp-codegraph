import type { TypeSpecApplicationService } from '../application/index.ts';
import type { CliPortableCheckpoint } from './run.ts';
/** CLI-owned persistence and cache defaults around the headless application service. */
export declare function createCliApplicationService(root: string, cache: boolean, portableCheckpoint?: CliPortableCheckpoint): Promise<TypeSpecApplicationService>;
