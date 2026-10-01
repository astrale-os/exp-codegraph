package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Populated from the exact private original1.81 build, never client parameters.
const governanceOwnedArtifactName = "captured-owned-oxlint-1.81.0"
const governanceOwnedArtifactSHA = "fd6eeb3f9bee5879040cbf2304021f5735932a45d9009768b85a4791d7818df5"
const governanceOwnedArtifactLength = 9838944

type governanceOwnedStartup struct {
	DirectoryMs     float64   `json:"directoryMs"`
	SnapshotWriteMs float64   `json:"snapshotWriteMs"`
	SetupMs         float64   `json:"setupMs"`
	StartCallMs     float64   `json:"startCallMs"`
	AfterStart      time.Time `json:"-"`
}
type governanceOwnedProcess struct {
	startup   governanceOwnedStartup
	artifact  *governanceOwnedArtifactLease
	directory string
	cmd       *exec.Cmd
	input     io.WriteCloser
	output    *bufio.Scanner
	instance  string
	epoch     uint64
	closed    atomic.Bool
	cancel    context.CancelFunc
	once      sync.Once
	done      chan struct{}
}

func (p *governanceOwnedProcess) close() {
	p.once.Do(func() {
		p.closed.Store(true)
		p.cancel()
		p.input.Close()
		p.cmd.Process.Kill()
	})
}
func governanceNewOwnedProcess(artifact []byte) (*governanceOwnedProcess, error) {
	if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		return nil, fmt.Errorf("current package bytes differ from original qualified worker")
	}
	store, err := governanceOwnedRuntimeArtifactStore()
	if err != nil {
		return nil, &governanceOwnedCapabilityUnavailable{err}
	}
	return governanceNewOwnedProcessWithin(artifact, store)
}
func governanceNewOwnedProcessWithin(artifact []byte, store string) (*governanceOwnedProcess, error) {
	began := time.Now()
	// Resource identity failures are not runtime capability failures.
	if len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		return nil, fmt.Errorf("current package bytes differ from original qualified worker")
	}
	lease, err := governanceAcquireOwnedArtifact(artifact, store)
	if err != nil {
		return nil, &governanceOwnedCapabilityUnavailable{err}
	}
	started := false
	defer func() {
		if !started {
			lease.close()
		}
	}()
	setupStarted := time.Now()
	context, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(context, lease.path)
	input, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		input.Close()
		return nil, err
	}
	cmd.Stderr = io.Discard
	identity := make([]byte, 24)
	if _, err = rand.Read(identity); err != nil {
		cancel()
		input.Close()
		return nil, err
	}
	setupElapsed := time.Since(setupStarted).Seconds() * 1000
	startStarted := time.Now()
	if err = cmd.Start(); err != nil {
		cancel()
		input.Close()
		return nil, &governanceOwnedCapabilityUnavailable{err}
	}
	afterStart := time.Now()
	started = true
	p := &governanceOwnedProcess{artifact: lease, directory: filepath.Dir(lease.path), cmd: cmd, input: input, instance: hex.EncodeToString(identity), cancel: cancel, done: make(chan struct{})}
	p.startup = governanceOwnedStartup{DirectoryMs: setupStarted.Sub(began).Seconds() * 1000, SetupMs: setupElapsed, StartCallMs: afterStart.Sub(startStarted).Seconds() * 1000, AfterStart: afterStart}
	p.output = bufio.NewScanner(output)
	p.output.Buffer(make([]byte, 65536), 64*1024*1024)
	go func() { cmd.Wait(); lease.close(); p.closed.Store(true); close(p.done) }()
	return p, nil
}

type governanceOwnedOwner struct {
	Instance string `json:"instance"`
	Epoch    uint64 `json:"epoch"`
	Token    string `json:"token"`
	Artifact string `json:"artifact"`
}

type governanceOwnedRow struct {
	Requirement governanceProbeRequest     `json:"requirement"`
	Observation governanceProbeObservation `json:"observation"`
}

