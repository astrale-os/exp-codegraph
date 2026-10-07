package main

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

const ownedPublicationHelperStore = "ASTRALE_OWNED_PUBLICATION_HELPER_STORE"

type ownedPublicationObservation struct {
	Phase        string `json:"phase"`
	PID          int    `json:"pid"`
	Path         string `json:"path,omitempty"`
	Device       uint64 `json:"device,omitempty"`
	Inode        uint64 `json:"inode,omitempty"`
	FileMode     uint32 `json:"fileMode,omitempty"`
	PayloadMode  uint32 `json:"payloadMode,omitempty"`
	EnvelopeMode uint32 `json:"envelopeMode,omitempty"`
}

// FileInfo.Sys carries the actual opened inode on Unix. Reflection keeps the
// test source portable for Windows Go-only builds; an admitted fixture without
// comparable physical inode fields fails rather than fabricating identity.
func ownedPublicationIdentity(t *testing.T, info os.FileInfo) (uint64, uint64) {
	t.Helper()
	stat := reflect.ValueOf(info.Sys())
	for stat.IsValid() && stat.Kind() == reflect.Pointer && !stat.IsNil() {
		stat = stat.Elem()
	}
	if !stat.IsValid() || stat.Kind() != reflect.Struct {
		t.Fatal("owned publication has no physical inode identity")
	}
	integer := func(name string) uint64 {
		field := stat.FieldByName(name)
		if field.IsValid() && field.CanUint() {
			return field.Uint()
		}
		if field.IsValid() && field.CanInt() {
			return uint64(field.Int())
		}
		t.Fatalf("owned publication has no physical %s field", name)
		return 0
	}
	return integer("Dev"), integer("Ino")
}

// Parent-controlled pipes establish ordering, without scheduling sleeps. Each
// independent process retains its acquired lease until all peers have acquired
// and verified theirs; the parent then permits a natural exit.
func TestOwnedPublicationHelper(t *testing.T) {
	store := os.Getenv(ownedPublicationHelperStore)
	if store == "" {
		return
	}
	raw := ownedArtifactTestBytes(t)
	emit := func(observation ownedPublicationObservation) {
		observation.PID = os.Getpid()
		if err := json.NewEncoder(os.Stdout).Encode(observation); err != nil {
			t.Fatal(err)
		}
	}
	gate := func(want byte) {
		var token [1]byte
		if _, err := io.ReadFull(os.Stdin, token[:]); err != nil {
			t.Fatal(err)
		}
		if token[0] != want {
			t.Fatalf("publication barrier %q, want %q", token[0], want)
		}
	}
	emit(ownedPublicationObservation{Phase: "ready"})
	gate('A')
	lease, err := governanceAcquireOwnedArtifact(raw, store)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.close()
	held, err := lease.file.Stat()
	if err != nil || !os.SameFile(held, lease.fileInfo) {
		t.Fatalf("held publication FD differs from its admitted inode: %v", err)
	}
	device, inode := ownedPublicationIdentity(t, held)
	observation := ownedPublicationObservation{
		Phase: "acquired", Path: lease.path, Device: device, Inode: inode,
		FileMode:     uint32(held.Mode().Perm()),
		PayloadMode:  uint32(lease.directoryInfo.Mode().Perm()),
		EnvelopeMode: uint32(lease.envelopeInfo.Mode().Perm()),
	}
	emit(observation)
	gate('V')
	if !lease.verify() {
		t.Fatal("peer publication changed an already acquired immutable lease")
	}
	observation.Phase = "verified"
	emit(observation)
	gate('X')
	if !lease.verify() {
		t.Fatal("lease changed before natural helper exit")
	}
}

