export declare const MINIMUM_MODULE_SPEC = "/**\n * Authoritative public contract for this module.\n * Add exports only when they are intentional downstream API.\n */\nexport {}\n";
/** Create the irreducible module specification without manufacturing optional artifacts. */
export declare function initializeModuleSpecification(directory: string): Promise<string>;