func governanceOwnedKey(r governanceProbeRequest) governanceProbeKey {
	return governanceProbeKey{Path: r.Path, Kind: r.Kind, FollowLinks: r.FollowLinks}
}
func governanceOwnedErrno(code string) (int, bool) {
	switch code {
	case "ENOENT":
		return int(syscall.ENOENT), true
	case "EACCES":
		return int(syscall.EACCES), true
	case "ENOTDIR":
		return int(syscall.ENOTDIR), true
	case "ELOOP":
		return int(syscall.ELOOP), true
	case "EISDIR":
		return int(syscall.EISDIR), true
	case "EINVAL":
		return int(syscall.EINVAL), true
	}
	return 0, false
}
func governanceStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing owned producer data")
	}
	return nil
}
func (session *governanceSession) captureOwnedGeneric(raw json.RawMessage) (any, error) {
	started := time.Now()
	var params struct {
		Token                 string          `json:"token"`
		ConfigPath            string          `json:"configPath"`
		Config                json.RawMessage `json:"config,omitempty"`
		ConfigBytes           []int           `json:"configBytes,omitempty"`
		CommandIgnorePatterns []string        `json:"commandIgnorePatterns"`
	}
	if err := governanceStrictJSON(raw, &params); err != nil {
		return nil, err
	}
	state := session.productsSession
	if state == nil || state.Project == nil || state.Token != params.Token || state.ProductsDigest != "" || !state.GenericSuspended {
		return map[string]any{"status": "retry"}, nil
	}
	capture := state.Project.capture
	if capture.ownedGenericOwner != nil {
		return nil, fmt.Errorf("original producer is already closed for this capture")
	}
	engine := state.GenericEngine
	if engine == nil || engine.Version != "1.81.0" || engine.ArtifactDigest != governanceOwnedArtifactSHA {
		return nil, fmt.Errorf("owned original engine artifact is not selected")
	}
	if !filepath.IsAbs(params.ConfigPath) || (len(params.Config) == 0) == (params.ConfigBytes == nil) {
		return nil, fmt.Errorf("owned configuration lacks closed identity")
	}
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	artifactPath := filepath.Join(filepath.Dir(executable), governanceOwnedArtifactName)
	actualArtifact := capture.probe(governanceProbeRequest{ID: "owned-artifact", Kind: "content-digest", Path: artifactPath})
	if actualArtifact.Status != "known" || capture.probeInconsistent {
		return map[string]any{"status": "retry"}, nil
	}
	artifact, err := os.ReadFile(artifactPath)
	if err != nil || len(artifact) != governanceOwnedArtifactLength || governanceHash(artifact) != governanceOwnedArtifactSHA {
		return nil, fmt.Errorf("owned worker artifact differs from qualified bytes")
	}
	if session.genericProducer == nil || session.genericProducer.closed.Load() {
		session.genericProducer, err = session.startOwnedGenericProcess(artifact)
		if err != nil {
			var unavailable *governanceOwnedCapabilityUnavailable
			if errors.As(err, &unavailable) {
				return map[string]any{"status": "owned-unavailable", "token": params.Token, "reason": "runtime-artifact-unavailable"}, nil
			}
			return nil, err
		}
	}
	producer := session.genericProducer
	if !producer.artifact.verify() {
		producer.close()
		return map[string]any{"status": "retry"}, nil
	}
	producer.epoch++
	if producer.epoch > 9007199254740991 {
		return nil, fmt.Errorf("owned producer epoch exhausted")
	}
	owner := governanceOwnedOwner{producer.instance, producer.epoch, params.Token, governanceOwnedArtifactSHA}
	ownerBytes, _ := json.Marshal(owner)
	var logicalOwner any
	json.Unmarshal(ownerBytes, &logicalOwner)
	ownerJSON, _ := json.Marshal(logicalOwner)
	request := map[string]any{"operation": "discover-owned-batch", "token": params.Token, "root": state.Project.Root, "configPath": params.ConfigPath, "commandIgnorePatterns": params.CommandIgnorePatterns, "observations": []any{}, "goOwner": owner}
	if len(params.Config) > 0 {
		request["config"] = params.Config
	} else {
		request["configBytes"] = params.ConfigBytes
	}
	write := func(value any) error {
		encoded, err := json.Marshal(value)
		if err != nil {
			return err
		}
		encoded = append(encoded, '\n')
		_, err = producer.input.Write(encoded)
		return err
	}
	beforeSend := time.Now()
	if err = write(request); err != nil {
		producer.close()
		return nil, err
	}
	timer := time.AfterFunc(90*time.Second, producer.close)
	defer timer.Stop()
	completed := false
	defer func() {
		if !completed {
			producer.close()
		}
	}()
	goRows := map[governanceProbeKey]governanceProbeObservation{}
	pending := map[governanceProbeKey]governanceProbeObservation{}
	pendingBytes := map[string][]byte{}
	draftRows := map[governanceProbeKey]governanceProbeObservation{}
	producerTrace := []governanceOwnedPhysicalPair{}
	drafted := false
	requireDraft := false
	telemetry := map[string]any{"draftRows": 0, "bridges": 0, "fallback": false, "beforeSendMs": beforeSend.Sub(started).Seconds() * 1000}
	for wave := 0; wave < 100000; wave++ {
		if !producer.output.Scan() {
			return nil, fmt.Errorf("owned worker ended without a closed journal: %v", producer.output.Err())
		}
		if producer.closed.Load() {
			return map[string]any{"status": "retry"}, nil
		}
		var envelope struct {
			Status             string                 `json:"status"`
			Owner              json.RawMessage        `json:"owner"`
			EngineVersion      string                 `json:"engineVersion"`
			Requirement        governanceProbeRequest `json:"requirement"`
			AttemptErrno       *int                   `json:"attemptErrno"`
			JournalRetained    bool                   `json:"journalRetained"`
			JournalCount       int                    `json:"journalCount"`
			JournalClosed      bool                   `json:"journalClosed"`
			Token              string                 `json:"token"`
			Journal            []governanceOwnedRow   `json:"journal"`
			Membership         json.RawMessage        `json:"membership"`
			Lint               json.RawMessage        `json:"lint"`
			Error              *string                `json:"error"`
			Complete           *bool                  `json:"complete"`
			DraftError         *string                `json:"draftError"`
			PartialDirectories []json.RawMessage      `json:"partialDirectories"`
		}
		// Decode the authenticated frame once. Original worker error envelopes
		// retain their full message; unused tables are not copied to inspect a
		// top-level error key before decoding the same frame again.
		if err = governanceStrictJSON(producer.output.Bytes(), &envelope); err != nil {
			return nil, err
		}
		if envelope.Error != nil {
			return nil, fmt.Errorf("owned original worker rejected request: %s", *envelope.Error)
		}
		if envelope.Complete != nil {
			return nil, fmt.Errorf("owned original worker returned a non-result envelope")
		}
		var actualOwner any
		if json.Unmarshal(envelope.Owner, &actualOwner) != nil {
			return nil, fmt.Errorf("missing owned worker identity")
		}
		actualOwnerJSON, _ := json.Marshal(actualOwner)
		if !bytes.Equal(ownerJSON, actualOwnerJSON) || envelope.EngineVersion != engine.Version {
			return nil, fmt.Errorf("owned worker changed instance/epoch/token/artifact/version")
		}

		if envelope.Status == "owned-draft" {
			if drafted || envelope.JournalClosed || envelope.Token != params.Token || len(envelope.Journal) > 100000 {
				return nil, fmt.Errorf("duplicate or invalid original draft")
			}
			telemetry["draftAtMs"] = time.Since(started).Seconds() * 1000
			drafted = true
			requireDraft = true
			fallback := envelope.DraftError != nil || len(envelope.PartialDirectories) != 0
			telemetry["draftRows"] = len(envelope.Journal)
			telemetry["draftError"] = envelope.DraftError
			divergences := []map[string]any{}
			replacements := []governanceOwnedRow{}
			for _, cell := range envelope.Journal {
				r, row := cell.Requirement, cell.Observation
				key := governanceOwnedKey(r)
				if r.ID == "" || r.ID != row.ID || !filepath.IsAbs(r.Path) || filepath.Clean(r.Path) != r.Path || r.FollowLinks && r.Kind != "metadata" {
					return nil, fmt.Errorf("invalid native draft operation")
				}
				if _, seen := draftRows[key]; seen {
					return nil, fmt.Errorf("duplicate native draft operation")
				}
				if r.Kind != "metadata" && r.Kind != "canonicalize" && r.Kind != "read-bytes" && r.Kind != "directory" {
					return nil, fmt.Errorf("unknown native draft operation")
				}
				draftRows[key] = row
				pair := governanceOwnedPhysicalPair{Native: cell}
				if r.Kind == "directory" || row.Status == "error" {
					actual := governanceObserveProbe(key)
					actual.ID = r.ID
					pair.Go = &governanceOwnedRow{r, actual}
					if !governanceOwnedBridgeEqual(r.Kind, row, actual) {
						divergences = append(divergences, map[string]any{"requirement": r, "native": row, "go": actual})
						fallback = true
					}
					goRows[key] = actual
					replacements = append(replacements, governanceOwnedRow{r, actual})
				} else if row.Status != "known" || row.Error != nil || row.Value == nil {
					return nil, fmt.Errorf("invalid native draft value")
				}
				producerTrace = append(producerTrace, pair)
			}
			telemetry["bridges"] = len(replacements)
			telemetry["fallback"] = fallback
			telemetry["divergences"] = divergences
			if fallback {
				requireDraft = false
				replacements = []governanceOwnedRow{}
				goRows = map[governanceProbeKey]governanceProbeObservation{}
				draftRows = map[governanceProbeKey]governanceProbeObservation{}
				producerTrace = nil
			}
			if err = write(map[string]any{"operation": "reconcile", "owner": owner, "rows": replacements, "fallback": fallback}); err != nil {
				return nil, err
			}
			telemetry["joinedAtMs"] = time.Since(started).Seconds() * 1000
			continue
		}
		if envelope.Status == "go-probe" {
			r := envelope.Requirement
			if r.ID == "" || !filepath.IsAbs(r.Path) || filepath.Clean(r.Path) != r.Path || r.FollowLinks && r.Kind != "metadata" {
				return nil, fmt.Errorf("invalid private original IO requirement")
			}
			if r.Kind != "directory" && envelope.AttemptErrno == nil {
				return nil, fmt.Errorf("known operation cannot be loaned from Go")
			}
			row := governanceObserveProbe(governanceOwnedKey(r))
			if row.Status == "unsupported" {
				return nil, fmt.Errorf("original Go IO has an authority gap")
			}
			if envelope.AttemptErrno != nil {
				if row.Status != "error" || row.Error == nil {
					return map[string]any{"status": "retry"}, nil
				}
				errno, known := governanceOwnedErrno(row.Error.Code)
				if !known {
					return nil, fmt.Errorf("native IO error has no exact original Go errno bridge")
				}
				if errno != *envelope.AttemptErrno {
					return map[string]any{"status": "retry"}, nil
				}
			}
			key := governanceOwnedKey(r)
			row.ID = r.ID
			if old, seen := goRows[key]; seen && governanceProbeFingerprint(old) != governanceProbeFingerprint(row) {
				return map[string]any{"status": "retry"}, nil
			}
			goRows[key] = row
			if err = write(map[string]any{"operation": "probe-result", "owner": owner, "row": governanceOwnedRow{r, row}}); err != nil {
				return nil, err
			}
			continue
		}
		if envelope.Status != "owned-generic" || !envelope.JournalClosed || envelope.Token != params.Token || len(envelope.Journal) > 100000 {
			return nil, fmt.Errorf("owned worker lacks complete journal publication")
		}
		telemetry["closedAtMs"] = time.Since(started).Seconds() * 1000
		if envelope.JournalRetained {
			if !requireDraft || len(envelope.Journal) != 0 || envelope.JournalCount != len(draftRows) {
				return nil, fmt.Errorf("invalid retained private journal closure")
			}
			// These rows came only from this actor's current draft channel and
			// actual independent Go operations. Client params can never supply
			// them. Original replay forbids new IO before this retained close.
			envelope.Journal = make([]governanceOwnedRow, 0, len(draftRows))
			for key, native := range draftRows {
				row := native
				if actual, joined := goRows[key]; joined {
					row = actual
				}
				envelope.Journal = append(envelope.Journal, governanceOwnedRow{governanceProbeRequest{ID: row.ID, Kind: key.Kind, Path: key.Path, FollowLinks: key.FollowLinks}, row})
			}
		} else if requireDraft {
			return nil, fmt.Errorf("batch worker repeated rather than retained its owned journal")
		}

		for _, cell := range envelope.Journal {
			r, row := cell.Requirement, cell.Observation
			key := governanceOwnedKey(r)
			if r.ID == "" || r.ID != row.ID || !filepath.IsAbs(r.Path) || filepath.Clean(r.Path) != r.Path || r.FollowLinks && r.Kind != "metadata" {
				return nil, fmt.Errorf("invalid owned journal operation identity")
			}
			if _, duplicate := pending[key]; duplicate {
				return nil, fmt.Errorf("duplicate owned journal operation")
			}
			if original, drafted := draftRows[key]; drafted {
				if _, bridged := goRows[key]; !bridged && governanceProbeFingerprint(original) != governanceProbeFingerprint(row) {
					return nil, fmt.Errorf("owned producer changed its native draft")
				}
				delete(draftRows, key)
			} else if requireDraft {
				return nil, fmt.Errorf("owned producer invented post-draft operation")
			}
			if expected, bridged := goRows[key]; bridged {
				if governanceProbeFingerprint(row) != governanceProbeFingerprint(expected) {
					return nil, fmt.Errorf("owned worker changed original Go result")
				}
				delete(goRows, key)
			} else {
				if row.Status != "known" || row.Error != nil || row.Value == nil || r.Kind == "directory" {
					return nil, fmt.Errorf("unbridged native result cannot enter actual capture")
				}
				if r.Kind != "metadata" && r.Kind != "read-bytes" && r.Kind != "canonicalize" {
					return nil, fmt.Errorf("unqualified native operation")
				}
			}
			fingerprint := governanceProbeFingerprint(row)
			if previous, observed := capture.probeObservations[key]; observed && previous != fingerprint {
				capture.probeInconsistent = true
				return map[string]any{"status": "retry"}, nil
			}
			if r.Kind == "read-bytes" && row.Status == "known" {
				value, ok := row.Value.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid native byte result")
				}
				encoded, ok := value["bytesBase64"].(string)
				if !ok {
					return nil, fmt.Errorf("invalid native byte transport")
				}
				data, decodeError := base64.StdEncoding.DecodeString(encoded)
				if decodeError != nil || len(data) > 32*1024*1024 {
					return nil, fmt.Errorf("native bytes outside original admission bound")
				}
				pendingBytes[r.Path] = data
				if old, read := capture.byteCells[r.Path]; read && (old.err != nil || !bytes.Equal(old.bytes, data)) {
					capture.probeInconsistent = true
					return map[string]any{"status": "retry"}, nil
				}
			}
			pending[key] = row
		}
		if len(draftRows) != 0 {
			return nil, fmt.Errorf("owned journal omitted native draft operation")
		}
		if len(goRows) != 0 {
			return nil, fmt.Errorf("owned journal omitted original Go operation")
		}
		if producer.closed.Load() || session.productsSession != state || state.Token != params.Token {
			return map[string]any{"status": "retry"}, nil
		}
		if !producer.artifact.verify() {
			return map[string]any{"status": "retry"}, nil
		}
		// Admission is atomic: no producer row reaches the actual maps until a full
		// validated close and exact overlap checks have succeeded.
		if capture.probeObservations == nil {
			capture.probeObservations = map[governanceProbeKey]string{}
		}
		capture.ownedGenericArtifact = producer.artifact
		capture.ownedGenericOwner = &owner
		capture.ownedGenericProducerTrace = producerTrace
		capture.ownedGenericRows = pending
		capture.ownedGenericBytes = pendingBytes
		for key, row := range pending {
			capture.probeObservations[key] = governanceProbeFingerprint(row)
		}
		telemetry["admittedAtMs"] = time.Since(started).Seconds() * 1000
		completed = true
		return map[string]any{"status": "owned-generic", "token": params.Token, "instance": producer.instance, "epoch": producer.epoch, "membership": envelope.Membership, "lint": envelope.Lint, "inputCertificate": state.currentCertificate(), "ownedTelemetry": telemetry}, nil
	}
	return nil, fmt.Errorf("owned worker operation budget exhausted")
}

func (c *governanceCapture) ownedReadMatches(path string, data []byte, err error) bool {
	if owned, seen := c.ownedGenericBytes[path]; seen {
		return err == nil && bytes.Equal(owned, data)
	}
	return true
}

// Both physical outcomes are retained. Native error messages are never rewritten
// or claimed to equal Go messages; the final original walker consumes the exact
// independently observed Go row in a replay that cannot perform additional IO.
type governanceOwnedPhysicalPair struct {
	Native governanceOwnedRow
	Go     *governanceOwnedRow
}

func governanceOwnedBridgeEqual(kind string, native, actual governanceProbeObservation) bool {
	if native.Status != actual.Status {
		return false
	}
	if native.Status == "known" {
		return governanceProbeFingerprint(native) == governanceProbeFingerprint(actual)
	}
	if native.Status != "error" || native.Error == nil || actual.Error == nil || native.Error.Message == "" || actual.Error.Message == "" || native.Error.Kind != actual.Error.Kind {
		return false
	}
	nativeErrno, err := strconv.Atoi(native.Error.Code)
	if err != nil {
		return false
	}
	actualErrno, known := governanceOwnedErrno(actual.Error.Code)
	return known && nativeErrno == actualErrno
}