func TestOwnedArtifactSubprocessColdPublication(t *testing.T) {
	ownedArtifactTestBytes(t)
	owner := ownedArtifactTestStore(t)
	if err := os.MkdirAll(owner, 0700); err != nil {
		t.Fatal(err)
	}
	store := filepath.Join(owner, "artifacts")
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	type helper struct {
		cmd    *exec.Cmd
		input  io.WriteCloser
		output *bufio.Reader
		waited bool
	}
	var helpers []*helper
	t.Cleanup(func() {
		// Only failure cleanup needs a signal. Successful helpers have already
		// exited naturally and been reaped by the explicit Wait below.
		for _, child := range helpers {
			if !child.waited {
				child.input.Close()
				child.cmd.Process.Kill()
				child.cmd.Wait()
				child.waited = true
			}
		}
	})
	for i := 0; i < 4; i++ {
		cmd := exec.Command(executable, "-test.run=^TestOwnedPublicationHelper$", "-owned-artifact="+*ownedArtifactFixture)
		cmd.Env = append(os.Environ(), ownedPublicationHelperStore+"="+store)
		cmd.Stderr = os.Stderr
		input, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		output, err := cmd.StdoutPipe()
		if err != nil {
			input.Close()
			t.Fatal(err)
		}
		if err := cmd.Start(); err != nil {
			input.Close()
			output.Close()
			t.Fatal(err)
		}
		helpers = append(helpers, &helper{cmd: cmd, input: input, output: bufio.NewReader(output)})
	}
	read := func(child *helper, phase string) ownedPublicationObservation {
		line, err := child.output.ReadBytes('\n')
		if err != nil {
			t.Fatal(err)
		}
		var observation ownedPublicationObservation
		if err := json.Unmarshal(line, &observation); err != nil {
			t.Fatalf("publication helper JSON: %v; line=%q", err, line)
		}
		if observation.Phase != phase || observation.PID != child.cmd.Process.Pid {
			t.Fatalf("publication helper identity/phase differs: %+v", observation)
		}
		return observation
	}
	release := func(token byte) {
		for _, child := range helpers {
			if _, err := child.input.Write([]byte{token}); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, child := range helpers {
		read(child, "ready")
	}
	envelope := filepath.Join(store, "envelope-v2-"+governanceOwnedArtifactSHA)
	if _, err := os.Lstat(envelope); !os.IsNotExist(err) {
		t.Fatalf("cold publication already has a canonical envelope: %v", err)
	}
	release('A')
	var observations []ownedPublicationObservation
	for _, child := range helpers {
		observations = append(observations, read(child, "acquired"))
	}
	path := filepath.Join(envelope, "sealed", governanceOwnedArtifactName)
	current, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	if !current.Mode().IsRegular() || current.Mode().Perm() != 0500 {
		t.Fatal("canonical worker is not a sealed regular file")
	}
	device, inode := ownedPublicationIdentity(t, current)
	for _, observation := range observations {
		if observation.Path != path || observation.Device != device || observation.Inode != inode || observation.FileMode != 0500 || observation.PayloadMode != 0500 || observation.EnvelopeMode != 0700 {
			t.Fatalf("independent publications did not join one sealed inode: %+v", observation)
		}
	}
	for _, entry := range []struct {
		path string
		mode os.FileMode
	}{{filepath.Dir(path), 0500}, {filepath.Dir(filepath.Dir(path)), 0700}, {store, 0700}, {filepath.Dir(store), 0700}} {
		info, err := os.Lstat(entry.path)
		if err != nil || !info.IsDir() || info.Mode().Perm() != entry.mode {
			t.Fatalf("published ancestor %q differs: info=%v err=%v", entry.path, info, err)
		}
	}
	release('V')
	for i, child := range helpers {
		verified := read(child, "verified")
		verified.Phase = "acquired"
		if verified != observations[i] {
			t.Fatal("physical lease identity changed at the shared verification barrier")
		}
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(current, after) {
		t.Fatal("canonical worker changed while all independent leases were held")
	}
	release('X')
	for _, child := range helpers {
		child.input.Close()
		err := child.cmd.Wait()
		child.waited = true
		if err != nil || !child.cmd.ProcessState.Success() {
			t.Fatalf("publication helper did not exit naturally: %v", err)
		}
	}
	t.Logf("four independent publishers joined device=%d inode=%d; all helpers exited naturally", device, inode)
}
