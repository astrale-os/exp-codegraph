package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// The original generic ignore/config owner uses these operations through its
// I/O boundary. All positive, negative and failed operations join the same seal.
type governanceProbeKey struct {
	Path, Kind  string
	FollowLinks bool
}
type governanceProbeRequest struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Path        string `json:"path"`
	FollowLinks bool   `json:"followLinks,omitempty"`
}
type governanceProbeError struct {
	Kind    string `json:"kind"`
	Code    string `json:"code"`
	Message string `json:"message"`
}
type governanceProbeObservation struct {
	ID     string                `json:"id"`
	Status string                `json:"status"`
	Value  any                   `json:"value,omitempty"`
	Error  *governanceProbeError `json:"error,omitempty"`
}

func governanceProbeFailure(err error) *governanceProbeError {
	kind, code := "other", "UNKNOWN"
	switch {
	case os.IsNotExist(err):
		kind, code = "not-found", "ENOENT"
	case os.IsPermission(err):
		kind, code = "permission-denied", "EACCES"
	case errors.Is(err, syscall.ENOTDIR):
		kind, code = "not-directory", "ENOTDIR"
	case errors.Is(err, syscall.ELOOP):
		kind, code = "loop", "ELOOP"
	case errors.Is(err, syscall.EISDIR):
		code = "EISDIR"
	case errors.Is(err, syscall.EINVAL):
		kind, code = "invalid-data", "EINVAL"
	}
	return &governanceProbeError{kind, code, err.Error()}
}
func governanceObserveProbe(key governanceProbeKey) governanceProbeObservation {
	return governanceObserveProbeWithRead(key, os.ReadFile)
}
func governanceObserveProbeWithRead(key governanceProbeKey, read func(string) ([]byte, error)) governanceProbeObservation {
	out := governanceProbeObservation{Status: "known"}
	var err error
	switch key.Kind {
	case "metadata":
		var info os.FileInfo
		if key.FollowLinks {
			info, err = os.Stat(key.Path)
		} else {
			info, err = os.Lstat(key.Path)
		}
		if err == nil {
			out.Value = map[string]any{"isDirectory": info.IsDir(), "isFile": info.Mode().IsRegular(), "isSymlink": info.Mode()&os.ModeSymlink != 0, "length": info.Size()}
		}
	case "content-digest":
		var file *os.File
		file, err = os.Open(key.Path)
		if err == nil {
			hash := sha256.New()
			var length int64
			length, err = io.Copy(hash, file)
			closeErr := file.Close()
			if err == nil {
				err = closeErr
			}
			if err == nil {
				out.Value = map[string]any{"sha256": hex.EncodeToString(hash.Sum(nil)), "byteLength": length}
			}
		}
	case "read-bytes":
		var bytes []byte
		bytes, err = read(key.Path)
		if err == nil {
			if len(bytes) > 32*1024*1024 {
				out.Status = "unsupported"
				out.Value = map[string]any{"reason": "Captured generic read exceeds native frame admission bound."}
			} else {
				out.Value = map[string]string{"bytesBase64": base64.StdEncoding.EncodeToString(bytes)}
			}
		}
	case "directory":
		var entries []os.DirEntry
		entries, err = os.ReadDir(key.Path)
		return governanceDirectoryObservation(entries, err)
	case "canonicalize":
		var path string
		path, err = filepath.EvalSymlinks(key.Path)
		if err == nil {
			out.Value = map[string]string{"path": path}
		}
	default:
		out.Status = "unsupported"
		out.Value = map[string]string{"reason": "Unknown captured I/O operation."}
	}
	if err != nil {
		out.Status = "error"
		out.Error = governanceProbeFailure(err)
	}
	return out
}
func governanceProbeFingerprint(observation governanceProbeObservation) string {
	observation.ID = ""
	bytes, _ := json.Marshal(observation)
	return governanceHash(bytes)
}
func (c *governanceCapture) probe(requirement governanceProbeRequest) governanceProbeObservation {
	key := governanceProbeKey{Path: requirement.Path, Kind: requirement.Kind, FollowLinks: requirement.FollowLinks}
	out := governanceObserveProbe(key)
	if c.probeObservations == nil {
		c.probeObservations = map[governanceProbeKey]string{}
	}
	before := governanceProbeFingerprint(out)
	if existing, seen := c.probeObservations[key]; seen && existing != before {
		out.Status = "unsupported"
		out.Value = map[string]string{"reason": "Captured I/O observation changed within the private generation."}
		out.Error = nil
		c.probeInconsistent = true
	} else {
		c.probeObservations[key] = before
	}
	out.ID = requirement.ID
	return out
}
func (session *governanceSession) captureProbes(raw json.RawMessage) (any, error) {
	var params struct {
		Token        string                   `json:"token"`
		Requirements []governanceProbeRequest `json:"requirements"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return nil, err
	}
	var capture *governanceCapture
	if session.policySuspension != nil && session.policySuspension.Token == params.Token {
		capture = session.policySuspension.Capture
	} else if state := session.productsSession; state != nil && state.Project != nil && state.Token == params.Token && state.ProductsDigest == "" {
		capture = state.Project.capture
	}
	if capture == nil {
		return map[string]any{"status": "retry"}, nil
	}
	if len(params.Requirements) == 0 || len(params.Requirements) > 100000 {
		return nil, fmt.Errorf("captured I/O batch outside admission bounds")
	}
	seen := map[string]bool{}
	rows := []governanceProbeObservation{}
	for _, requirement := range params.Requirements {
		if requirement.ID == "" || seen[requirement.ID] || !filepath.IsAbs(requirement.Path) {
			return nil, fmt.Errorf("invalid captured I/O requirement")
		}
		seen[requirement.ID] = true
		row := capture.probe(requirement)
		if row.Status == "unsupported" {
			capture.probeInconsistent = true
		}
		rows = append(rows, row)
	}
	certificate := capture.certificate()
	if state := session.productsSession; state != nil && state.Project != nil && state.Token == params.Token {
		certificate = state.currentCertificate()
	}
	return map[string]any{"token": params.Token, "inputCertificate": certificate, "observations": rows}, nil
}

// A directory can yield entries before an iteration failure. The v1 wire has
// no partial-entry row, so this is an authority gap, not an empty error result.
func governanceDirectoryObservation(entries []os.DirEntry, err error) governanceProbeObservation {
	out := governanceProbeObservation{Status: "known"}
	if err != nil {
		if len(entries) > 0 {
			out.Status = "unsupported"
			out.Value = map[string]string{"reason": "Partial directory enumeration cannot be represented by capture-probes v1."}
			return out
		}
		out.Status = "error"
		out.Error = governanceProbeFailure(err)
		return out
	}
	rows := []map[string]string{}
	for _, entry := range entries {
		kind := "other"
		switch {
		case entry.Type()&os.ModeSymlink != 0:
			kind = "symlink"
		case entry.IsDir():
			kind = "directory"
		case entry.Type().IsRegular():
			kind = "file"
		}
		rows = append(rows, map[string]string{"name": entry.Name(), "kind": kind})
	}
	out.Value = map[string]any{"entries": rows}
	return out
}
