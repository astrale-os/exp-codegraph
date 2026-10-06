package main

// Disposable maps expose the old oracle shape only in tests. Production owns
// one operation index; these helpers never install a map or expected fact.
func compilerTestRawReads(fs *compilerInputFS) map[string]compilerRawRead {
	rows := map[string]compilerRawRead{}
	for key := range fs.operations {
		if key.kind == inputRead {
			if value, ready := fs.rawReadLocked(key.path); ready {
				rows[key.path] = value
			}
		}
	}
	return rows
}
func compilerTestObservations(fs *compilerInputFS) map[compilerInputKey]string {
	rows := map[compilerInputKey]string{}
	for key, cell := range fs.operations {
		if cell.observed {
			rows[key] = cell.observation
		}
	}
	return rows
}

// Hand-built malformed/raw-only receipts are oracle fixtures, not a live
// compiler reader observed before its operation returns. This helper installs
// an explicitly completed raw physical fact without claiming semantic use.
func (fs *compilerInputFS) rememberRaw(path string, value compilerRawRead) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	cell := fs.operationLocked(compilerInputKey{path, inputRead})
	if before, ready := fs.rawReadLocked(path); ready && fs.singleCapture {
		if before != value {
			fs.inconsistent = true
		}
		return
	}
	cell.value = compilerCapturedValue[compilerRawRead]{value}
	if fs.singleCapture {
		fs.prefix.reads = append(fs.prefix.reads, compilerRawInput{path, value})
	}
}
