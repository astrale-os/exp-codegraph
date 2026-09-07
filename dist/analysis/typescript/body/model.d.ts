import type { SourceSpan } from '../../facts/index.ts';
import type { OccurrenceId, SymbolId } from '../../identity/index.ts';
export type BodyOccurrenceKind = 'statement' | 'expression' | 'declaration' | 'assignment' | 'definition' | 'use' | 'call' | 'return' | 'throw' | 'branch' | 'external-escape';
export interface BodyOccurrence {
    readonly id: OccurrenceId;
    readonly kind: BodyOccurrenceKind;
    readonly span: SourceSpan;
    readonly owner: SymbolId;
    readonly syntax: string;
    readonly symbol?: SymbolId;
}
export interface BodyRelation {
    readonly parent: OccurrenceId;
    readonly child: OccurrenceId;
    readonly role: string;
}
export type ControlFlowEdgeKind = 'fallthrough' | 'true' | 'false' | 'loop' | 'exception' | 'return';
export interface ControlFlowBlock {
    readonly id: string;
    readonly occurrences: readonly OccurrenceId[];
}
export interface ControlFlowEdge {
    readonly from: string;
    readonly to: string;
    readonly kind: ControlFlowEdgeKind;
    readonly evidence?: OccurrenceId;
}
export interface DefinitionUse {
    readonly definition: OccurrenceId;
    readonly use: OccurrenceId;
    readonly symbol?: SymbolId;
    readonly reaching: 'definite' | 'possible';
}
export interface ParameterBinding {
    readonly argument: OccurrenceId;
    readonly parameter?: SymbolId;
    readonly index: number;
    readonly rest: boolean;
}
export interface ResolvedCall {
    readonly occurrence: OccurrenceId;
    readonly target?: SymbolId;
    /** Canonical declaration origin; absent when package/declaration identity cannot be proved. */
    readonly targetOrigin?: {
        readonly package: string;
        readonly file: string;
        readonly path: readonly string[];
    };
    /** Portable identity of the selected signature declaration, not rendered or instantiated type text. */
    readonly signature?: string;
    readonly receiver?: OccurrenceId;
    readonly typeArguments: readonly string[];
    readonly arguments: readonly OccurrenceId[];
    readonly bindings: readonly ParameterBinding[];
    readonly callbacks: readonly SymbolId[];
    readonly dynamic: boolean;
}
export interface FunctionSummary {
    readonly function: SymbolId;
    readonly returns: readonly OccurrenceId[];
    readonly throws: readonly OccurrenceId[];
    readonly captures: readonly SymbolId[];
    readonly calls: readonly OccurrenceId[];
    readonly escapes: readonly OccurrenceId[];
    readonly recursion: boolean;
}
export interface FunctionBodyIR {
    /** Lexical execution owner. Older body facts omit this and describe a function. */
    readonly scope?: 'function' | 'module';
    /** Function execution form; absence in older facts does not prove synchronous execution. */
    readonly execution?: 'sync' | 'async' | 'generator' | 'async-generator';
    /** Stable owner identity, also used for a module's evaluation scope. */
    readonly function: SymbolId;
    readonly parameters: readonly SymbolId[];
    readonly occurrences: readonly BodyOccurrence[];
    readonly relations: readonly BodyRelation[];
    readonly blocks: readonly ControlFlowBlock[];
    readonly edges: readonly ControlFlowEdge[];
    readonly definitions: readonly DefinitionUse[];
    readonly calls: readonly ResolvedCall[];
    readonly summary: FunctionSummary;
}
export declare function validateFunctionBodyIR(body: FunctionBodyIR): readonly string[];
