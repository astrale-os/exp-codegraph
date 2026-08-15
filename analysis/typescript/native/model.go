package main

const (
	protocolVersion = 1
	producerVersion = "0.1.0"
	ttscVersion     = "0.25.0"
	passVersion     = "1.0.0"
)

type request struct {
	ID         int      `json:"id"`
	Kind       string   `json:"kind"`
	Base       string   `json:"base,omitempty"`
	Changed    []string `json:"changed,omitempty"`
	Invalidate bool     `json:"invalidate,omitempty"`
}

type response struct {
	ID              int              `json:"id"`
	ProtocolVersion int              `json:"protocolVersion"`
	Kind            string           `json:"kind"`
	Transaction     *factTransaction `json:"transaction,omitempty"`
	Generation      string           `json:"generation,omitempty"`
	Code            string           `json:"code,omitempty"`
	Message         string           `json:"message,omitempty"`
	Retryable       bool             `json:"retryable,omitempty"`
}

type producerIdentity struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Version         string `json:"version"`
	ProtocolVersion int    `json:"protocolVersion"`
}

type analysisGeneration struct {
	ID             string           `json:"id"`
	Sequence       int              `json:"sequence"`
	Universe       string           `json:"universe"`
	Producer       producerIdentity `json:"producer"`
	SourceManifest string           `json:"sourceManifest"`
	Capabilities   []string         `json:"capabilities"`
}

type factTransaction struct {
	ProtocolVersion int                  `json:"protocolVersion"`
	Base            string               `json:"base,omitempty"`
	Next            analysisGeneration   `json:"next"`
	Manifest        []factShardReference `json:"manifest"`
	Upserts         []factShard          `json:"upserts"`
	Deletes         []string             `json:"deletes"`
}

type completeness struct {
	Kind    string `json:"kind"`
	Reasons []any  `json:"reasons,omitempty"`
}

type sourceSpan struct {
	Source   string `json:"source"`
	Revision string `json:"revision"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
}

type provenance struct {
	Pass        string       `json:"pass"`
	PassVersion string       `json:"passVersion"`
	Evidence    []sourceSpan `json:"evidence"`
	Inputs      []string     `json:"inputs"`
}

type fact struct {
	ID            string       `json:"id"`
	Generation    string       `json:"generation"`
	Namespace     string       `json:"namespace"`
	SchemaVersion int          `json:"schemaVersion"`
	Kind          string       `json:"kind"`
	Subject       string       `json:"subject"`
	Completeness  completeness `json:"completeness"`
	Provenance    provenance   `json:"provenance"`
	Payload       any          `json:"payload"`
}

type factShard struct {
	Key           string       `json:"key"`
	Digest        string       `json:"digest"`
	Namespace     string       `json:"namespace"`
	SchemaVersion int          `json:"schemaVersion"`
	Completion    completeness `json:"completion"`
	Facts         []fact       `json:"facts"`
}

type factShardReference struct {
	Key           string `json:"key"`
	Digest        string `json:"digest"`
	Namespace     string `json:"namespace"`
	SchemaVersion int    `json:"schemaVersion"`
	Facts         int    `json:"facts"`
}

type sourceRecord struct {
	Path       string
	Source     string
	Revision   string
	TextDigest string
}

type moduleBoundary struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Project    string   `json:"project"`
	Root       string   `json:"root"`
	Entrypoint string   `json:"entrypoint"`
	Facades    []string `json:"facades"`
	Aliases    []string `json:"aliases"`
	Internals  []string `json:"internals"`
}

type sourceLocation struct {
	File     string `json:"file,omitempty"`
	External string `json:"external,omitempty"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

type observedExportPayload struct {
	Path         []string       `json:"path"`
	Name         string         `json:"name"`
	Declaration  string         `json:"declaration"`
	Kind         string         `json:"kind"`
	TypeOnly     bool           `json:"typeOnly"`
	SourceModule string         `json:"sourceModule,omitempty"`
	Location     sourceLocation `json:"location"`
}

type observedDeclarationPayload struct {
	Identity                string         `json:"identity"`
	Name                    string         `json:"name"`
	Kind                    string         `json:"kind"`
	Location                sourceLocation `json:"location"`
	PackageCoordinate       string         `json:"packageCoordinate,omitempty"`
	ExportPaths             [][]string     `json:"exportPaths"`
	TypeParameters          any            `json:"typeParameters,omitempty"`
	Fields                  any            `json:"fields,omitempty"`
	ValueType               any            `json:"valueType,omitempty"`
	AuthoredValueType       any            `json:"authoredValueType,omitempty"`
	CallSignatureCount      *int           `json:"callSignatureCount,omitempty"`
	ConstructSignatureCount *int           `json:"constructSignatureCount,omitempty"`
	IndexSignatureCount     *int           `json:"indexSignatureCount,omitempty"`
	Properties              any            `json:"properties,omitempty"`
	Callables               any            `json:"callables,omitempty"`
	Statics                 any            `json:"statics,omitempty"`
	Callable                any            `json:"callable,omitempty"`
	Overloads               any            `json:"overloads,omitempty"`
	Facets                  any            `json:"facets,omitempty"`
	Extends                 any            `json:"extends,omitempty"`
	Implements              any            `json:"implements,omitempty"`
	ReferencedDeclarations  []string       `json:"referencedDeclarations"`
	Issues                  []any          `json:"issues"`
}

type moduleTargetPayload struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Project    string   `json:"project"`
	Root       string   `json:"root"`
	Entrypoint string   `json:"entrypoint"`
	Facades    []string `json:"facades"`
	Aliases    []string `json:"aliases"`
	Internals  []string `json:"internals"`
}

