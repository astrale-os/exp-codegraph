export interface Diagnostic {
    code: string;
    message: string;
    file: string;
    line: number;
    column: number;
    pointer?: string;
}
export declare function errorDiagnostic(code: string, error: unknown, file: string): Diagnostic;
