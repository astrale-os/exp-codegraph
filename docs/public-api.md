# Public API

[Product overview and examples](../README.md) · [Structural inspection](typescript-structure.md) · [TypeScript values](typescript-values.md) · [Module contracts](module-contracts.md)

This inventory covers every named export of the package’s eleven code entrypoints. Runtime exports appear first; type-only exports are folded below each entry. For signatures and methods, open the linked source interface. `@astrale-os/codegraph/package.json` also exposes package metadata.

## Reader methods

The main inspection interfaces: [project and snapshots](../analysis/typescript/project/model.ts), [structural navigation](../analysis/typescript/structure/model.ts), [call inventory](../analysis/typescript/body/types.ts), [value evaluation](../analysis/typescript/value/model.ts), [typed facts](../analysis/typescript/facts/model.ts), [generic queries and stores](../analysis/query/model.ts).

```text
project.refresh({ changed?, changes?, discover?, invalidate?, bodyDemand?, signal? })
project.open(generation?)
project.dispose()

snapshot.generation · snapshot.facts · snapshot.query
snapshot.structure()
snapshot.calls({ paths?, sources?, signal? })
snapshot.values({ call?, limits? })
snapshot.compute(observe, input, { signal? })
snapshot.dispose()

structure.symbolAt({ path, offset, revision?, signal? })
structure.exports({ path, signal? })
structure.references({ target, paths?, includeDeclarations?, signal? })
structure.dependencies({ paths?, signal? })
structure.dependents({ path, transitive?, signal? })
target: { path, name } · { symbol } · { origin }
compute read: structure() · calls(options?) · values(options?)

values.value(occurrence).property(name).invoke().resolve({ limits?, signal? })
values.evaluate(occurrence, { signal? })
values.canReuse(proof)

snapshot.facts.facts(kind, filter?, page?)
snapshot.facts.factsById(kind, ids)
snapshot.facts.export(kind, filter?)
snapshot.facts.exportAll(filter?)

query.generation
query.manifest() · query.capabilities()
query.headers(filter?, page?) · query.headersById(ids) · query.exportHeaders(filter?)
query.facts(filter?, page?) · query.factsById(ids) · query.export(filter?)
query.dispose()

filter: namespaces? · kinds? · subjects? · sources? · symbols? · completeness?
page: limit · cursor? · includeTotal?
typed fact filters omit namespaces

store.current(universe) · store.commit(transaction, { signal? })
store.open(universe, generation?) · store.snapshotSet(generations, inventory)
store.dispose()
snapshotSet.id · snapshotSet.inventory · snapshotSet.generations · snapshotSet.universes
snapshotSet.query(universe) · snapshotSet.dispose()
```

The notation above is a method map, not executable TypeScript. Exact options, result unions, ownership and lifetime rules live in the interfaces and [value guide](typescript-values.md).

## `@astrale-os/codegraph/analysis/typescript`

Inspect a resident TypeScript project: calls, contextual values, facts, compiler sessions and native resolution.

[Exports and signatures](../analysis/typescript/index.ts)

**Functions**

```text
createBoundedValueEvaluator
createTypeScriptAnalysisPipeline
createTypeScriptAnalysisService
createTypeScriptFactReader
mapValueResult
openCapturedTypeScriptReader
openTypeScriptProject
preloadNativeArtifacts
resolveBoundedValueLimits
resolvePackagedNativeAnalysis
resolvePackagedNativeOxlint
typeScriptDependencyIdentity
typeScriptDependencyOccurrenceIdentity
validateFunctionBodyIR
```

**Classes**

```text
BodyDemandExpansionRequired
NativeAnalysisDistributionError
TypeScriptFactContractError
```

**Constants**

```text
DEFAULT_BOUNDED_VALUE_LIMITS
TYPESCRIPT_ANALYSIS_CAPABILITIES
TYPESCRIPT_BODY_PAYLOAD_CODEC
TYPESCRIPT_BODY_PAYLOAD_CODEC_ID
TYPESCRIPT_DECLARATION_FACT_KIND
TYPESCRIPT_DECLARATION_FACT_NAMESPACE
TYPESCRIPT_FACT_NAMESPACES
TYPESCRIPT_FACT_PAYLOAD_CODECS
TYPESCRIPT_MODULE_FACT_NAMESPACE
```

<details>
<summary>Types</summary>

