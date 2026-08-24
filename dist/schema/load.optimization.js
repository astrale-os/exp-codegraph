import { Ajv2020 } from 'ajv/dist/2020.js';
const OPTIONS = { allErrors: true, strict: false, validateFormats: false };
let metadataValidator;
/** Reuse immutable JSON Schema meta-compilation without retaining caller schemas. */
export function schemaMetadataIssue(schema) {
    const ajv = metadataValidator ??= new Ajv2020(OPTIONS);
    if (ajv.validateSchema(schema))
        return;
    return ajv.errorsText(ajv.errors, { separator: '; ' });
}
//# sourceMappingURL=load.optimization.js.map