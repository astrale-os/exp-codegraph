package main

import (
	"encoding/hex"
	"runtime"
	"strconv"
	"strings"
)

// Set only by the release builder's Go linker flags, after building and hashing
// the companion worker. RPC inputs and adjacent manifests cannot set authority.
// An ordinary source-only development build has no qualified companion.
var governanceOwnedArtifactSHA string
var governanceOwnedArtifactBytes string
var governanceOwnedEngineVersion string
var governanceOwnedProtocolVersion string

var governanceOwnedArtifactLength = governanceOwnedBuildLength()
var governanceOwnedArtifactName = governanceOwnedExecutableName()

func governanceOwnedExecutableName() string {
	if runtime.GOOS == "windows" {
		return "codegraph-oxlint.exe"
	}
	return "codegraph-oxlint"
}

func governanceOwnedBuildLength() int {
	if governanceOwnedEngineVersion != "1.81.0" || governanceOwnedProtocolVersion != "1" {
		return 0
	}
	digest, err := hex.DecodeString(governanceOwnedArtifactSHA)
	if err != nil || len(digest) != 32 || strings.ToLower(governanceOwnedArtifactSHA) != governanceOwnedArtifactSHA {
		return 0
	}
	length, err := strconv.Atoi(governanceOwnedArtifactBytes)
	if err != nil || length <= 0 || strconv.Itoa(length) != governanceOwnedArtifactBytes {
		return 0
	}
	return length
}

func governanceQualifiedOwnedArtifact(artifact []byte) bool {
	return governanceOwnedArtifactLength > 0 && len(artifact) == governanceOwnedArtifactLength &&
		governanceHash(artifact) == governanceOwnedArtifactSHA
}
