package observabledecision

// Each core owns one immutable compiler/AST authority. Proof cells retain only
// complete scalar results, never caller budget state or mutable interpreter
// environments. A new captured authority always creates a new core.
type nativeEffectProofKey struct{ kind, symbol, localOwner string }

func ownNativeEffectProof(proof NativeEffectProof) NativeEffectProof {
	if proof.Reads != nil {
		proof.Reads = append([]SemanticRead{}, proof.Reads...)
	}
	return proof
}
func (core *NativeEffectCore) Proof(kind, symbol, localOwner string) NativeEffectProof {
	if !core.immutableProofOwner {
		return core.computeProof(kind, symbol, localOwner)
	}
	key := nativeEffectProofKey{kind, symbol, localOwner}
	if proof, ok := core.proofCells[key]; ok {
		return ownNativeEffectProof(proof)
	}
	proof := core.computeProof(kind, symbol, localOwner)
	// Missing authority is not a proved negative observation and may be resolved
	// by the caller's continuation. It must never become a ready cell.
	if proof.Known {
		if core.proofCells == nil {
			core.proofCells = map[nativeEffectProofKey]NativeEffectProof{}
		}
		core.proofCells[key] = ownNativeEffectProof(proof)
	}
	return proof
}

// NewCapturedNativeEffectCore belongs exclusively to a native immutable capture
// owner. Every callback and returned read vector must describe that capture for
// its entire lifetime; it cannot cross capture release or continuation mutation.
// The ordinary constructor retains support for dynamic exploratory authorities.
func NewCapturedNativeEffectCore(files []CapturedFile, authority NativeEffectAuthority) *NativeEffectCore {
	return NewCapturedNativeEffectCoreWithSyntax(files, authority, NewSourceSyntaxOwner())
}

// NewCapturedNativeEffectCoreWithSyntax borrows only immutable parser indexes;
// every semantic authority and proof cell still belongs to this fresh capture.
func NewCapturedNativeEffectCoreWithSyntax(files []CapturedFile, authority NativeEffectAuthority, syntax *SourceSyntaxOwner) *NativeEffectCore {
	if syntax == nil {
		syntax = NewSourceSyntaxOwner()
	}
	core := newNativeEffectCore(files, authority, syntax)
	core.immutableProofOwner = true
	core.authority.MembershipReads = append([]SemanticRead(nil), authority.MembershipReads...)
	return core
}