```text
AnyTypeScriptFact
BodyOccurrence
BodyOccurrenceKind
BodyRelation
BoundedValueEvaluator
BoundedValueEvaluatorOptions
BoundedValueLimits
CapturedTypeScriptSemanticReader
ControlFlowBlock
ControlFlowEdge
ControlFlowEdgeKind
DefinitionUse
EvaluatedValueResult
FunctionBodyIR
FunctionSummary
NativeAnalysisArtifact
NativeAnalysisDistributionErrorCode
NativeAnalysisReleaseManifest
NativeAnalysisTarget
NativeArtifactCompression
NativeArtifactPreloadOptions
NativeOxlintArtifact
NormalizedTypeScriptModuleFact
ObservationIssue
ObservedCallable
ObservedCallableValueFacet
ObservedDeclaration
ObservedDeclarationFacets
ObservedDeclarationKind
ObservedExport
ObservedMember
ObservedObjectValueFacet
ObservedParameter
ObservedSurface
ObservedType
ObservedTypeFacet
ObservedTypeParameter
PackagedNativeAnalysisOptions
PreloadedNativeArtifacts
ParameterBinding
ResolvedCall
ResolvedPackagedNativeAnalysis
ResolvedPackagedNativeOxlint
SourceLocation
SourcePosition
SymbolicCallContext
SymbolicCallModel
SymbolicOperandPlan
SymbolicValue
SymbolicValuePlan
SymbolicValueResolveOptions
TypeScriptAnalysisPipelineOptions
TypeScriptAnalysisService
TypeScriptAnalysisServiceOptions
TypeScriptBodyDemandEffect
TypeScriptBodyDemandFacts
TypeScriptBodyDemandReceipt
TypeScriptBodyFacts
TypeScriptCallInventory
TypeScriptCallQuery
TypeScriptCallSite
TypeScriptComputation
TypeScriptDeclarationFact
TypeScriptDependencyInventory
TypeScriptDependent
TypeScriptDependentInventory
TypeScriptDependencyFact
TypeScriptDependencyOccurrence
TypeScriptDiagnosticFact
TypeScriptErrorCodeFact
TypeScriptExport
TypeScriptExportInventory
TypeScriptFact
TypeScriptFactFilter
TypeScriptFactKind
TypeScriptFactPage
TypeScriptFactPayloadByKind
TypeScriptFactReader
TypeScriptFileDependency
TypeScriptFileDependencyKind
TypeScriptFunctionHeader
TypeScriptLocatedSymbol
TypeScriptModuleDeclarationReference
TypeScriptModuleFact
TypeScriptModuleRouting
TypeScriptModuleRoutingEntry
TypeScriptModuleTarget
TypeScriptOccurrenceFact
TypeScriptProject
TypeScriptProjectFact
TypeScriptProjectOptions
TypeScriptProjectRefresh
TypeScriptProjectSnapshot
TypeScriptProjectUpdate
TypeScriptRefreshResult
TypeScriptReference
TypeScriptReferenceInventory
TypeScriptReferenceKind
TypeScriptReferenceQuery
TypeScriptReferenceTarget
TypeScriptSemanticReader
TypeScriptSourceFact
TypeScriptSourcePosition
TypeScriptStructuralInventory
TypeScriptStructuralReader
TypeScriptStructuralScope
TypeScriptStructuralSymbol
TypeScriptStructureFact
TypeScriptSymbolAtInventory
TypeScriptSymbolDeclaration
TypeScriptSymbolFact
TypeScriptSymbolOrigin
TypeScriptSymbolSite
ValueResult
```

</details>

## `@astrale-os/codegraph/analysis`

Compose analysis passes and policies, store immutable facts, read verified source and host native compiler processes.

[Exports and signatures](../analysis/index.ts)

**Functions**

```text
admitAnalysisId
combineCompleteness
createMemoryAnalysisStore
createNodeSourceTextReader
createProcessNativeAnalysisSessionFactory
deriveAnalysisId
deriveAnalysisSnapshotSetId
factHeader
factShardDigest
generationIdentity
planPasses
portablePath
readVerifiedSourceText
runAnalysisPolicies
runPortablePasses
selectAnalysisStore
shardReference
validateFactShard
validateFactTransaction
```

**Classes**

```text
AnalysisStoreUnavailableError
NativeAnalysisProcessResourceError
PassPlanError
TransactionError
```

**Constants**

```text
ANALYSIS_TELEMETRY_FORMAT
APPLICATION_BINDING_FACT_NAMESPACE
DEFAULT_PROCESS_NATIVE_ANALYSIS_LIMITS
NATIVE_ANALYSIS_PROTOCOL_VERSION
```

