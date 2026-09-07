/** Address one exact source, producer, repository, family, and semantic-plan pack. */
export declare function semanticPackScope(input: {
    readonly sourceProof: string;
    readonly producerFingerprint: string;
    readonly repository: string;
    readonly family: string;
}): string;
