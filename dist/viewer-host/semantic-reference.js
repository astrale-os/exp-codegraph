/** One canonical browser route for catalog-derived declaration links. */
export function semanticReferenceHref(reference) {
    const parameters = new URLSearchParams();
    parameters.set('spec', reference.target.spec);
    parameters.set('tab', 'api');
    parameters.set('apiFile', reference.target.source);
    parameters.set('apiDecl', reference.target.declaration);
    return `?${parameters}`;
}
//# sourceMappingURL=semantic-reference.js.map