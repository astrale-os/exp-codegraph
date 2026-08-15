/** Generation-pinned application source editing transport. */
export const SOURCE_EDIT_PROTOCOL = 'astrale.spec.editing.v2';
export const SOURCE_EDIT_ENDPOINT = '/__astrale/spec-source';
export const SOURCE_EDIT_HEADER = 'x-astrale-spec-edit';
export class SourceEditAdapterError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'SourceEditAdapterError';
        this.code = code;
    }
}
//# sourceMappingURL=editing.js.map