<details>
<summary>Types</summary>

```text
AnalysisFailure
AnalysisGeneration
AnalysisGenerationId
AnalysisId
AnalysisLimit
AnalysisPolicy
AnalysisPolicyContext
AnalysisQuery
AnalysisSnapshotSet
AnalysisStore
AnalysisStoreSelection
AnalysisStoreSelectionOptions
AnalysisTelemetryEvent
AnalysisTelemetryMetric
AnalysisTelemetrySink
ApplicationModuleBindingCompilation
ApplicationModuleBindingDependency
ApplicationModuleBindingDiagnostic
ApplicationModuleBindingExport
ApplicationModuleBindingExportFacet
ApplicationModuleBindingFact
ApplicationModuleBindingRequest
ApplicationModuleBindingTarget
ApplicationModuleBindingWork
CapabilityStatus
Completeness
Fact
FactFilter
FactHeader
FactHeaderPage
FactId
FactPage
FactPayloadCodec
FactProvenance
FactSchemaReference
FactShard
FactShardDigest
FactShardKey
FactShardReference
FactTransaction
MemoryAnalysisStoreOptions
NativeAnalysisAcknowledgement
NativeAnalysisRequest
NativeAnalysisResponse
NativeAnalysisSession
NativeAnalysisSessionFactory
NativeCapturedAnalysisPort
NativeCapturedAnalysisSource
NativeCapturedAnalysisStamp
NativeBodyDemand
NativeFactDelta
NativeModuleBoundary
NativeProjectDescriptor
NativeSourceChange
OccurrenceId
PageRequest
PassId
PassManifest
PassOutput
PassPlan
PassPlanningEnvironment
PassRuntime
PassScope
PersistenceRequirement
PolicyDiagnostic
PolicyEvaluation
PolicyId
PolicyManifest
PolicyRuleResult
PolicyRuleStatus
PolicyRunOptions
PortablePass
PortablePassContext
PortablePassRunOptions
PortablePassRunResult
PortableSourceCoordinate
ProcessNativeAnalysisSessionFactoryOptions
ProducerId
ProducerIdentity
ProjectUniverseId
RepositoryId
SnapshotSetId
SourceId
SourceManifestId
SourceRevisionId
SourceSpan
SourceTextExpectation
SourceTextReader
SymbolId
TransactionFailureCode
VerifiedSourceText
```

</details>

## `@astrale-os/codegraph/analysis/sqlite`

Persist analysis facts in SQLite; import only when choosing this store.

[Exports and signatures](../analysis/sqlite/index.ts)

**Functions**

```text
createSQLiteAnalysisStore
```

**Constants**

```text
DEFAULT_SQLITE_ANALYSIS_LIMITS
DEFAULT_SQLITE_PAYLOAD_MATERIALIZATION
```

<details>
<summary>Types</summary>

```text
SQLiteAnalysisStoreOptions
SQLitePayloadMaterialization
```

</details>

## `@astrale-os/codegraph/analysis/native`

Integrate native decision sessions and resolve the packaged analysis or lint executable.

[Exports and signatures](../analysis/native/index.ts)

**Functions**

```text
openNativeDecisionSession
preloadNativeArtifacts
resolvePackagedNativeAnalysis
resolvePackagedNativeOxlint
```

**Classes**

```text
NativeAnalysisDistributionError
NativeDecisionServiceError
```

**Constants**

```text
NATIVE_DECISION_CONTRACT_REVISION
NATIVE_DECISION_PROTOCOL_VERSION
```

<details>
<summary>Types</summary>

```text
NativeAnalysisArtifact
NativeAnalysisDistributionErrorCode
NativeAnalysisReleaseManifest
NativeAnalysisTarget
NativeArtifactCompression
NativeDecisionCandidate
NativeDecisionCaptureObservation
NativeDecisionCaptureRequirement
NativeDecisionCaptureResult
NativeDecisionConfiguration
NativeDecisionContinuation
NativeDecisionGenericEngine
NativeDecisionGenericRequest
NativeDecisionIntrinsicRequirement
NativeDecisionPreparation
NativeDecisionPrepareRequest
NativeDecisionProcessOptions
NativeDecisionProductsCandidate
NativeDecisionSeal
NativeDecisionSealRequest
NativeDecisionSession
NativeOxlintArtifact
NativeArtifactPreloadOptions
PackagedNativeAnalysisOptions
PreloadedNativeArtifacts
ResolvedPackagedNativeAnalysis
ResolvedPackagedNativeOxlint
```

</details>