type moduleFactPayload struct {
	Target              moduleTargetPayload          `json:"target"`
	Exports             []observedExportPayload      `json:"exports"`
	Declarations        []observedDeclarationPayload `json:"declarations"`
	Dependencies        []dependencyPayload          `json:"dependencies"`
	InboundDependencies []dependencyPayload          `json:"inboundDependencies"`
	DeclaredPackages    []string                     `json:"declaredPackages"`
	DevelopmentPackages []string                     `json:"developmentPackages"`
	WorkspacePackages   []string                     `json:"workspacePackages"`
	ErrorCodes          []errorCodePayload           `json:"errorCodes"`
	Files               []string                     `json:"files"`
	Issues              []any                        `json:"issues"`
}

type dependencyPayload struct {
	ID           string                        `json:"id"`
	SourceModule string                        `json:"sourceModule"`
	TargetModule string                        `json:"targetModule"`
	Kind         string                        `json:"kind"`
	SourceFile   string                        `json:"sourceFile"`
	TargetFile   string                        `json:"targetFile"`
	Occurrences  []dependencyOccurrencePayload `json:"occurrences"`
}

type dependencyOccurrencePayload struct {
	ID          string         `json:"id"`
	TypeOnly    bool           `json:"typeOnly"`
	Specifier   string         `json:"specifier"`
	Deep        bool           `json:"deep"`
	Location    sourceLocation `json:"location"`
	Declaration string         `json:"declaration,omitempty"`
	PublicPath  []string       `json:"publicPath,omitempty"`
}

type errorCodePayload struct {
	Code     string         `json:"code"`
	Location sourceLocation `json:"location"`
}

type sourceFactPayload struct {
	Source       string `json:"source"`
	Revision     string `json:"revision"`
	TextDigest   string `json:"textDigest"`
	LogicalPath  string `json:"logicalPath"`
	Declaration  bool   `json:"declaration"`
	ProjectOwned bool   `json:"projectOwned"`
}

type projectFactPayload struct {
	Universe           string   `json:"universe"`
	ConfigurationFiles []string `json:"configurationFiles"`
	ProjectReferences  []string `json:"projectReferences"`
}

type diagnosticFactPayload struct {
	Code     int32       `json:"code"`
	Severity string      `json:"severity"`
	Message  string      `json:"message"`
	File     string      `json:"file,omitempty"`
	Span     *sourceSpan `json:"span,omitempty"`
}

type symbolFactPayload struct {
	Symbol           string       `json:"symbol"`
	Name             string       `json:"name"`
	Declarations     []sourceSpan `json:"declarations"`
	Canonical        string       `json:"canonical,omitempty"`
	GenerationScoped bool         `json:"generationScoped"`
}

type occurrenceFactPayload struct {
	Occurrence string     `json:"occurrence"`
	Kind       string     `json:"kind"`
	Span       sourceSpan `json:"span"`
	Target     string     `json:"target,omitempty"`
}

type bodyOccurrence struct {
	ID     string     `json:"id"`
	Kind   string     `json:"kind"`
	Span   sourceSpan `json:"span"`
	Owner  string     `json:"owner"`
	Syntax string     `json:"syntax"`
	Symbol string     `json:"symbol,omitempty"`
}

type bodyRelation struct {
	Parent string `json:"parent"`
	Child  string `json:"child"`
	Role   string `json:"role"`
}

type controlFlowBlock struct {
	ID          string   `json:"id"`
	Occurrences []string `json:"occurrences"`
}

type controlFlowEdge struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Kind     string `json:"kind"`
	Evidence string `json:"evidence,omitempty"`
}

type definitionUse struct {
	Definition string `json:"definition"`
	Use        string `json:"use"`
	Symbol     string `json:"symbol,omitempty"`
	Reaching   string `json:"reaching"`
}

type parameterBinding struct {
	Argument  string `json:"argument"`
	Parameter string `json:"parameter,omitempty"`
	Index     int    `json:"index"`
	Rest      bool   `json:"rest"`
}

type resolvedCall struct {
	Occurrence    string             `json:"occurrence"`
	Target        string             `json:"target,omitempty"`
	Signature     string             `json:"signature,omitempty"`
	Receiver      string             `json:"receiver,omitempty"`
	TypeArguments []string           `json:"typeArguments"`
	Arguments     []string           `json:"arguments"`
	Bindings      []parameterBinding `json:"bindings"`
	Callbacks     []string           `json:"callbacks"`
	Dynamic       bool               `json:"dynamic"`
}

type functionSummary struct {
	Function  string   `json:"function"`
	Returns   []string `json:"returns"`
	Throws    []string `json:"throws"`
	Captures  []string `json:"captures"`
	Calls     []string `json:"calls"`
	Escapes   []string `json:"escapes"`
	Recursion bool     `json:"recursion"`
}

type functionBodyIR struct {
	Function    string             `json:"function"`
	Parameters  []string           `json:"parameters"`
	Occurrences []bodyOccurrence   `json:"occurrences"`
	Relations   []bodyRelation     `json:"relations"`
	Blocks      []controlFlowBlock `json:"blocks"`
	Edges       []controlFlowEdge  `json:"edges"`
	Definitions []definitionUse    `json:"definitions"`
	Calls       []resolvedCall     `json:"calls"`
	Summary     functionSummary    `json:"summary"`
}

type bodyFactPayload struct {
	Body         functionBodyIR `json:"body"`
	Values       map[string]any `json:"values"`
	Completeness completeness   `json:"completeness"`
}
