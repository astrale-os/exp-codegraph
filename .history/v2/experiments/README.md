# TypeSpec V2 governed experiments

These records freeze falsifiable performance hypotheses before an implementation spike can become
authoritative. They are neither qualification evidence nor accepted architecture revisions.

An experiment graduates only when:

1. behavior-neutral attribution identifies the predicted dominant cost;
2. independent semantic, performance, and layering reviews have no unresolved soundness objection;
3. the isolated candidate meets every frozen acceptance threshold on Codegraph, the Kernel holdout,
   and the named adversarial cases;
4. normalized incremental and cold semantic outputs are exactly equal; and
5. any public schema, ownership, or compatibility change is accepted through the revision protocol.

Failed and inconclusive results remain visible. Thresholds are not raised after measurement to make
a candidate pass.