## `@astrale-os/codegraph/repository`

Inventory files, classify and group a repository, measure source lines and read revision-verified source.

[Exports and signatures](../repository/index.ts)

**Functions**

```text
aggregateRepositoryStatistics
analyzeRepositoryStatistics
analyzeSourceLines
createNodeRepositoryScanner
createRepositoryPathOwnershipGrouping
createRepositorySourceService
createSourceProof
createTextSourceLineAnalyzer
createTypeScriptSourceLineAnalyzer
defaultRepositoryClassifiers
defaultRepositorySourceLineAnalyzers
defaultRepositoryStatisticsGroupings
emptySourceLines
inventoryRepository
mergeStatisticsCompleteness
physicalSourceLines
refreshRepositoryStatistics
repositoryFacts
sumSourceLines
summarizeRepositoryStatistics
textSourceLines
typeScriptSourceLines
```

**Constants**

```text
DEFAULT_REPOSITORY_SOURCE_MAXIMUM_TEXT_BYTES
```

<details>
<summary>Types</summary>

```text
RepositoryClassification
RepositoryClassifier
RepositoryContent
RepositoryDelivery
RepositoryFile
RepositoryFileStatistics
RepositoryInventory
RepositoryInventoryOptions
RepositoryLifecycle
RepositoryPathOwner
RepositoryProvenance
RepositoryPurpose
RepositoryScanEntry
RepositoryScanner
RepositoryScope
RepositorySourceLineAnalyzer
RepositorySourceLineInput
RepositorySourceRead
RepositorySourceRequest
RepositorySourceService
RepositorySourceServiceOptions
RepositoryStatisticsGroup
RepositoryStatisticsGrouping
RepositoryStatisticsIssue
RepositoryStatisticsOptions
RepositoryStatisticsRefreshOptions
RepositoryStatisticsRefreshResult
RepositoryStatisticsRefreshWork
RepositoryStatisticsReport
RepositoryStatisticsSummary
SourceLineMetrics
SourceProof
SourceProofAdmission
SourceProofFallbackCode
SourceProofId
SourceProofOverlayEntry
SourceProofProvider
SourceScope
```

</details>

## `@astrale-os/codegraph/authoring`

Declare capabilities, laws, states, layouts, packages and benchmarks inside module contracts.

[Exports and signatures](../authoring/index.ts)

**Functions**

```text
defineBenchmark
defineCapability
defineCode
defineLaw
defineLayout
definePackage
definePackagePattern
defineState
eventsOf
illegalTransitionsOf
statesOf
transition
transitionsOf
```

<details>
<summary>Types</summary>

```text
BenchmarkDefinition
CapabilityDefinition
CodeAnchorReference
CodeConfiguration
EventOf
IllegalTransition
InitialStateOf
LawDefinition
LayoutConfiguration
LayoutDefinition
LayoutEntries
NextStateOf
PackageDependencyDefinition
PackagePatternDefinition
SemanticReference
StateDefinition
StateOf
TerminalStateOf
TestEvidenceReference
TransitionOf
TransitionTable
```

</details>

## `@astrale-os/codegraph/conformance`

Qualify specifications and compose validity, structure, surface, dependency, schema, layout and evidence profiles.

[Exports and signatures](../conformance/index.ts)

**Functions**

```text
createModuleConformanceProfiles
createModuleDependenciesConformanceProfile
createModuleLayoutConformanceProfile
createModuleSchemaConformanceProfile
createModuleStructureConformanceProfile
createModuleSurfaceConformanceProfile
createModuleTestEvidenceConformanceProfile
createSpecificationValidityConformanceProfile
createTypeSpecConformanceProfiles
planConformance
qualifySpecification
qualifySpecifications
rebindQualificationSnapshot
```

**Constants**

```text
MODULE_DEPENDENCIES_PROFILE_ID
MODULE_LAYOUT_PROFILE_ID
MODULE_SCHEMA_PROFILE_ID
MODULE_STRUCTURE_PROFILE_ID
MODULE_SURFACE_PROFILE_ID
MODULE_TEST_EVIDENCE_PROFILE_ID
SPECIFICATION_VALIDITY_PROFILE_ID
```

<details>
<summary>Types</summary>

```text
ConformanceCapabilityRequirement
ConformanceCoverage
ConformanceDiagnostic
ConformancePlan
ConformanceProfile
ConformanceProfileContext
ConformanceProfileManifest
ConformanceRuleResult
ConformanceStatus
ModuleLayoutConformanceOptions
ModuleTestEvidenceConformanceOptions
QualificationProfileResult
QualificationScope
QualificationSnapshot
QualificationSnapshotId
QualifySpecificationOptions
QualifySpecificationsOptions
```

