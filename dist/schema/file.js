import { dirname, relative, resolve, sep } from 'node:path';
import { loadYaml } from '../source/yaml.js';
import { loadSchema } from './load.js';
import { validateData } from './validate.js';
/** Validate one bounded JSON or YAML document against one local Draft 2020-12 schema. */
export async function validateSchemaFile(options) {
    const schema = resolve(options.schema);
    const document = resolve(options.document);
    const root = resolve(options.root ?? dirname(schema));
    const schemaSource = portable(relative(root, schema));
    const documentSource = portable(relative(root, document));
    const loadedSchema = await loadSchema(schema, schemaSource, root);
    if (loadedSchema.diagnostics.length || !loadedSchema.validate)
        return loadedSchema.diagnostics;
    const loadedDocument = await loadYaml(document, documentSource);
    if (loadedDocument.diagnostics.length || !loadedDocument.document || !loadedDocument.lines) {
        return loadedDocument.diagnostics;
    }
    return validateData(loadedDocument.data, loadedSchema.validate, documentSource, loadedDocument.document, loadedDocument.lines);
}
function portable(path) {
    return sep === '/' ? path : path.split(sep).join('/');
}
//# sourceMappingURL=file.js.map