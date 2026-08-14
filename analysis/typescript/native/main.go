// TypeSpec V2's native TypeScript analyzer is deliberately a headless JSONL
// process. TypeScript-Go compiler objects remain resident and private; callers
// receive versioned, portable facts and atomic content-addressed generations.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() { os.Exit(run(os.Args[1:])) }

func run(arguments []string) int {
	if len(arguments) == 0 {
		fmt.Fprintln(os.Stderr, "astrale-typespec-v2-analysis: command required")
		return 2
	}
	switch arguments[0] {
	case "version", "-v", "--version":
		fmt.Fprintf(os.Stdout, "astrale-typespec-v2-analysis %s protocol=%d\n", producerVersion, protocolVersion)
		return 0
	case "serve":
		return runServe(arguments[1:])
	case "check", "build":
		return runCheck(arguments[1:])
	default:
		fmt.Fprintf(os.Stderr, "astrale-typespec-v2-analysis: unknown command %q\n", arguments[0])
		return 2
	}
}

type commandOptions struct {
	cwd, config, universe, capabilitiesJSON, modulesJSON string
	maximumFrameBytes, maximumTransactionBytes           int
}

func parseOptions(command string, arguments []string) (commandOptions, error) {
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	cwd := flags.String("cwd", "", "absolute project root")
	config := flags.String("tsconfig", "tsconfig.json", "TypeScript project configuration")
	universe := flags.String("universe", "", "portable project universe identity")
	capabilities := flags.String("capabilities-json", "[]", "sorted native capability JSON")
	modules := flags.String("modules-json", "[]", "portable module boundary JSON")
	maximumFrameBytes := flags.Int("maximum-frame-bytes", 64*1024*1024, "maximum JSONL frame bytes")
	maximumTransactionBytes := flags.Int("maximum-transaction-bytes", 256*1024*1024, "maximum assembled transaction bytes")
	_ = flags.String("plugins-json", "", "ttsc compatibility")
	_ = flags.Bool("emit", false, "ttsc compatibility")
	_ = flags.Bool("noEmit", false, "ttsc compatibility")
	_ = flags.Bool("quiet", false, "ttsc compatibility")
	_ = flags.Bool("verbose", false, "ttsc compatibility")
	_ = flags.String("outDir", "", "ttsc compatibility")
	if err := flags.Parse(arguments); err != nil {
		return commandOptions{}, err
	}
	if *cwd == "" {
		value, err := os.Getwd()
		if err != nil {
			return commandOptions{}, err
		}
		*cwd = value
	}
	if *universe == "" {
		*universe = deriveID("project-universe", "typescript.native.default", map[string]any{"config": *config})
	}
	if *maximumFrameBytes < 1024 || *maximumTransactionBytes < 1024 {
		return commandOptions{}, fmt.Errorf("native frame and transaction limits must be at least 1024 bytes")
	}
	return commandOptions{
		cwd: *cwd, config: *config, universe: *universe,
		capabilitiesJSON: *capabilities, modulesJSON: *modules,
		maximumFrameBytes: *maximumFrameBytes, maximumTransactionBytes: *maximumTransactionBytes,
	}, nil
}

func decodeCapabilities(value string) ([]string, error) {
	var capabilities []string
	if err := json.Unmarshal([]byte(value), &capabilities); err != nil {
		return nil, err
	}
	return capabilities, nil
}

func decodeModules(value string) ([]moduleBoundary, error) {
	var modules []moduleBoundary
	if err := json.Unmarshal([]byte(value), &modules); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, module := range modules {
		if module.ID == "" || module.Name == "" || seen[module.ID] {
			return nil, fmt.Errorf("module boundaries require unique identities and names")
		}
		seen[module.ID] = true
		for _, path := range append([]string{module.Project, module.Root, module.Entrypoint}, append(append(module.Facades, module.Aliases...), module.Internals...)...) {
			if path == "" || filepath.IsAbs(path) || strings.Contains(path, "\\") || strings.Contains(path, "\x00") {
				return nil, fmt.Errorf("module %s contains an invalid portable path", module.ID)
			}
		}
	}
	sort.Slice(modules, func(i, j int) bool { return modules[i].ID < modules[j].ID })
	return modules, nil
}

func runCheck(arguments []string) int {
	options, err := parseOptions("check", arguments)
	if err != nil {
		return 2
	}
	capabilities, err := decodeCapabilities(options.capabilitiesJSON)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	modules, err := decodeModules(options.modulesJSON)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	analyzer, err := newAnalyzer(options.cwd, options.config, options.universe, capabilities, modules)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	defer analyzer.close()
	if _, _, err := analyzer.refresh(request{ID: 1, Kind: "refresh"}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return 0
}

func runServe(arguments []string) int {
	options, err := parseOptions("serve", arguments)
	if err != nil {
		return 2
	}
	capabilities, err := decodeCapabilities(options.capabilitiesJSON)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	modules, err := decodeModules(options.modulesJSON)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	analyzer, err := newAnalyzer(options.cwd, options.config, options.universe, capabilities, modules)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	defer analyzer.close()

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), options.maximumFrameBytes)
	output := bufio.NewWriterSize(os.Stdout, 64*1024)
	flush := func() error {
		if err := output.Flush(); err != nil {
			return fmt.Errorf("flush native protocol output: %w", err)
		}
		return nil
	}
	for scanner.Scan() {
		var input request
		if err := decodeRequest(scanner.Bytes(), &input); err != nil {
			if writeErr := writeFrame(output, errorResponse(1, "FRAME_INVALID", err), options.maximumFrameBytes); writeErr != nil {
				fmt.Fprintln(os.Stderr, writeErr)
				return 2
			}
			if err := flush(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			continue
		}
		if input.Kind == "dispose" {
			return 0
		}
		if input.ID < 1 || input.Kind != "refresh" {
			if err := writeFrame(output, errorResponse(input.ID, "REQUEST_INVALID", errors.New("expected a positive refresh request")), options.maximumFrameBytes); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			if err := flush(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			continue
		}
		transaction, unchanged, err := analyzer.refresh(input)
		if err != nil {
			code := "ANALYSIS_FAILED"
			var native nativeError
			if errors.As(err, &native) {
				code = native.code
			}
			if writeErr := writeFrame(output, errorResponse(input.ID, code, err), options.maximumFrameBytes); writeErr != nil {
				fmt.Fprintln(os.Stderr, writeErr)
				return 2
			}
			if err := flush(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			continue
		}
		if unchanged != "" {
			if err := writeFrame(output, response{
				ID: input.ID, ProtocolVersion: protocolVersion, Kind: "unchanged", Generation: unchanged,
			}, options.maximumFrameBytes); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			if err := flush(); err != nil {
				fmt.Fprintln(os.Stderr, err)
				return 2
			}
			continue
		}
		if err := writeTransactionResponse(
			output,
			input.ID,
			transaction,
			options.maximumFrameBytes,
			options.maximumTransactionBytes,
		); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
		if err := flush(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 2
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	return 0
}

func decodeRequest(encoded []byte, target *request) error {
	return json.Unmarshal(encoded, target)
}

func errorResponse(id int, code string, err error) response {
	if id < 1 {
		id = 1
	}
	return response{
		ID: id, ProtocolVersion: protocolVersion, Kind: "error",
		Code: code, Message: err.Error(), Retryable: false,
	}
}