</details>

## `@astrale-os/codegraph/schema`

Load schemas and validate documents, files, values and module schema catalogs.

[Exports and signatures](../schema/index.ts)

**Functions**

```text
loadSchema
validateData
validateModuleSchemaCatalog
validateSchemaDocument
validateSchemaFile
```

<details>
<summary>Types</summary>

```text
SchemaFileValidationOptions
SchemaSource
```

</details>

## `@astrale-os/codegraph/specification`

Compile and load module contracts, derive capability status, resolve descriptors and initialize specifications.

[Exports and signatures](../specification/index.ts)

**Functions**

```text
capabilitiesCiting
capabilityReferenceSources
compileDescriptor
compileSpecificationSnapshot
compileSpecificationSnapshots
deriveCapabilityStatuses
initializeModuleSpecification
loadModuleSemanticDeclarations
locateDescriptorValue
specificationModuleId
```

**Constants**

```text
MINIMUM_MODULE_SPEC
```

<details>
<summary>Types</summary>

```text
AuthoredLawResource
AuthoredLawSpecification
AuthoredLayoutResource
AuthoredStateResource
AuthoredStateSpecification
BenchmarkResource
BenchmarkSpecification
CapabilityCitation
CapabilityCoordinate
CapabilityDerivationModule
CapabilityResource
CapabilitySpecification
CapabilityStatus
CodeDeclarationResource
DeclarationResource
DerivedCapability
DescriptorCompilation
DescriptorDefinitions
DescriptorElement
DescriptorKind
ExampleResource
ExportedDefinition
HistoryPresentation
HistoryResource
ImplementationBinding
LawResource
LawSpecification
LayoutAdditionalPath
LayoutEntry
LayoutEntryObservation
LayoutEntryStatus
LayoutIgnorePattern
LayoutIgnorePatternSource
LayoutObservation
LayoutObservedKind
LayoutPathKind
LayoutResource
MarkdownResource
ModuleCodeResource
ModuleDescriptorResource
ModuleIconResource
ModuleSemanticDeclarations
ModuleSourceResource
PackagePatternResource
PackageSpecificationResource
PortInterface
PortResource
SchemaResource
SpecificationCompilationBatchOptions
SpecificationCompilationPhase
SpecificationModuleSnapshot
SpecificationSnapshot
SpecificationSnapshotId
StateResource
StateSpecification
SvgIconElement
TestEvidence
TestEvidenceStatus
TextResource
```

</details>

## `@astrale-os/codegraph`

Build an application that refreshes specifications, opens pinned readers and serves source evidence.

[Exports and signatures](../index.ts)

**Functions**

```text
createTypeSpecApplicationService
```

<details>
<summary>Types</summary>

```text
TypeSpecApplicationChanges
TypeSpecApplicationOptions
TypeSpecApplicationReader
TypeSpecApplicationRefresh
TypeSpecApplicationRefreshOptions
TypeSpecApplicationSelection
TypeSpecApplicationService
TypeSpecApplicationSnapshot
TypeSpecApplicationSnapshotId
TypeSpecApplicationTiming
```

</details>

## `@astrale-os/codegraph/workspace`

Encode, decode and persist application workspace checkpoints.

[Exports and signatures](../workspace/index.ts)

**Functions**

```text
createFileWorkspaceCheckpointStore
decodeWorkspaceCheckpointJson
encodeWorkspaceCheckpointJson
```

**Constants**

```text
DEFAULT_WORKSPACE_CHECKPOINT_LIMITS
WORKSPACE_CHECKPOINT_JSON_ENCODING
```

<details>
<summary>Types</summary>

```text
FileWorkspaceCheckpointStore
FileWorkspaceCheckpointStoreOptions
JsonValue
WorkspaceCheckpointArtifactDescriptor
WorkspaceCheckpointArtifactInput
WorkspaceCheckpointArtifacts
WorkspaceCheckpointHit
WorkspaceCheckpointJsonArtifact
WorkspaceCheckpointJsonOptions
WorkspaceCheckpointLoadOptions
WorkspaceCheckpointLoadResult
WorkspaceCheckpointManifest
WorkspaceCheckpointManifestInput
WorkspaceCheckpointMiss
WorkspaceCheckpointMissReason
WorkspaceCheckpointOperationOptions
WorkspaceCheckpointPublishInput
```

</details>
