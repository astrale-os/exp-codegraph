import type {
  NativeDecisionContinuation,
  NativeDecisionImplementationContract,
  NativeDecisionPrepareRequest,
} from '../../analysis/native/index.ts';

declare const source: NativeDecisionPrepareRequest['policySource'];
const contract: NativeDecisionImplementationContract = {
  ruleId: 'APPLICATION-CUSTOM-ONE',
  ruleRevision: 'canonical-rule-revision',
  requiredFacts: ['application-proof'],
  implementation: { id: 'application.policy.reducer', version: 'v17' },
};
const initial: NativeDecisionPrepareRequest = {
  root: '.', projectionMode: 'sdk-rule-products', basePolicyDigest: 'canonical',
  policySource: source,
  ruleRevisions: [{ id: contract.ruleId, revision: contract.ruleRevision }],
  implementationContracts: [contract],
  options: { sourcePolicyOwnerRevision: 3 },
};
const continued: NativeDecisionContinuation = {
  token: 'captured', kind: 'policy',
  policy: { source, digest: 'canonical', disabled: [], ignorePatterns: [], ignorePatternUnits: [] },
  leafAuthority: { neutralClassIconSVG: '' },
};
const repeated: NativeDecisionContinuation = { ...continued, implementationContracts: initial.implementationContracts };
void repeated;
const empty: NativeDecisionPrepareRequest = { ...initial, implementationContracts: [] };
void empty;
const nullInventory: NativeDecisionPrepareRequest = {
  ...initial,
  // @ts-expect-error Null is not an explicitly empty implementation inventory.
  implementationContracts: null,
};
void nullInventory;
// @ts-expect-error An offered contract and its implementation identity are immutable.
contract.implementation.version = 'another';
// @ts-expect-error Required-fact authority is a readonly list of strings.
contract.requiredFacts.push('another');
const malformed: NativeDecisionImplementationContract = {
  ...contract,
  // @ts-expect-error Arbitrary fact objects cannot enter the contract DTO.
  requiredFacts: [{ proof: true }],
};
void malformed;
