package main

import "encoding/json"

// These products belong to one actual input capture, not a compiler proposal or
// a cross-generation package cache. Only the original JSON Name projection is
// retained. Parent search, error ordering and coordinate formatting remain in
// their original consumers because universe and value provenance differ.
type governancePackageCoordinateAuthority struct {
	manifests map[string]governancePackageManifestProduct
}

type governancePackageManifestProduct struct {
	name       string
	parseError error
	readError  error
}

// An internal read-only borrow of the original retained byte cell. Every demand
// still checks late owned-journal overlap in the same order as capture.read. No
// mutable byte alias reaches an external consumer; read keeps its copy contract.
func (capture *governanceCapture) borrowReadCell(path string) governanceCapturedBytes {
	if before, seen := capture.byteCells[path]; seen {
		if !capture.ownedReadMatches(path, before.bytes, before.err) {
			capture.probeInconsistent = true
		}
		return before
	}
	// The original operation owns first-read bytes, errors, digest observations,
	// and overlap checks. In particular, this is not a generic-journal replay.
	capture.read(path)
	return capture.byteCells[path]
}

func (capture *governanceCapture) packageManifestProduct(path string) governancePackageManifestProduct {
	cell := capture.borrowReadCell(path)
	authority := &capture.packageCoordinates
	if authority.manifests == nil {
		authority.manifests = map[string]governancePackageManifestProduct{}
	}
	if product, seen := authority.manifests[path]; seen {
		return product
	}
	product := governancePackageManifestProduct{readError: cell.err}
	if cell.err == nil {
		var document struct {
			Name string `json:"name"`
		}
		product.parseError = json.Unmarshal(cell.bytes, &document)
		product.name = document.Name
	}
	authority.manifests[path] = product
	return product
}
