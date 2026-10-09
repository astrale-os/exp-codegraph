# Third-party notices

The native Codegraph analyzer is built with and incorporates components from the following projects:

- `ttsc`, copyright Jeongho Nam and contributors, licensed under the MIT License.
- TypeScript-Go, copyright Microsoft Corporation, licensed under the MIT License.
- The Go toolchain and standard library, copyright The Go Authors, licensed under the BSD 3-Clause License.

The corresponding source revisions are recorded in each Codegraph native release manifest. The
complete license texts remain available in the upstream source distributions and release inputs.

## Captured Oxlint worker — source and notice scope

The separately packaged `codegraph-oxlint` worker uses Oxc 1.81.0 at commit
`0b4e2e67f4193e7ebfcc64982275eb583ae82c83`, the maintained `ignore`
0.4.33 fork, and Rust 1.98.0. The source, public crate archive and cumulative
patch are pinned by `analysis/oxlint/native-source.json`.

The Oxc MIT and ignore MIT/Unlicense/COPYING texts are included in the
component notices below. The local capture-authority additions are maintained
Codegraph project code; the distributed project license is supplied as `LICENSE`.
The dependency set is a conservative union for the four UNIX worker targets:
`aarch64-apple-darwin`, `x86_64-apple-darwin`,
`aarch64-unknown-linux-gnu`, and `x86_64-unknown-linux-gnu`.
It includes normal/build dependencies and the captured example's runtime-used
dependency roots, with separate notices from the pinned Rust standard-library
distribution. This is not a claim that every build dependency is linked into
the executable. It does not describe a Windows worker capability or the
unrelated Oxc workspace. Repeated texts within each notice set are referenced
by identifier; each copyright and package-specific notice remains present.

## Captured Oxlint Rust dependency notices

This is the conservative normal/build dependency closure for four Unix targets, including the two runtime-used captured-example roots. It is not final-link symbol attribution or the whole Oxc workspace. Rust standard-library notices are supplied separately.

Each component below points to its complete preserved notice text. Identical bytes are included once; copyrights and package-specific notices remain distinct.

- `adler2 2.0.1` — declared `0BSD OR MIT OR Apache-2.0`; RUST-DEPENDENCY-055, RUST-DEPENDENCY-059, RUST-DEPENDENCY-023.
- `aho-corasick 1.1.4` — declared `Unlicense OR MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-011, RUST-DEPENDENCY-053.
- `allocator-api2 0.2.21` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-019, RUST-DEPENDENCY-028.
- `arrayvec 0.7.8` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-034.
- `autocfg 1.5.1` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-025.
- `base64 0.23.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-066.
- `bitflags 2.13.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `bstr 1.12.3` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-045, RUST-DEPENDENCY-064, RUST-DEPENDENCY-046.
- `bytecount 0.6.9` — declared `Apache-2.0/MIT`; RUST-DEPENDENCY-070, RUST-DEPENDENCY-063.
- `castaway 0.2.4` — declared `MIT`; RUST-DEPENDENCY-089.
- `cfg-if 1.0.4` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-030.
- `cobs 0.3.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-072, RUST-DEPENDENCY-084.
- `compact_str 0.10.0` — declared `MIT`; RUST-DEPENDENCY-009.
- `constcat 0.6.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-073, RUST-DEPENDENCY-091.
- `convert_case 0.12.0` — declared `MIT`; RUST-DEPENDENCY-067.
- `cow-utils 0.1.3` — declared `MIT`; RUST-DEPENDENCY-038.
- `crossbeam-deque 0.8.6` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-036.
- `crossbeam-epoch 0.9.20` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-036.
- `crossbeam-utils 0.8.21` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-036.
- `dashmap 6.2.1` — declared `MIT`; RUST-DEPENDENCY-013.
- `displaydoc 0.2.6` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-023.
- `dragonbox_ecma 0.1.12` — declared `Apache-2.0 WITH LLVM-exception OR BSL-1.0`; RUST-DEPENDENCY-042, RUST-DEPENDENCY-077.
- `dyn-clone 1.0.20` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `either 1.16.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-050.
- `equivalent 1.0.2` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-048.
- `errno 0.3.14` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-056.
- `fast-glob 1.1.1` — declared `MIT`; RUST-DEPENDENCY-054.
- `fastrand 2.4.1` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-023.
- `fixedbitset 0.5.7` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-079.
- `float-cmp 0.10.0` — declared `MIT`; RUST-DEPENDENCY-032.
- `foldhash 0.1.5` — declared `Zlib`; RUST-DEPENDENCY-068.
- `foldhash 0.2.0` — declared `Zlib`; RUST-DEPENDENCY-068.
- `form_urlencoded 1.2.2` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-018.
- `globset 0.4.18` — declared `Unlicense OR MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-011, RUST-DEPENDENCY-053.
- `halfbrown 0.4.0` — declared `Apache-2.0/MIT`; RUST-DEPENDENCY-081, RUST-DEPENDENCY-001.
- `hashbrown 0.14.5` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-094.
- `hashbrown 0.15.5` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-094.
- `hashbrown 0.16.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-094.
- `hashbrown 0.17.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-094.
- `icu_collections 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_locale_core 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_normalizer 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_normalizer_data 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_properties 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_properties_data 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `icu_provider 2.2.0` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `idna 1.1.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-069.
- `idna_adapter 1.2.2` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-060.
- `ignore 0.4.33` — declared `Unlicense OR MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-011, RUST-DEPENDENCY-053.
- `indexmap 2.14.1` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-086.
- `itertools 0.15.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-050.
- `itoa 1.0.18` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `javascript-globals 2.0.0` — declared `MIT`; RUST-DEPENDENCY-039.
- `json-strip-comments 3.1.2` — declared `Apache-2.0`; RUST-DEPENDENCY-073.
- `language-tags 0.3.2` — declared `MIT/Apache-2.0`; RUST-DEPENDENCY-083.
- `lazy-regex 3.6.1` — declared `MIT`; RUST-DEPENDENCY-057.
- `lazy-regex-proc_macros 3.6.1` — declared `MIT`; RUST-DEPENDENCY-057.
- `libc 0.2.186` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-012.
- `linux-raw-sys 0.12.1` — declared `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`; RUST-DEPENDENCY-027, RUST-DEPENDENCY-064, RUST-DEPENDENCY-024, RUST-DEPENDENCY-023.
- `litemap 0.8.2` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `lock_api 0.4.14` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-076.
- `log 0.4.33` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `memchr 2.8.3` — declared `Unlicense OR MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-011, RUST-DEPENDENCY-053.
- `miniz_oxide 0.9.1` — declared `MIT OR Zlib OR Apache-2.0`; RUST-DEPENDENCY-033, RUST-DEPENDENCY-010, RUST-DEPENDENCY-051, RUST-DEPENDENCY-005.
- `nodejs-built-in-modules 1.0.0` — declared `MIT`; RUST-DEPENDENCY-017.
- `nonmax 0.5.5` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-074, RUST-DEPENDENCY-065.
- `num-bigint 0.5.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `num-integer 0.1.46` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `num-traits 0.2.19` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `once_cell 1.21.4` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-023.
- `oxc-browserslist 5.0.1` — declared `MIT`; RUST-DEPENDENCY-047.
- `oxc-schemars 0.9.1` — declared `MIT`; RUST-DEPENDENCY-016.
- `oxc_allocator 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_ast 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_ast_macros 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_ast_visit 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_cfg 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_codegen 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_compat 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_config 0.0.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_data_structures 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_diagnostics 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_ecmascript 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_estree 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_estree_tokens 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_index 5.0.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_jsdoc 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_linter 1.81.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_macros 0.0.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_parser 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_react_compiler 0.143.0` — declared `MIT`; RUST-DEPENDENCY-062, RUST-DEPENDENCY-092.
- `oxc_regular_expression 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_resolver 11.24.3` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_schemars_derive 0.8.26` — declared `MIT`; RUST-DEPENDENCY-016.
- `oxc_semantic 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_span 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_str 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxc_syntax 0.148.0` — declared `MIT`; RUST-DEPENDENCY-062.
- `oxlint-capture-authority 0.0.0` — Codegraph-maintained local project code; no third-party registry license declaration.
- `papaya 0.2.5` — declared `MIT`; RUST-DEPENDENCY-035.
- `parking_lot_core 0.9.12` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-076.
- `percent-encoding 2.3.2` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-069.
- `petgraph 0.8.3` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-050, RUST-DEPENDENCY-041.
- `phf 0.14.0` — declared `MIT`; RUST-DEPENDENCY-006.
- `phf_generator 0.14.0` — declared `MIT`; RUST-DEPENDENCY-006.
- `phf_macros 0.14.0` — declared `MIT`; RUST-DEPENDENCY-006.
- `phf_shared 0.14.0` — declared `MIT`; RUST-DEPENDENCY-006.
- `pin-project-lite 0.2.17` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-010, RUST-DEPENDENCY-023.
- `postcard 1.1.3` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-014.
- `potential_utf 0.1.5` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `proc-macro2 1.0.107` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `quote 1.0.47` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `rayon 1.12.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-004.
- `rayon-core 1.13.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-004.
- `ref-cast 1.0.25` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `ref-cast-impl 1.0.25` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `regex 1.13.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `regex-automata 0.4.18` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044.
- `regex-syntax 0.8.11` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-044, RUST-DEPENDENCY-049.
- `rust-lapper 1.3.0` — declared `MIT`; RUST-DEPENDENCY-021.
- `rustc-hash 2.1.3` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-061, RUST-DEPENDENCY-026.
- `rustix 1.1.4` — declared `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT`; RUST-DEPENDENCY-029, RUST-DEPENDENCY-064, RUST-DEPENDENCY-024, RUST-DEPENDENCY-023.
- `rustversion 1.0.22` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `ryu 1.0.23` — declared `Apache-2.0 OR BSL-1.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-077.
- `same-file 1.0.6` — declared `Unlicense/MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-078, RUST-DEPENDENCY-053.
- `scopeguard 1.2.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-093.
- `seize 0.5.1` — declared `MIT`; RUST-DEPENDENCY-082.
- `self_cell 1.3.0` — declared `Apache-2.0 OR GPL-2.0-only`; RUST-DEPENDENCY-073, RUST-DEPENDENCY-090.
- `seq-macro 0.3.6` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `serde 1.0.229` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `serde_core 1.0.229` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `serde_derive 1.0.229` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `serde_derive_internals 0.29.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `serde_json 1.0.151` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `simd-json 0.18.1` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-081, RUST-DEPENDENCY-001.
- `simdutf8 0.1.5` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-008, RUST-DEPENDENCY-015.
- `siphasher 1.0.3` — declared `MIT/Apache-2.0`; RUST-DEPENDENCY-075.
- `smallvec 1.15.2` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-007.
- `smawk 0.3.3` — declared `MIT`; RUST-DEPENDENCY-002.
- `stable_deref_trait 1.2.1` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-040.
- `static_assertions 1.1.0` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-081, RUST-DEPENDENCY-085.
- `syn 2.0.119` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `syn 3.0.4` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `synstructure 0.13.2` — declared `MIT`; RUST-DEPENDENCY-020.
- `textwrap 0.16.2` — declared `MIT`; RUST-DEPENDENCY-080.
- `thiserror 2.0.20` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `thiserror-impl 2.0.20` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023.
- `tinystr 0.8.3` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `tracing 0.1.44` — declared `MIT`; RUST-DEPENDENCY-058.
- `tracing-attributes 0.1.31` — declared `MIT`; RUST-DEPENDENCY-058.
- `tracing-core 0.1.36` — declared `MIT`; RUST-DEPENDENCY-058, RUST-DEPENDENCY-037.
- `unicode-id-start 1.4.0` — declared `(MIT OR Apache-2.0) AND Unicode-3.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023, RUST-DEPENDENCY-088.
- `unicode-ident 1.0.24` — declared `(MIT OR Apache-2.0) AND Unicode-3.0`; RUST-DEPENDENCY-043, RUST-DEPENDENCY-023, RUST-DEPENDENCY-088.
- `unicode-linebreak 0.1.5` — declared `Apache-2.0`; RUST-DEPENDENCY-073.
- `unicode-segmentation 1.13.3` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-022, RUST-DEPENDENCY-064, RUST-DEPENDENCY-052.
- `unicode-width 0.2.2` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-022, RUST-DEPENDENCY-064, RUST-DEPENDENCY-052.
- `url 2.5.8` — declared `MIT OR Apache-2.0`; RUST-DEPENDENCY-064, RUST-DEPENDENCY-069.
- `utf8_iter 1.0.4` — declared `Apache-2.0 OR MIT`; RUST-DEPENDENCY-071, RUST-DEPENDENCY-081, RUST-DEPENDENCY-031.
- `value-trait 0.12.1` — declared `Apache-2.0/MIT`; RUST-DEPENDENCY-081, RUST-DEPENDENCY-001.
- `walkdir 2.5.0` — declared `Unlicense/MIT`; RUST-DEPENDENCY-003, RUST-DEPENDENCY-011, RUST-DEPENDENCY-053.
- `writeable 0.6.3` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `yoke 0.8.3` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `yoke-derive 0.8.2` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zerofrom 0.1.8` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zerofrom-derive 0.1.7` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zerotrie 0.2.4` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zerovec 0.11.6` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zerovec-derive 0.11.3` — declared `Unicode-3.0`; RUST-DEPENDENCY-087.
- `zmij 1.0.21` — declared `MIT`; RUST-DEPENDENCY-023.

### RUST-DEPENDENCY-001

SHA-256: `002c2696d92b5c8cf956c11072baa58eaf9f6ade995c031ea635c6a1ee342ad1`.

Components: `halfbrown 0.4.0`, `simd-json 0.18.1`, `value-trait 0.12.1`.

```text
MIT License

Copyright (c) [year] [fullname]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-002

SHA-256: `0173035e025d60b1d19197840a93a887f6da8b075c01dd10601fcb6414a0043b`.

Components: `smawk 0.3.3`.

```text
MIT License

Copyright (c) 2017 Martin Geisler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-003

SHA-256: `01c266bced4a434da0051174d6bee16a4c82cf634e2679b6155d40d75012390f`.

Components: `aho-corasick 1.1.4`, `globset 0.4.18`, `ignore 0.4.33`, `memchr 2.8.3`, `same-file 1.0.6`, `walkdir 2.5.0`.

```text
This project is dual-licensed under the Unlicense and MIT licenses.

You may use this code under the terms of either license.
```

### RUST-DEPENDENCY-004

SHA-256: `0621878e61f0d0fda054bcbe02df75192c28bde1ecc8289cbd86aeba2dd72720`.

Components: `rayon 1.12.0`, `rayon-core 1.13.0`.

```text
Copyright (c) 2010 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-005

SHA-256: `0a54e647fe54104658b5e563c04c6f9edf251710e47bce692e0bd990a4ddaa39`.

Components: `miniz_oxide 0.9.1`.

```text
Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC
Copyright (c) 2020 Frommi
Copyright (c) 2017-2024 oyvindln

This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

### RUST-DEPENDENCY-006

SHA-256: `0ab4d106b6faac07fb6a051815fd1b4d862d730895e2d7d7358c2f13565e7a38`.

Components: `phf 0.14.0`, `phf_generator 0.14.0`, `phf_macros 0.14.0`, `phf_shared 0.14.0`.

```text
The MIT License (MIT)

Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-007

SHA-256: `0b28172679e0009b655da42797c03fd163a3379d5cfa67ba1f1655e974a2a1a9`.

Components: `smallvec 1.15.2`.

```text
Copyright (c) 2018 The Servo Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-008

SHA-256: `0cec06e0e55fbc3dc5cee4fca9b607f66cb8f4e4dbcf3b3c013594dd156732e9`.

Components: `simdutf8 0.1.5`.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### RUST-DEPENDENCY-009

SHA-256: `0d52feec79589df30138dad3800323fe5686b764b73347330a2dfef8ac83efe8`.

Components: `compact_str 0.10.0`.

```text
MIT License

Copyright (c) 2021 Parker Timmerman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-010

SHA-256: `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`.

Components: `miniz_oxide 0.9.1`, `pin-project-lite 0.2.17`.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

### RUST-DEPENDENCY-011

SHA-256: `0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f`.

Components: `aho-corasick 1.1.4`, `globset 0.4.18`, `ignore 0.4.33`, `memchr 2.8.3`, `walkdir 2.5.0`.

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### RUST-DEPENDENCY-012

SHA-256: `123a331b5dbf04c30097fa43b8f858bc85df671fe776de498d01f3d6b7c1f69e`.

Components: `libc 0.2.186`.

```text
Copyright (c) The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-013

SHA-256: `16692e8cee4aa06e3913787497eba2d47c42002014136f5da67be6ee640e28a3`.

Components: `dashmap 6.2.1`.

```text
MIT License

Copyright (c) 2019 Acrimon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-014

SHA-256: `177540cad091a40e8071db310bc3b6115c4e329a92a234609b60c154b008a888`.

Components: `postcard 1.1.3`.

```text
Copyright (c) 2019 Anthony James Munns

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-015

SHA-256: `1847e0e0698142ed4347c1441a9fa81c8fbddd44b1d8bbcd5e3647f991759d7f`.

Components: `simdutf8 0.1.5`.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-016

SHA-256: `1954992a2b32e8a2af24a4c11b726902e344c1934b947a77f04d404908f8db30`.

Components: `oxc-schemars 0.9.1`, `oxc_schemars_derive 0.8.26`.

```text
MIT License

Copyright (c) 2019 Graham Esau

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-017

SHA-256: `20538257cfb1812d48164a7d11c0008a66b33c01b4debdfa0ec2a104fe00f028`.

Components: `nodejs-built-in-modules 1.0.0`.

```text
MIT License

Copyright (c) 2024-present VoidZero Inc. & Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-018

SHA-256: `20c7855c364d57ea4c97889a5e8d98470a9952dade37bd9248b9a54431670e5e`.

Components: `form_urlencoded 1.2.2`.

```text
Copyright (c) 2013-2016 The rust-url developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-019

SHA-256: `20fe7b00e904ed690e3b9fd6073784d3fc428141dbd10b81c01fd143d0797f58`.

Components: `allocator-api2 0.2.21`.

```text
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### RUST-DEPENDENCY-020

SHA-256: `219920e865eee70b7dcfc948a86b099e7f4fe2de01bcca2ca9a20c0a033f2b59`.

Components: `synstructure 0.13.2`.

```text
Copyright 2016 Nika Layzell

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-021

SHA-256: `23001fa1fd40fb6e4978e88025714a60a357bf61526fc1fa976ca7995060cf98`.

Components: `rust-lapper 1.3.0`.

```text
MIT License

Copyright (c) 2019 Seth M. Stadick 

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-022

SHA-256: `23860c2a7b5d96b21569afedf033469bab9fe14a1b24a35068b8641c578ce24d`.

Components: `unicode-segmentation 1.13.3`, `unicode-width 0.2.2`.

```text
Licensed under the Apache License, Version 2.0
<LICENSE-APACHE or
http://www.apache.org/licenses/LICENSE-2.0> or the MIT
license <LICENSE-MIT or http://opensource.org/licenses/MIT>,
at your option. All files in the project carrying such
notice may not be copied, modified, or distributed except
according to those terms.
```

### RUST-DEPENDENCY-023

SHA-256: `23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3`.

Components: `adler2 2.0.1`, `displaydoc 0.2.6`, `dyn-clone 1.0.20`, `fastrand 2.4.1`, `itoa 1.0.18`, `linux-raw-sys 0.12.1`, `once_cell 1.21.4`, `pin-project-lite 0.2.17`, `proc-macro2 1.0.107`, `quote 1.0.47`, `ref-cast 1.0.25`, `ref-cast-impl 1.0.25`, `rustix 1.1.4`, `rustversion 1.0.22`, `seq-macro 0.3.6`, `serde 1.0.229`, `serde_core 1.0.229`, `serde_derive 1.0.229`, `serde_derive_internals 0.29.1`, `serde_json 1.0.151`, `syn 2.0.119`, `syn 3.0.4`, `thiserror 2.0.20`, `thiserror-impl 2.0.20`, `unicode-id-start 1.4.0`, `unicode-ident 1.0.24`, `zmij 1.0.21`.

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-024

SHA-256: `268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5`.

Components: `linux-raw-sys 0.12.1`, `rustix 1.1.4`.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


--- LLVM Exceptions to the Apache 2.0 License ----

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.

```

### RUST-DEPENDENCY-025

SHA-256: `27995d58ad5c1145c1a8cd86244ce844886958a35eb2b78c6b772748669999ac`.

Components: `autocfg 1.5.1`.

```text
Copyright (c) 2018 Josh Stone

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-026

SHA-256: `30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652`.

Components: `rustc-hash 2.1.3`.

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-027

SHA-256: `3290ae0fbc9ddb77d2239121d710f0bb9d31b3b4744e6d97fe01e652b4c1870b`.

Components: `linux-raw-sys 0.12.1`.

```text
Short version for non-lawyers:

`linux-raw-sys` is triple-licensed under Apache 2.0 with the LLVM Exception,
Apache 2.0, and MIT terms.


Longer version:

Copyrights in the `linux-raw-sys` project are retained by their contributors.
No copyright assignment is required to contribute to the `linux-raw-sys`
project.

Some files include code derived from Rust's `libstd`; see the comments in
the code for details.

Except as otherwise noted (below and/or in individual files), `linux-raw-sys`
is licensed under:

 - the Apache License, Version 2.0, with the LLVM Exception
   <LICENSE-Apache-2.0_WITH_LLVM-exception> or
   <http://llvm.org/foundation/relicensing/LICENSE.txt>
 - the Apache License, Version 2.0
   <LICENSE-APACHE> or
   <http://www.apache.org/licenses/LICENSE-2.0>,
 - or the MIT license
   <LICENSE-MIT> or
   <http://opensource.org/licenses/MIT>,

at your option.
```

### RUST-DEPENDENCY-028

SHA-256: `36516aefdc84c5d5a1e7485425913a22dbda69eb1930c5e84d6ae4972b5194b9`.

Components: `allocator-api2 0.2.21`.

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-029

SHA-256: `377c2e7c53250cc5905c0b0532d35973392af16ffb9596a41d99d202cf3617c9`.

Components: `rustix 1.1.4`.

```text
Short version for non-lawyers:

`rustix` is triple-licensed under Apache 2.0 with the LLVM Exception,
Apache 2.0, and MIT terms.


Longer version:

Copyrights in the `rustix` project are retained by their contributors.
No copyright assignment is required to contribute to the `rustix`
project.

Some files include code derived from Rust's `libstd`; see the comments in
the code for details.

Except as otherwise noted (below and/or in individual files), `rustix`
is licensed under:

 - the Apache License, Version 2.0, with the LLVM Exception
   <LICENSE-Apache-2.0_WITH_LLVM-exception> or
   <http://llvm.org/foundation/relicensing/LICENSE.txt>
 - the Apache License, Version 2.0
   <LICENSE-APACHE> or
   <http://www.apache.org/licenses/LICENSE-2.0>,
 - or the MIT license
   <LICENSE-MIT> or
   <http://opensource.org/licenses/MIT>,

at your option.
```

### RUST-DEPENDENCY-030

SHA-256: `378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397`.

Components: `cfg-if 1.0.4`.

```text
Copyright (c) 2014 Alex Crichton

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-031

SHA-256: `3fa4ca83dcc9237839b1bdeb2e6d16bdfb5ec0c5ce42b24694d8bbf0dcbef72c`.

Components: `utf8_iter 1.0.4`.

```text
Copyright Mozilla Foundation

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-032

SHA-256: `40be1e77825d7e49485a2e43d89bed29dfff29f8f529e71d3c683656021f0d08`.

Components: `float-cmp 0.10.0`.

```text
Copyright (c) 2014-2020 Optimal Computing (NZ) Ltd

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

### RUST-DEPENDENCY-033

SHA-256: `4108245a1f2df9d4e94df8abed5b4ba0759bb2f9b40a6b939f1be141077ae50b`.

Components: `miniz_oxide 0.9.1`.

```text
MIT License

Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC
Copyright (c) 2017 Frommi
Copyright (c) 2017-2024 oyvindln


Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-034

SHA-256: `4da95ec4ecb65b738d470b7d762894ad9c97da93e6cbfb18b570fc2c96f4b871`.

Components: `arrayvec 0.7.8`.

```text
Copyright (c) Ulrik Sverdrup "bluss" 2015-2023

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-035

SHA-256: `508a77d2e7b51d98adeed32648ad124b7b30241a8e70b2e72c99f92d8e5874d1`.

Components: `papaya 0.2.5`.

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-036

SHA-256: `5734ed989dfca1f625b40281ee9f4530f91b2411ec01cb748223e7eb87e201ab`.

Components: `crossbeam-deque 0.8.6`, `crossbeam-epoch 0.9.20`, `crossbeam-utils 0.8.21`.

```text
The MIT License (MIT)

Copyright (c) 2019 The Crossbeam Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-037

SHA-256: `58545fed1565e42d687aecec6897d35c6d37ccb71479a137c0deb2203e125c79`.

Components: `tracing-core 0.1.36`.

```text
The MIT License (MIT)

Copyright (c) 2014 Mathijs van de Nes

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-038

SHA-256: `59033153d7f67e7b35123798831c5905a725ea84c9face9d91d0ae7e1de6228f`.

Components: `cow-utils 0.1.3`.

```text
MIT License

Copyright (c) 2020 Ingvar Stepanyan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-039

SHA-256: `5c932d88256b4ab958f64a856fa48e8bd1f55bc1d96b8149c65689e0c61789d3`.

Components: `javascript-globals 2.0.0`.

```text
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-040

SHA-256: `5e05b024f653a5ce199e77cbbbd42fb5553562ec714b819421ed0c3e552a75d7`.

Components: `stable_deref_trait 1.2.1`.

```text
Copyright (c) 2017 Robert Grosse

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-041

SHA-256: `608fdcbb7daea2541c57228f21fc97deec310b19dafde70b2f4b84a96bf779f8`.

Components: `petgraph 0.8.3`.

```text
Graphosaurus (c) by the petgraph project.

Graphosaurus is licensed under a
Creative Commons Attribution-ShareAlike 4.0 International License.

You should have received a copy of the license along with this
work.  If not, see <http://creativecommons.org/licenses/by-sa/4.0/>.
```

### RUST-DEPENDENCY-042

SHA-256: `624d724f544656ff2f965b3b41e3050133fa042d80292a05330c786a12808cb9`.

Components: `dragonbox_ecma 0.1.12`.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

    TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

    1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

    2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

    3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

    4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

    5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

    6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

    7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

    8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

    9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

    END OF TERMS AND CONDITIONS


--- LLVM Exceptions to the Apache 2.0 License ----

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.
```

### RUST-DEPENDENCY-043

SHA-256: `62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a`.

Components: `dyn-clone 1.0.20`, `itoa 1.0.18`, `libc 0.2.186`, `proc-macro2 1.0.107`, `quote 1.0.47`, `ref-cast 1.0.25`, `ref-cast-impl 1.0.25`, `rustversion 1.0.22`, `ryu 1.0.23`, `seq-macro 0.3.6`, `serde 1.0.229`, `serde_core 1.0.229`, `serde_derive 1.0.229`, `serde_derive_internals 0.29.1`, `serde_json 1.0.151`, `syn 2.0.119`, `syn 3.0.4`, `thiserror 2.0.20`, `thiserror-impl 2.0.20`, `unicode-id-start 1.4.0`, `unicode-ident 1.0.24`.

```text
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### RUST-DEPENDENCY-044

SHA-256: `6485b8ed310d3f0340bf1ad1f47645069ce4069dcc6bb46c7d5c6faf41de1fdb`.

Components: `bitflags 2.13.1`, `log 0.4.33`, `num-bigint 0.5.1`, `num-integer 0.1.46`, `num-traits 0.2.19`, `regex 1.13.1`, `regex-automata 0.4.18`, `regex-syntax 0.8.11`.

```text
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-045

SHA-256: `68653aaa727a2bfa31b7a751e31701ce33c49d695c12dd291a07d1c54da4c14b`.

Components: `bstr 1.12.3`.

```text
This project is licensed under either of

 * Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or
   https://www.apache.org/licenses/LICENSE-2.0)
 * MIT license ([LICENSE-MIT](LICENSE-MIT) or
   https://opensource.org/licenses/MIT)

at your option.
```

### RUST-DEPENDENCY-046

SHA-256: `6b7374c39a57e57fc2c38eb529c4c88340152b10f51dd5ae2d819dfa67f61715`.

Components: `bstr 1.12.3`.

```text
The MIT License (MIT)

Copyright (c) 2018-2019 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### RUST-DEPENDENCY-047

SHA-256: `6fb8065469e053e7193bd6a82616740b2819725fbd12a027aa99534643247cca`.

Components: `oxc-browserslist 5.0.1`.

```text
MIT License

Copyright (c) 2021-present Pig Fang
Copyright (c) 2024-present Boshen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-048

SHA-256: `7365cc8878a1d7ce155a58c4ca09c3d7a6be413efa5334a80ea842912b669349`.

Components: `equivalent 1.0.2`.

```text
Copyright (c) 2016--2023

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-049

SHA-256: `74db5baf44a41b1000312c673544b3374e4198af5605c7f9080a402cec42cfa3`.

Components: `regex-syntax 0.8.11`.

```text
UNICODE, INC. LICENSE AGREEMENT - DATA FILES AND SOFTWARE

Unicode Data Files include all data files under the directories
http://www.unicode.org/Public/, http://www.unicode.org/reports/,
http://www.unicode.org/cldr/data/, http://source.icu-project.org/repos/icu/, and
http://www.unicode.org/utility/trac/browser/.

Unicode Data Files do not include PDF online code charts under the
directory http://www.unicode.org/Public/.

Software includes any source code published in the Unicode Standard
or under the directories
http://www.unicode.org/Public/, http://www.unicode.org/reports/,
http://www.unicode.org/cldr/data/, http://source.icu-project.org/repos/icu/, and
http://www.unicode.org/utility/trac/browser/.

NOTICE TO USER: Carefully read the following legal agreement.
BY DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING UNICODE INC.'S
DATA FILES ("DATA FILES"), AND/OR SOFTWARE ("SOFTWARE"),
YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT.
IF YOU DO NOT AGREE, DO NOT DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE
THE DATA FILES OR SOFTWARE.

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2018 Unicode, Inc. All rights reserved.
Distributed under the Terms of Use in http://www.unicode.org/copyright.html.

Permission is hereby granted, free of charge, to any person obtaining
a copy of the Unicode data files and any associated documentation
(the "Data Files") or Unicode software and any associated documentation
(the "Software") to deal in the Data Files or Software
without restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, and/or sell copies of
the Data Files or Software, and to permit persons to whom the Data Files
or Software are furnished to do so, provided that either
(a) this copyright and permission notice appear with all copies
of the Data Files or Software, or
(b) this copyright and permission notice appear in associated
Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT OF THIRD PARTY RIGHTS.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS
NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE,
DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THE DATA FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder
shall not be used in advertising or otherwise to promote the sale,
use or other dealings in these Data Files or Software without prior
written authorization of the copyright holder.
```

### RUST-DEPENDENCY-050

SHA-256: `7576269ea71f767b99297934c0b2367532690f8c4badc695edf8e04ab6a1e545`.

Components: `either 1.16.0`, `itertools 0.15.0`, `petgraph 0.8.3`.

```text
Copyright (c) 2015

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-051

SHA-256: `799e9ca9d179295ef372f25d3769cdda7d25bb2668add6a6a1e22d1e4c678b8d`.

Components: `miniz_oxide 0.9.1`.

```text
MIT License

Copyright 2013-2014 RAD Game Tools and Valve Software
Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC
Copyright (c) 2017 Frommi
Copyright (c) 2017-2024 oyvindln

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-052

SHA-256: `7b63ecd5f1902af1b63729947373683c32745c16a10e8e6292e2e2dcd7e90ae0`.

Components: `unicode-segmentation 1.13.3`, `unicode-width 0.2.2`.

```text
Copyright (c) 2015 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-053

SHA-256: `7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c`.

Components: `aho-corasick 1.1.4`, `globset 0.4.18`, `ignore 0.4.33`, `memchr 2.8.3`, `same-file 1.0.6`, `walkdir 2.5.0`.

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
```

### RUST-DEPENDENCY-054

SHA-256: `7fb47d7306f9a3ba25b44e7b9a94a300548a46709ed27753e28deac8e868b1cd`.

Components: `fast-glob 1.1.1`.

```text
MIT License

Copyright (c) 2025-present VoidZero Inc. & Contributors
Copyright (c) 2024 shulaoda
Copyright (c) 2023 Devon Govett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-055

SHA-256: `861399f8c21c042b110517e76dc6b63a2b334276c8cf17412fc3c8908ca8dc17`.

Components: `adler2 2.0.1`.

```text
Copyright (C) Jonas Schievink <jonasschievink@gmail.com>

Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### RUST-DEPENDENCY-056

SHA-256: `8764a597675778ddfd4e25f81b08a05dbcf089ac05662df7613fe67f150e3aa2`.

Components: `errno 0.3.14`.

```text
Copyright (c) 2014 Chris Wong

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-057

SHA-256: `89461664ce2aee7d80ea8fba7118fe7abd490d76ba435cf1d81d3128e060711f`.

Components: `lazy-regex 3.6.1`, `lazy-regex-proc_macros 3.6.1`.

```text
MIT License

Copyright (c) 2018 Canop

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-058

SHA-256: `898b1ae9821e98daf8964c8d6c7f61641f5f5aa78ad500020771c0939ee0dea1`.

Components: `tracing 0.1.44`, `tracing-attributes 0.1.31`, `tracing-core 0.1.36`.

```text
Copyright (c) 2019 Tokio Contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-059

SHA-256: `8ada45cd9f843acf64e4722ae262c622a2b3b3007c7310ef36ac1061a30f6adb`.

Components: `adler2 2.0.1`.

```text
                              Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/LICENSE-2.0

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### RUST-DEPENDENCY-060

SHA-256: `8b43ce8accd61e9d370b5ca9e9c4f953279b5c239926c62315b40e24df51b726`.

Components: `idna_adapter 1.2.2`.

```text
Copyright (c) The rust-url developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-061

SHA-256: `95bd3988beee069fa2848f648dab43cc6e0b2add2ad6bcb17360caf749802bcc`.

Components: `rustc-hash 2.1.3`.

```text
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### RUST-DEPENDENCY-062

SHA-256: `95ced5ecf1133fbf41d409b5555c86c344f83f3b019926057ddbc07cfdcc27b3`.

Components: `oxc_allocator 0.148.0`, `oxc_ast 0.148.0`, `oxc_ast_macros 0.148.0`, `oxc_ast_visit 0.148.0`, `oxc_cfg 0.148.0`, `oxc_codegen 0.148.0`, `oxc_compat 0.148.0`, `oxc_config 0.0.0`, `oxc_data_structures 0.148.0`, `oxc_diagnostics 0.148.0`, `oxc_ecmascript 0.148.0`, `oxc_estree 0.148.0`, `oxc_estree_tokens 0.148.0`, `oxc_index 5.0.0`, `oxc_jsdoc 0.148.0`, `oxc_linter 1.81.0`, `oxc_macros 0.0.0`, `oxc_parser 0.148.0`, `oxc_react_compiler 0.143.0`, `oxc_regular_expression 0.148.0`, `oxc_resolver 11.24.3`, `oxc_semantic 0.148.0`, `oxc_span 0.148.0`, `oxc_str 0.148.0`, `oxc_syntax 0.148.0`.

```text
MIT License

Copyright (c) 2024-present VoidZero Inc. & Contributors
Copyright (c) 2023 Boshen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-063

SHA-256: `a5dea80c1f383cb5f80a6bb0da5e55a2beb9f24adb123ce6300af2cbaaa3bf65`.

Components: `bytecount 0.6.9`.

```text
Copyright (c) 2017 The bytecount Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-064

SHA-256: `a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2`.

Components: `arrayvec 0.7.8`, `autocfg 1.5.1`, `base64 0.23.1`, `bitflags 2.13.1`, `bstr 1.12.3`, `cfg-if 1.0.4`, `crossbeam-deque 0.8.6`, `crossbeam-epoch 0.9.20`, `crossbeam-utils 0.8.21`, `displaydoc 0.2.6`, `either 1.16.0`, `equivalent 1.0.2`, `errno 0.3.14`, `fastrand 2.4.1`, `fixedbitset 0.5.7`, `form_urlencoded 1.2.2`, `hashbrown 0.14.5`, `hashbrown 0.15.5`, `hashbrown 0.16.1`, `hashbrown 0.17.1`, `idna 1.1.0`, `idna_adapter 1.2.2`, `indexmap 2.14.1`, `itertools 0.15.0`, `linux-raw-sys 0.12.1`, `lock_api 0.4.14`, `log 0.4.33`, `num-bigint 0.5.1`, `num-integer 0.1.46`, `num-traits 0.2.19`, `once_cell 1.21.4`, `parking_lot_core 0.9.12`, `percent-encoding 2.3.2`, `petgraph 0.8.3`, `postcard 1.1.3`, `rayon 1.12.0`, `rayon-core 1.13.0`, `regex 1.13.1`, `regex-automata 0.4.18`, `regex-syntax 0.8.11`, `rustix 1.1.4`, `scopeguard 1.2.0`, `smallvec 1.15.2`, `stable_deref_trait 1.2.1`, `unicode-segmentation 1.13.3`, `unicode-width 0.2.2`, `url 2.5.8`.

```text
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### RUST-DEPENDENCY-065

SHA-256: `a7a9cf0c93716fc4861165716257701f7363402abfe748bdac1a802cfcd2fa49`.

Components: `nonmax 0.5.5`.

```text
Copyright (c) 2020 Lucien Greathouse

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-066

SHA-256: `ab499c75a0f0da8e0fe83bf9ba3a27e5c39705310f07107c6c66b69958d2401c`.

Components: `base64 0.23.1`.

```text
The MIT License (MIT)

Copyright (c) 2025 Alice Maz, Marshall Pierce

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### RUST-DEPENDENCY-067

SHA-256: `aed7b1758e35afa0cd0fde059d61950747ca11cd0e5e169cb21c11608daed772`.

Components: `convert_case 0.12.0`.

```text
MIT License

Copyright (c) 2025 rutrum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-068

SHA-256: `b1181a40b2a7b25cf66fd01481713bc1005df082c53ef73e851e55071b102744`.

Components: `foldhash 0.1.5`, `foldhash 0.2.0`.

```text
Copyright (c) 2024 Orson Peters

This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use of
this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject to
the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
    that you wrote the original software. If you use this software in a product,
    an acknowledgment in the product documentation would be appreciated but is
    not required.

2. Altered source versions must be plainly marked as such, and must not be
    misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

### RUST-DEPENDENCY-069

SHA-256: `b38f11f6096706e6de553dabe2a7ed142d59b6fa8c97e290c67496154745cdd5`.

Components: `idna 1.1.0`, `percent-encoding 2.3.2`, `url 2.5.8`.

```text
Copyright (c) 2013-2025 The rust-url developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-070

SHA-256: `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`.

Components: `bytecount 0.6.9`.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### RUST-DEPENDENCY-071

SHA-256: `c30152c94a6d75e021adbc52b3a52470366a46edb917e17deae3259251af244c`.

Components: `utf8_iter 1.0.4`.

```text
Copyright Mozilla Foundation

Licensed under the Apache License (Version 2.0), or the MIT license,
(the "Licenses") at your option. You may not use this file except in
compliance with one of the Licenses. You may obtain copies of the
Licenses at:

   https://www.apache.org/licenses/LICENSE-2.0
   https://opensource.org/licenses/MIT

Unless required by applicable law or agreed to in writing, software
distributed under the Licenses is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the Licenses for the specific language governing permissions and
limitations under the Licenses.

--

Test code is dedicated to the Public Domain when so designated (see
the individual files for PD/CC0-dedicated sections).

--

The implementation for Utf8CharIndices was adapted from the
CharIndices implementation of the Rust standard library at revision
ab32548539ec38a939c1b58599249f3b54130026
(https://github.com/rust-lang/rust/blob/ab32548539ec38a939c1b58599249f3b54130026/library/core/src/str/iter.rs).

Excerpt from https://github.com/rust-lang/rust/blob/ab32548539ec38a939c1b58599249f3b54130026/COPYRIGHT ,
which refers to
https://github.com/rust-lang/rust/blob/ab32548539ec38a939c1b58599249f3b54130026/LICENSE-APACHE
and
https://github.com/rust-lang/rust/blob/ab32548539ec38a939c1b58599249f3b54130026/LICENSE-MIT
:

For full authorship information, see the version control history or
https://thanks.rust-lang.org

Except as otherwise noted (below and/or in individual files), Rust is
licensed under the Apache License, Version 2.0 <LICENSE-APACHE> or
<http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
<LICENSE-MIT> or <http://opensource.org/licenses/MIT>, at your option.
```

### RUST-DEPENDENCY-072

SHA-256: `c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08`.

Components: `cobs 0.3.0`.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

```

### RUST-DEPENDENCY-073

SHA-256: `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.

Components: `constcat 0.6.1`, `json-strip-comments 3.1.2`, `self_cell 1.3.0`, `unicode-linebreak 0.1.5`.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### RUST-DEPENDENCY-074

SHA-256: `c8b25bb75fd899b6f16794dc8173400f3221a204afb79cd39c3659c955029381`.

Components: `nonmax 0.5.5`.

```text
i                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### RUST-DEPENDENCY-075

SHA-256: `c962ee4d1d05ddc138b202b2540219ebc57893fcf97b364852094a9a94ce1365`.

Components: `siphasher 1.0.3`.

```text
Copyright 2012-2016 The Rust Project Developers.
Copyright 2016-2026 Frank Denis.

Licensed under the Apache License, Version 2.0 <LICENSE-APACHE or
http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
<LICENSE-MIT or http://opensource.org/licenses/MIT>, at your
option.
```

### RUST-DEPENDENCY-076

SHA-256: `c9a75f18b9ab2927829a208fc6aa2cf4e63b8420887ba29cdb265d6619ae82d5`.

Components: `lock_api 0.4.14`, `parking_lot_core 0.9.12`.

```text
Copyright (c) 2016 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-077

SHA-256: `c9bff75738922193e67fa726fa225535870d2aa1059f91452c411736284ad566`.

Components: `dragonbox_ecma 0.1.12`, `ryu 1.0.23`.

```text
Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-078

SHA-256: `cb3c929a05e6cbc9de9ab06a4c57eeb60ca8c724bef6c138c87d3a577e27aa14`.

Components: `same-file 1.0.6`.

```text
The MIT License (MIT)

Copyright (c) 2017 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### RUST-DEPENDENCY-079

SHA-256: `ce592787ff2321feab698a4c612237f4378cc658ebb1d472913e5802cc47afb4`.

Components: `fixedbitset 0.5.7`.

```text
Copyright (c) 2015-2017

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-080

SHA-256: `ce93600c49fbb3e14df32efe752264644f6a2f8e08a735ba981725799e5309ef`.

Components: `textwrap 0.16.2`.

```text
MIT License

Copyright (c) 2016 Martin Geisler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-081

SHA-256: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.

Components: `halfbrown 0.4.0`, `simd-json 0.18.1`, `static_assertions 1.1.0`, `utf8_iter 1.0.4`, `value-trait 0.12.1`.

```text

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### RUST-DEPENDENCY-082

SHA-256: `de701d0618d694feb1af90f02181a1763d9b0bdeb70a3a592781e529077dba65`.

Components: `seize 0.5.1`.

```text
MIT License

Copyright (c) 2022 Ibraheem Ahmed

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-083

SHA-256: `e03e58ea9205f51989b7a50f450051b24e6516cc1f0b920222dcda992072be99`.

Components: `language-tags 0.3.2`.

```text
Copyright (c) 2015 Pyfisch

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### RUST-DEPENDENCY-084

SHA-256: `e0cfa1006a64520633de6bfbf563f5b1bea04ef0c5b73f049681931fa297dda3`.

Components: `cobs 0.3.0`.

```text
Copyright (c) 2015 The cobs.rs Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-085

SHA-256: `ea084a2373ebc1f0902c09266e7bf25a05ab3814c1805bb017ffa7308f90c061`.

Components: `static_assertions 1.1.0`.

```text
MIT License

Copyright (c) 2017 Nikolai Vazquez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-086

SHA-256: `ecc269ef87fd38a1d98e30bfac9ba964a9dbd9315c3770fed98d4d7cb5882055`.

Components: `indexmap 2.14.1`.

```text
Copyright (c) 2016--2017

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-087

SHA-256: `f367c1b8e1aa262435251e442901da4607b4650e0e63a026f5044473ecfb90f2`.

Components: `icu_collections 2.2.0`, `icu_locale_core 2.2.0`, `icu_normalizer 2.2.0`, `icu_normalizer_data 2.2.0`, `icu_properties 2.2.0`, `icu_properties_data 2.2.0`, `icu_provider 2.2.0`, `litemap 0.8.2`, `potential_utf 0.1.5`, `tinystr 0.8.3`, `writeable 0.6.3`, `yoke 0.8.3`, `yoke-derive 0.8.2`, `zerofrom 0.1.8`, `zerofrom-derive 0.1.7`, `zerotrie 0.2.4`, `zerovec 0.11.6`, `zerovec-derive 0.11.3`.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2020-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0

—

Portions of ICU4X may have been adapted from ICU4C and/or ICU4J.
ICU 1.8.1 to ICU 57.1 © 1995-2016 International Business Machines Corporation and others.
```

### RUST-DEPENDENCY-088

SHA-256: `f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1`.

Components: `unicode-id-start 1.4.0`, `unicode-ident 1.0.24`.

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2023 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

### RUST-DEPENDENCY-089

SHA-256: `f98e09091d5ae02b2f2ec1ead4f7f28c4c44d1cb98b078739ba67091637e170c`.

Components: `castaway 0.2.4`.

```text
MIT License

Copyright (c) 2021 Stephen M. Coakley

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-090

SHA-256: `f9c375a1be4a41f7b70301dd83c91cb89e41567478859b77eef375a52d782505`.

Components: `self_cell 1.3.0`.

```text
                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991

 Copyright (C) 1989, 1991 Free Software Foundation, Inc.,
 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The licenses for most software are designed to take away your
freedom to share and change it.  By contrast, the GNU General Public
License is intended to guarantee your freedom to share and change free
software--to make sure the software is free for all its users.  This
General Public License applies to most of the Free Software
Foundation's software and to any other program whose authors commit to
using it.  (Some other Free Software Foundation software is covered by
the GNU Lesser General Public License instead.)  You can apply it to
your programs, too.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
this service if you wish), that you receive source code or can get it
if you want it, that you can change the software or use pieces of it
in new free programs; and that you know you can do these things.

  To protect your rights, we need to make restrictions that forbid
anyone to deny you these rights or to ask you to surrender the rights.
These restrictions translate to certain responsibilities for you if you
distribute copies of the software, or if you modify it.

  For example, if you distribute copies of such a program, whether
gratis or for a fee, you must give the recipients all the rights that
you have.  You must make sure that they, too, receive or can get the
source code.  And you must show them these terms so they know their
rights.

  We protect your rights with two steps: (1) copyright the software, and
(2) offer you this license which gives you legal permission to copy,
distribute and/or modify the software.

  Also, for each author's protection and ours, we want to make certain
that everyone understands that there is no warranty for this free
software.  If the software is modified by someone else and passed on, we
want its recipients to know that what they have is not the original, so
that any problems introduced by others will not reflect on the original
authors' reputations.

  Finally, any free program is threatened constantly by software
patents.  We wish to avoid the danger that redistributors of a free
program will individually obtain patent licenses, in effect making the
program proprietary.  To prevent this, we have made it clear that any
patent must be licensed for everyone's free use or not licensed at all.

  The precise terms and conditions for copying, distribution and
modification follow.

                    GNU GENERAL PUBLIC LICENSE
   TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION

  0. This License applies to any program or other work which contains
a notice placed by the copyright holder saying it may be distributed
under the terms of this General Public License.  The "Program", below,
refers to any such program or work, and a "work based on the Program"
means either the Program or any derivative work under copyright law:
that is to say, a work containing the Program or a portion of it,
either verbatim or with modifications and/or translated into another
language.  (Hereinafter, translation is included without limitation in
the term "modification".)  Each licensee is addressed as "you".

Activities other than copying, distribution and modification are not
covered by this License; they are outside its scope.  The act of
running the Program is not restricted, and the output from the Program
is covered only if its contents constitute a work based on the
Program (independent of having been made by running the Program).
Whether that is true depends on what the Program does.

  1. You may copy and distribute verbatim copies of the Program's
source code as you receive it, in any medium, provided that you
conspicuously and appropriately publish on each copy an appropriate
copyright notice and disclaimer of warranty; keep intact all the
notices that refer to this License and to the absence of any warranty;
and give any other recipients of the Program a copy of this License
along with the Program.

You may charge a fee for the physical act of transferring a copy, and
you may at your option offer warranty protection in exchange for a fee.

  2. You may modify your copy or copies of the Program or any portion
of it, thus forming a work based on the Program, and copy and
distribute such modifications or work under the terms of Section 1
above, provided that you also meet all of these conditions:

    a) You must cause the modified files to carry prominent notices
    stating that you changed the files and the date of any change.

    b) You must cause any work that you distribute or publish, that in
    whole or in part contains or is derived from the Program or any
    part thereof, to be licensed as a whole at no charge to all third
    parties under the terms of this License.

    c) If the modified program normally reads commands interactively
    when run, you must cause it, when started running for such
    interactive use in the most ordinary way, to print or display an
    announcement including an appropriate copyright notice and a
    notice that there is no warranty (or else, saying that you provide
    a warranty) and that users may redistribute the program under
    these conditions, and telling the user how to view a copy of this
    License.  (Exception: if the Program itself is interactive but
    does not normally print such an announcement, your work based on
    the Program is not required to print an announcement.)

These requirements apply to the modified work as a whole.  If
identifiable sections of that work are not derived from the Program,
and can be reasonably considered independent and separate works in
themselves, then this License, and its terms, do not apply to those
sections when you distribute them as separate works.  But when you
distribute the same sections as part of a whole which is a work based
on the Program, the distribution of the whole must be on the terms of
this License, whose permissions for other licensees extend to the
entire whole, and thus to each and every part regardless of who wrote it.

Thus, it is not the intent of this section to claim rights or contest
your rights to work written entirely by you; rather, the intent is to
exercise the right to control the distribution of derivative or
collective works based on the Program.

In addition, mere aggregation of another work not based on the Program
with the Program (or with a work based on the Program) on a volume of
a storage or distribution medium does not bring the other work under
the scope of this License.

  3. You may copy and distribute the Program (or a work based on it,
under Section 2) in object code or executable form under the terms of
Sections 1 and 2 above provided that you also do one of the following:

    a) Accompany it with the complete corresponding machine-readable
    source code, which must be distributed under the terms of Sections
    1 and 2 above on a medium customarily used for software interchange; or,

    b) Accompany it with a written offer, valid for at least three
    years, to give any third party, for a charge no more than your
    cost of physically performing source distribution, a complete
    machine-readable copy of the corresponding source code, to be
    distributed under the terms of Sections 1 and 2 above on a medium
    customarily used for software interchange; or,

    c) Accompany it with the information you received as to the offer
    to distribute corresponding source code.  (This alternative is
    allowed only for noncommercial distribution and only if you
    received the program in object code or executable form with such
    an offer, in accord with Subsection b above.)

The source code for a work means the preferred form of the work for
making modifications to it.  For an executable work, complete source
code means all the source code for all modules it contains, plus any
associated interface definition files, plus the scripts used to
control compilation and installation of the executable.  However, as a
special exception, the source code distributed need not include
anything that is normally distributed (in either source or binary
form) with the major components (compiler, kernel, and so on) of the
operating system on which the executable runs, unless that component
itself accompanies the executable.

If distribution of executable or object code is made by offering
access to copy from a designated place, then offering equivalent
access to copy the source code from the same place counts as
distribution of the source code, even though third parties are not
compelled to copy the source along with the object code.

  4. You may not copy, modify, sublicense, or distribute the Program
except as expressly provided under this License.  Any attempt
otherwise to copy, modify, sublicense or distribute the Program is
void, and will automatically terminate your rights under this License.
However, parties who have received copies, or rights, from you under
this License will not have their licenses terminated so long as such
parties remain in full compliance.

  5. You are not required to accept this License, since you have not
signed it.  However, nothing else grants you permission to modify or
distribute the Program or its derivative works.  These actions are
prohibited by law if you do not accept this License.  Therefore, by
modifying or distributing the Program (or any work based on the
Program), you indicate your acceptance of this License to do so, and
all its terms and conditions for copying, distributing or modifying
the Program or works based on it.

  6. Each time you redistribute the Program (or any work based on the
Program), the recipient automatically receives a license from the
original licensor to copy, distribute or modify the Program subject to
these terms and conditions.  You may not impose any further
restrictions on the recipients' exercise of the rights granted herein.
You are not responsible for enforcing compliance by third parties to
this License.

  7. If, as a consequence of a court judgment or allegation of patent
infringement or for any other reason (not limited to patent issues),
conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot
distribute so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you
may not distribute the Program at all.  For example, if a patent
license would not permit royalty-free redistribution of the Program by
all those who receive copies directly or indirectly through you, then
the only way you could satisfy both it and this License would be to
refrain entirely from distribution of the Program.

If any portion of this section is held invalid or unenforceable under
any particular circumstance, the balance of the section is intended to
apply and the section as a whole is intended to apply in other
circumstances.

It is not the purpose of this section to induce you to infringe any
patents or other property right claims or to contest validity of any
such claims; this section has the sole purpose of protecting the
integrity of the free software distribution system, which is
implemented by public license practices.  Many people have made
generous contributions to the wide range of software distributed
through that system in reliance on consistent application of that
system; it is up to the author/donor to decide if he or she is willing
to distribute software through any other system and a licensee cannot
impose that choice.

This section is intended to make thoroughly clear what is believed to
be a consequence of the rest of this License.

  8. If the distribution and/or use of the Program is restricted in
certain countries either by patents or by copyrighted interfaces, the
original copyright holder who places the Program under this License
may add an explicit geographical distribution limitation excluding
those countries, so that distribution is permitted only in or among
countries not thus excluded.  In such case, this License incorporates
the limitation as if written in the body of this License.

  9. The Free Software Foundation may publish revised and/or new versions
of the General Public License from time to time.  Such new versions will
be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

Each version is given a distinguishing version number.  If the Program
specifies a version number of this License which applies to it and "any
later version", you have the option of following the terms and conditions
either of that version or of any later version published by the Free
Software Foundation.  If the Program does not specify a version number of
this License, you may choose any version ever published by the Free Software
Foundation.

  10. If you wish to incorporate parts of the Program into other free
programs whose distribution conditions are different, write to the author
to ask for permission.  For software which is copyrighted by the Free
Software Foundation, write to the Free Software Foundation; we sometimes
make exceptions for this.  Our decision will be guided by the two goals
of preserving the free status of all derivatives of our free software and
of promoting the sharing and reuse of software generally.

                            NO WARRANTY

  11. BECAUSE THE PROGRAM IS LICENSED FREE OF CHARGE, THERE IS NO WARRANTY
FOR THE PROGRAM, TO THE EXTENT PERMITTED BY APPLICABLE LAW.  EXCEPT WHEN
OTHERWISE STATED IN WRITING THE COPYRIGHT HOLDERS AND/OR OTHER PARTIES
PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESSED
OR IMPLIED, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.  THE ENTIRE RISK AS
TO THE QUALITY AND PERFORMANCE OF THE PROGRAM IS WITH YOU.  SHOULD THE
PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF ALL NECESSARY SERVICING,
REPAIR OR CORRECTION.

  12. IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MAY MODIFY AND/OR
REDISTRIBUTE THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES,
INCLUDING ANY GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING
OUT OF THE USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED
TO LOSS OF DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY
YOU OR THIRD PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER
PROGRAMS), EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE
POSSIBILITY OF SUCH DAMAGES.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
convey the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License along
    with this program; if not, write to the Free Software Foundation, Inc.,
    51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.

Also add information on how to contact you by electronic and paper mail.

If the program is interactive, make it output a short notice like this
when it starts in an interactive mode:

    Gnomovision version 69, Copyright (C) year name of author
    Gnomovision comes with ABSOLUTELY NO WARRANTY; for details type `show w'.
    This is free software, and you are welcome to redistribute it
    under certain conditions; type `show c' for details.

The hypothetical commands `show w' and `show c' should show the appropriate
parts of the General Public License.  Of course, the commands you use may
be called something other than `show w' and `show c'; they could even be
mouse-clicks or menu items--whatever suits your program.

You should also get your employer (if you work as a programmer) or your
school, if any, to sign a "copyright disclaimer" for the program, if
necessary.  Here is a sample; alter the names:

  Yoyodyne, Inc., hereby disclaims all copyright interest in the program
  `Gnomovision' (which makes passes at compilers) written by James Hacker.

  <signature of Ty Coon>, 1 April 1989
  Ty Coon, President of Vice

This General Public License does not permit incorporating your program into
proprietary programs.  If your program is a subroutine library, you may
consider it more useful to permit linking proprietary applications with the
library.  If this is what you want to do, use the GNU Lesser General
Public License instead of this License.
```

### RUST-DEPENDENCY-091

SHA-256: `f9c4c77baa3828004ee54b8a4f2db2e88ed44a6237a493965bf551fac0fcb62d`.

Components: `constcat 0.6.1`.

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-092

SHA-256: `fb4e17fccd6b1c6904404631d8896ea97093bff2b2e6f3fa9e6a690dbc66d502`.

Components: `oxc_react_compiler 0.143.0`.

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.
Copyright (c) 2026-present VoidZero Inc. & Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### RUST-DEPENDENCY-093

SHA-256: `fb77f0a9c53e473abe5103c8632ef9f0f2874d4fb3f17cb2d8c661aab9cee9d7`.

Components: `scopeguard 1.2.0`.

```text
Copyright (c) 2016-2019 Ulrik Sverdrup "bluss" and scopeguard developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### RUST-DEPENDENCY-094

SHA-256: `ff8f68cb076caf8cefe7a6430d4ac086ce6af2ca8ce2c4e5a2004d4552ef52a2`.

Components: `hashbrown 0.14.5`, `hashbrown 0.15.5`, `hashbrown 0.16.1`, `hashbrown 0.17.1`.

```text
Copyright (c) 2016 Amanieu d'Antras

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```


## Rust standard library (Rust 1.98.0)

Compiler source revision: `88d9e12ae178fab0fb5cc050a94da85685d449ea`.

The Rust distribution's standard-library copyright document is reproduced below. Its component, scope and copyright metadata is preserved; repeated notice texts are listed once, by SHA-256. This is a conservative notice set from the pinned standard-library distribution, including its build dependencies; it does not assert that every listed component is linked into this worker.

### Rust COPYRIGHT

```text
Short version for non-lawyers:

The Rust Project is dual-licensed under Apache 2.0 and MIT
terms.

It is Copyright (c) The Rust Project Contributors.

Longer version:

Copyrights in the Rust project are retained by their contributors. No
copyright assignment is required to contribute to the Rust project.

Some files include explicit copyright notices and/or license notices.
For full authorship information, see the version control history or
<https://thanks.rust-lang.org>

Except as otherwise noted, Rust is licensed under the Apache License, Version
2.0 <LICENSE-APACHE> or <http://www.apache.org/licenses/LICENSE-2.0> or the MIT
license <LICENSE-MIT> or <http://opensource.org/licenses/MIT>, at your option.

We track licenses for third-party materials in two ways:

* We use [REUSE](https://reuse.software) to track license information for
  in-tree source files - both those authored by the Rust project and those
  authored by third parties. See `REUSE.toml`, and our cached output of the
  `reuse` tool which is committed to `license-metadata.json`.
* We use `cargo` to track license information for out-of-tree dependencies.

These two sources of information are collected by the tool `generate-copyright`
into a file called `COPYRIGHT.html`, which is shipped with each binary release
of Rust. Please refer to that file for detailed information as to the components of
any given Rust release. We also produce a `COPYRIGHT-library.html` file which only
covers the subset of source code used in the Rust Standard Library, as opposed
to the toolchain as a whole.
```

### Rust LICENSE-MIT

```text
Copyright (c) The Rust Project Contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### Rust LICENSE-APACHE

```text
                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### Standard-library component and copyright metadata

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Copyright notices for The Rust Standard Library</title>
</head>
<body>

<h1>Copyright notices for The Rust Standard Library</h1>

<h2>Table of Contents</h2>
<ul>
    <li><a href="#short-version">Short version for non-lawyers</a></li>
    <li><a href="#longer-version">Longer version</a></li>
    <li><a href="#in-tree-files">In-tree files</a></li>
    <li><a href="#out-of-tree-dependencies">Out-of-tree dependencies</a></li>
</ul>

<h2 id="short-version">Short version for non-lawyers</h2>

The Rust Standard Library is dual-licensed under Apache 2.0 and MIT terms.

<h2 id="longer-version">Longer version</h2>

<p>Copyrights in the Rust Standard Library are retained by their contributors. No copyright assignment is required to contribute to the Rust project.</p>

<p>Some files include explicit copyright notices and/or license notices. For full authorship information, see the version control history or <a href="https://thanks.rust-lang.org">https://thanks.rust-lang.org</a>.</p>

<p>Except as otherwise noted (below and/or in individual files), the Rust Standard Library is licensed under the <a href="http://www.apache.org/licenses/LICENSE-2.0">Apache License, Version 2.0</a> or the <a href="http://opensource.org/licenses/MIT">MIT</a> license, at your option.</p>

<p>This file describes the copyright and licensing information for the source code within The Rust Project git tree related to the Rust Standard Library, and the third-party dependencies used when building the Rust Standard Library.</p>

<h2 id="in-tree-files">In-tree files</h2>

<p>The following licenses cover the in-tree source files that were used in this release:</p>






<div style="border:1px solid black; padding: 5px;">

    <p>
    <b>File/Directory:</b> <code>.</code>
    </p>

    

    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>
    

    

    

    <p><b>Exceptions:</b></p>
    
    

<div style="border:1px solid black; padding: 5px;">

    <p>
    <b>File/Directory:</b> <code>library/core/src/unicode</code>
    </p>

    

    <p><b>License:</b> Unicode-3.0</p>
    
    <p><b>Copyright:</b> 1991-2024 Unicode, Inc</p>
    

    

    

    <p><b>Exceptions:</b></p>
    
    

<div style="border:1px solid black; padding: 5px;">
    <p>
    <b>File/Directory:</b> <code>mod.rs</code>
    </p>

    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>
    
</div>


    

    

</div>


    
    

<div style="border:1px solid black; padding: 5px;">

    <p>
    <b>File/Directory:</b> <code>library/backtrace</code>
    </p>

    

    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    <p><b>Copyright:</b> 2014 Alex Crichton</p>
    
    <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>
    

    

    

</div>


    
    

<div style="border:1px solid black; padding: 5px;">

    <p>
    <b>File/Directory:</b> <code>library/std/src/sync/mpmc</code>
    </p>

    

    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    <p><b>Copyright:</b> 2019 The Crossbeam Project Developers</p>
    
    <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>
    

    

    

</div>


    
    

<div style="border:1px solid black; padding: 5px;">
    <p>
    <b>File/Directory:</b> <code>library/std/src/sys/sync/mutex/fuchsia.rs</code>
    </p>

    <p><b>License:</b> BSD-2-Clause AND (Apache-2.0 OR MIT)</p>
    
    <p><b>Copyright:</b> 2016 The Fuchsia Authors</p>
    
    <p><b>Copyright:</b> The Rust Project Developers (see https://thanks.rust-lang.org)</p>
    
</div>


    

    

</div>






<h2 id="out-of-tree-dependencies">Out-of-tree dependencies</h2>

<p>The following licenses cover the out-of-tree crates that were used in the
Rust Standard Library in this release:</p>


    <h3>📦 aho-corasick-1.1.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/aho-corasick/1.1.4">https://crates.io/crates/aho-corasick/1.1.4</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 anstream-1.0.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anstream/1.0.0">https://crates.io/crates/anstream/1.0.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 anstyle-1.0.14</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anstyle/1.0.14">https://crates.io/crates/anstyle/1.0.14</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 anstyle-parse-1.0.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anstyle-parse/1.0.0">https://crates.io/crates/anstyle-parse/1.0.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 anstyle-query-1.1.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anstyle-query/1.1.5">https://crates.io/crates/anstyle-query/1.1.5</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 anstyle-wincon-3.0.11</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anstyle-wincon/3.0.11">https://crates.io/crates/anstyle-wincon/3.0.11</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 anyhow-1.0.102</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/anyhow/1.0.102">https://crates.io/crates/anyhow/1.0.102</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 autocfg-1.5.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/autocfg/1.5.0">https://crates.io/crates/autocfg/1.5.0</a></p>
    <p><b>Authors:</b> Josh Stone &#60;cuviper@gmail.com&#62;</p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-99afaa30c17801207692138b8a7d9f7522b52711dabb4cde25855dadc950e4c8</pre>
            </details>
        
        </p>
    

    <h3>📦 bitflags-2.11.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/bitflags/2.11.0">https://crates.io/crates/bitflags/2.11.0</a></p>
    <p><b>Authors:</b> The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 cc-1.2.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/cc/1.2.0">https://crates.io/crates/cc/1.2.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 cc-1.2.59</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/cc/1.2.59">https://crates.io/crates/cc/1.2.59</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 cfg-if-1.0.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/cfg-if/1.0.4">https://crates.io/crates/cfg-if/1.0.4</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 clap-4.6.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/clap/4.6.0">https://crates.io/crates/clap/4.6.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 clap_builder-4.6.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/clap_builder/4.6.0">https://crates.io/crates/clap_builder/4.6.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 clap_derive-4.6.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/clap_derive/4.6.0">https://crates.io/crates/clap_derive/4.6.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 clap_lex-1.1.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/clap_lex/1.1.0">https://crates.io/crates/clap_lex/1.1.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 colorchoice-1.0.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/colorchoice/1.0.5">https://crates.io/crates/colorchoice/1.0.5</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 crossbeam-deque-0.8.6</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/crossbeam-deque/0.8.6">https://crates.io/crates/crossbeam-deque/0.8.6</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-5a7d13c6710cdec29e74eb3172b80712049c34099ab7259661ada051fc90777b</pre>
            </details>
        
        </p>
    

    <h3>📦 crossbeam-epoch-0.9.18</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/crossbeam-epoch/0.9.18">https://crates.io/crates/crossbeam-epoch/0.9.18</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-5a7d13c6710cdec29e74eb3172b80712049c34099ab7259661ada051fc90777b</pre>
            </details>
        
        </p>
    

    <h3>📦 crossbeam-utils-0.8.21</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/crossbeam-utils/0.8.21">https://crates.io/crates/crossbeam-utils/0.8.21</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-5a7d13c6710cdec29e74eb3172b80712049c34099ab7259661ada051fc90777b</pre>
            </details>
        
        </p>
    

    <h3>📦 darling-0.23.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/darling/0.23.0">https://crates.io/crates/darling/0.23.0</a></p>
    <p><b>Authors:</b> Ted Driggs &#60;ted.driggs@outlook.com&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-cc8f3c8ab396de7fa549e3907319281cf13d0a4a456a2b0695c5b61d877dba68</pre>
            </details>
        
        </p>
    

    <h3>📦 darling_core-0.23.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/darling_core/0.23.0">https://crates.io/crates/darling_core/0.23.0</a></p>
    <p><b>Authors:</b> Ted Driggs &#60;ted.driggs@outlook.com&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-cc8f3c8ab396de7fa549e3907319281cf13d0a4a456a2b0695c5b61d877dba68</pre>
            </details>
        
        </p>
    

    <h3>📦 darling_macro-0.23.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/darling_macro/0.23.0">https://crates.io/crates/darling_macro/0.23.0</a></p>
    <p><b>Authors:</b> Ted Driggs &#60;ted.driggs@outlook.com&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-cc8f3c8ab396de7fa549e3907319281cf13d0a4a456a2b0695c5b61d877dba68</pre>
            </details>
        
        </p>
    

    <h3>📦 diff-0.1.13</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/diff/0.1.13">https://crates.io/crates/diff/0.1.13</a></p>
    <p><b>Authors:</b> Utkarsh Kukreti &#60;utkarshkukreti@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-68d40a93aa2c4ac04cb077d066023a54e9285491f78e63171a99176af32c4440</pre>
            </details>
        
        </p>
    

    <h3>📦 dlmalloc-0.2.13</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/dlmalloc/0.2.13">https://crates.io/crates/dlmalloc/0.2.13</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 either-1.15.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/either/1.15.0">https://crates.io/crates/either/1.15.0</a></p>
    <p><b>Authors:</b> bluss</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-fdd1c2117bcf8157d1d013d0953c0a7e6e5fab73df9e36773cd77634428568eb</pre>
            </details>
        
        </p>
    

    <h3>📦 env_filter-1.0.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/env_filter/1.0.1">https://crates.io/crates/env_filter/1.0.1</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 env_logger-0.10.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/env_logger/0.10.2">https://crates.io/crates/env_logger/0.10.2</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 env_logger-0.11.10</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/env_logger/0.11.10">https://crates.io/crates/env_logger/0.11.10</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 equivalent-1.0.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/equivalent/1.0.2">https://crates.io/crates/equivalent/1.0.2</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4428cd87371acbd49f9f6380125492cd1e89df621d2fd7f55e30a0891f96a433</pre>
            </details>
        
        </p>
    

    <h3>📦 errno-0.3.14</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/errno/0.3.14">https://crates.io/crates/errno/0.3.14</a></p>
    <p><b>Authors:</b> Chris Wong &#60;lambda.fairy@gmail.com&#62;, Dan Gohman &#60;dev@sunfishcode.online&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-7f91c2a4eddb48282e1f4c1e6a8f9e7d1842655212bcb9b5c0f9f8044aaf0ac5</pre>
            </details>
        
        </p>
    

    <h3>📦 fastrand-2.4.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/fastrand/2.4.1">https://crates.io/crates/fastrand/2.4.1</a></p>
    <p><b>Authors:</b> Stjepan Glavina &#60;stjepang@gmail.com&#62;</p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 find-msvc-tools-0.1.9</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/find-msvc-tools/0.1.9">https://crates.io/crates/find-msvc-tools/0.1.9</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 foldhash-0.1.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/foldhash/0.1.5">https://crates.io/crates/foldhash/0.1.5</a></p>
    <p><b>Authors:</b> Orson Peters &#60;orsonpeters@gmail.com&#62;</p>
    <p><b>License:</b> Zlib</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-b1181a40b2a7b25cf66fd01481713bc1005df082c53ef73e851e55071b102744</pre>
            </details>
        
        </p>
    

    <h3>📦 foldhash-0.2.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/foldhash/0.2.0">https://crates.io/crates/foldhash/0.2.0</a></p>
    <p><b>Authors:</b> Orson Peters &#60;orsonpeters@gmail.com&#62;</p>
    <p><b>License:</b> Zlib</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-b1181a40b2a7b25cf66fd01481713bc1005df082c53ef73e851e55071b102744</pre>
            </details>
        
        </p>
    

    <h3>📦 fortanix-sgx-abi-0.6.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/fortanix-sgx-abi/0.6.1">https://crates.io/crates/fortanix-sgx-abi/0.6.1</a></p>
    <p><b>Authors:</b> Fortanix, Inc.</p>
    <p><b>License:</b> MPL-2.0</p>
    
    

    <h3>📦 getopts-0.2.24</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/getopts/0.2.24">https://crates.io/crates/getopts/0.2.24</a></p>
    <p><b>Authors:</b> The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 getrandom-0.3.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/getrandom/0.3.4">https://crates.io/crates/getrandom/0.3.4</a></p>
    <p><b>Authors:</b> The Rand Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-e7330bf53074b4a9c5896f4a03d782be7f163381e45923d5e2369fe194a19f99</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-73af2019a565c0e6d05ae4ad97bf9c1815f75b7d559ec2c3c5abebf60444b040</pre>
            </details>
        
        </p>
    

    <h3>📦 getrandom-0.4.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/getrandom/0.4.2">https://crates.io/crates/getrandom/0.4.2</a></p>
    <p><b>Authors:</b> The Rand Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-e7330bf53074b4a9c5896f4a03d782be7f163381e45923d5e2369fe194a19f99</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-94b1870d380ccf537d5bdfda2de882965c9afb814acc375cb1b47fc1a0014ee3</pre>
            </details>
        
        </p>
    

    <h3>📦 gimli-0.32.3</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/gimli/0.32.3">https://crates.io/crates/gimli/0.32.3</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-033a9383ff21d1e4811d98dd2e0081b0ba0d9c9a31d6c7ba9e63e3488479bf29</pre>
            </details>
        
        </p>
    

    <h3>📦 hashbrown-0.12.3</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/hashbrown/0.12.3">https://crates.io/crates/hashbrown/0.12.3</a></p>
    <p><b>Authors:</b> Amanieu d&#39;Antras &#60;amanieu@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-ae9791f02f2bbe0ce17b434753af97be6e5284b6f8e9f22db3c1f0f11b2e015a</pre>
            </details>
        
        </p>
    

    <h3>📦 hashbrown-0.15.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/hashbrown/0.15.5">https://crates.io/crates/hashbrown/0.15.5</a></p>
    <p><b>Authors:</b> Amanieu d&#39;Antras &#60;amanieu@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-ae9791f02f2bbe0ce17b434753af97be6e5284b6f8e9f22db3c1f0f11b2e015a</pre>
            </details>
        
        </p>
    

    <h3>📦 hashbrown-0.16.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/hashbrown/0.16.1">https://crates.io/crates/hashbrown/0.16.1</a></p>
    <p><b>Authors:</b> Amanieu d&#39;Antras &#60;amanieu@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-ae9791f02f2bbe0ce17b434753af97be6e5284b6f8e9f22db3c1f0f11b2e015a</pre>
            </details>
        
        </p>
    

    <h3>📦 hashbrown-0.17.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/hashbrown/0.17.1">https://crates.io/crates/hashbrown/0.17.1</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-ae9791f02f2bbe0ce17b434753af97be6e5284b6f8e9f22db3c1f0f11b2e015a</pre>
            </details>
        
        </p>
    

    <h3>📦 heck-0.5.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/heck/0.5.0">https://crates.io/crates/heck/0.5.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-033a9383ff21d1e4811d98dd2e0081b0ba0d9c9a31d6c7ba9e63e3488479bf29</pre>
            </details>
        
        </p>
    

    <h3>📦 hermit-abi-0.5.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/hermit-abi/0.5.2">https://crates.io/crates/hermit-abi/0.5.2</a></p>
    <p><b>Authors:</b> Stefan Lankes</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 humantime-2.3.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/humantime/2.3.0">https://crates.io/crates/humantime/2.3.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4365cd3ca380a9b9895fb1ecba064b050fd75ee0be7b1370576e72dec597e86a</pre>
            </details>
        
        </p>
    

    <h3>📦 id-arena-2.3.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/id-arena/2.3.0">https://crates.io/crates/id-arena/2.3.0</a></p>
    <p><b>Authors:</b> Nick Fitzgerald &#60;fitzgen@gmail.com&#62;, Aleksey Kladov &#60;aleksey.kladov@gmail.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 ident_case-1.0.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/ident_case/1.0.1">https://crates.io/crates/ident_case/1.0.1</a></p>
    <p><b>Authors:</b> Ted Driggs &#60;ted.driggs@outlook.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-1847e0e0698142ed4347c1441a9fa81c8fbddd44b1d8bbcd5e3647f991759d7f</pre>
            </details>
        
        </p>
    

    <h3>📦 indexmap-1.9.3</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/indexmap/1.9.3">https://crates.io/crates/indexmap/1.9.3</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4f2ac128e429d9646bf481baaa120eb561234f980503d337c710c06d0af6bbf9</pre>
            </details>
        
        </p>
    

    <h3>📦 indexmap-2.13.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/indexmap/2.13.1">https://crates.io/crates/indexmap/2.13.1</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4f2ac128e429d9646bf481baaa120eb561234f980503d337c710c06d0af6bbf9</pre>
            </details>
        
        </p>
    

    <h3>📦 is-terminal-0.4.17</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/is-terminal/0.4.17">https://crates.io/crates/is-terminal/0.4.17</a></p>
    <p><b>Authors:</b> softprops &#60;d.tangren@gmail.com&#62;, Dan Gohman &#60;dev@sunfishcode.online&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT-atty</code></summary>
                <pre>Full notice text: stdlib-4847d869d2f9624b1eb2afafecfd37b4652098cf98c1def66038a354910a3252</pre>
            </details>
        
        </p>
    

    <h3>📦 is_terminal_polyfill-1.70.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/is_terminal_polyfill/1.70.2">https://crates.io/crates/is_terminal_polyfill/1.70.2</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 itertools-0.14.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/itertools/0.14.0">https://crates.io/crates/itertools/0.14.0</a></p>
    <p><b>Authors:</b> bluss</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-fdd1c2117bcf8157d1d013d0953c0a7e6e5fab73df9e36773cd77634428568eb</pre>
            </details>
        
        </p>
    

    <h3>📦 itoa-1.0.18</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/itoa/1.0.18">https://crates.io/crates/itoa/1.0.18</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 leb128fmt-0.1.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/leb128fmt/0.1.0">https://crates.io/crates/leb128fmt/0.1.0</a></p>
    <p><b>Authors:</b> Bryant Luk &#60;code@bryantluk.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 libc-0.2.184</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/libc/0.2.184">https://crates.io/crates/libc/0.2.184</a></p>
    <p><b>Authors:</b> The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-c96302294382bf166f3963bdbce0760aa2b9f0abaa2a7bdb296de7a1c7b51867</pre>
            </details>
        
        </p>
    

    <h3>📦 libc-0.2.185</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/libc/0.2.185">https://crates.io/crates/libc/0.2.185</a></p>
    <p><b>Authors:</b> The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-c96302294382bf166f3963bdbce0760aa2b9f0abaa2a7bdb296de7a1c7b51867</pre>
            </details>
        
        </p>
    

    <h3>📦 linked-hash-map-0.5.6</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/linked-hash-map/0.5.6">https://crates.io/crates/linked-hash-map/0.5.6</a></p>
    <p><b>Authors:</b> Stepan Koltsov &#60;stepan.koltsov@gmail.com&#62;, Andrew Paseltiner &#60;apaseltiner@gmail.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-7e1b38c60796dd9949d6f26bd124e353a4a709b70e90810e2608f30195454da0</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-033a9383ff21d1e4811d98dd2e0081b0ba0d9c9a31d6c7ba9e63e3488479bf29</pre>
            </details>
        
        </p>
    

    <h3>📦 linux-raw-sys-0.12.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/linux-raw-sys/0.12.1">https://crates.io/crates/linux-raw-sys/0.12.1</a></p>
    <p><b>Authors:</b> Dan Gohman &#60;dev@sunfishcode.online&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-7813bacdaa2b101210b073010307f381a880d6457bed79d2becf26901dc3b93f</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 log-0.4.29</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/log/0.4.29">https://crates.io/crates/log/0.4.29</a></p>
    <p><b>Authors:</b> The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 memchr-2.8.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/memchr/2.8.0">https://crates.io/crates/memchr/2.8.0</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;, bluss</p>
    <p><b>License:</b> Unlicense OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 moto-rt-0.16.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/moto-rt/0.16.0">https://crates.io/crates/moto-rt/0.16.0</a></p>
    <p><b>Authors:</b> The Motor OS Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-72d2d882bb6bfc179ccf08d58c48b766835244df8545f1cf8857b89b4ee7bd5f</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-f8885e3247e0fe7fcd7d55d8aba19c6fd9f6a318fe29b517ce0315de9d4b3975</pre>
            </details>
        
        </p>
    

    <h3>📦 once_cell-1.21.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/once_cell/1.21.4">https://crates.io/crates/once_cell/1.21.4</a></p>
    <p><b>Authors:</b> Aleksey Kladov &#60;aleksey.kladov@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 once_cell_polyfill-1.70.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/once_cell_polyfill/1.70.2">https://crates.io/crates/once_cell_polyfill/1.70.2</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9</pre>
            </details>
        
        </p>
    

    <h3>📦 ppv-lite86-0.2.21</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/ppv-lite86/0.2.21">https://crates.io/crates/ppv-lite86/0.2.21</a></p>
    <p><b>Authors:</b> The CryptoCorrosion Contributors</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-f0a559a114200228b3a06d7d22961a7e0fc21a9c2b139a970be5830cebac8e10</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-b2a541f10560a218c2a8b9506c3b5c7ac40d2c99e2d2845eae3c4cf16c70000f</pre>
            </details>
        
        </p>
    

    <h3>📦 pretty_env_logger-0.5.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/pretty_env_logger/0.5.0">https://crates.io/crates/pretty_env_logger/0.5.0</a></p>
    <p><b>Authors:</b> Sean McArthur &#60;sean@seanmonstar&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-ef31af832fed9fa9d86febbc8143a7e916482321e5de3675ef3620cbffa596d8</pre>
            </details>
        
        </p>
    

    <h3>📦 prettyplease-0.2.37</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/prettyplease/0.2.37">https://crates.io/crates/prettyplease/0.2.37</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 proc-macro2-1.0.106</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/proc-macro2/1.0.106">https://crates.io/crates/proc-macro2/1.0.106</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;, Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 quick-xml-0.33.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/quick-xml/0.33.0">https://crates.io/crates/quick-xml/0.33.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT.md</code></summary>
                <pre>Full notice text: stdlib-12bfa73c9eacbe1e22c772b2cba1f5e3195ae9fafc7773f50493a3e6e306da01</pre>
            </details>
        
        </p>
    

    <h3>📦 quick-xml-0.37.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/quick-xml/0.37.5">https://crates.io/crates/quick-xml/0.37.5</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT.md</code></summary>
                <pre>Full notice text: stdlib-12bfa73c9eacbe1e22c772b2cba1f5e3195ae9fafc7773f50493a3e6e306da01</pre>
            </details>
        
        </p>
    

    <h3>📦 quickcheck-1.1.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/quickcheck/1.1.0">https://crates.io/crates/quickcheck/1.1.0</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 quote-1.0.45</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/quote/1.0.45">https://crates.io/crates/quote/1.0.45</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 r-efi-5.3.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/r-efi/5.3.0">https://crates.io/crates/r-efi/5.3.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0 OR LGPL-2.1-or-later</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>AUTHORS</code></summary>
                <pre>Full notice text: stdlib-f30e9ee33dbf771d1066168d0d8c68401a81340f2241dd726f7891364696c7f9</pre>
            </details>
        
        </p>
    

    <h3>📦 r-efi-6.0.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/r-efi/6.0.0">https://crates.io/crates/r-efi/6.0.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0 OR LGPL-2.1-or-later</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>AUTHORS</code></summary>
                <pre>Full notice text: stdlib-3349455e35ec57383d0965d8ec4ab4789c9ba7f2540cbf5669f2b90512089913</pre>
            </details>
        
        </p>
    

    <h3>📦 r-efi-alloc-2.1.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/r-efi-alloc/2.1.0">https://crates.io/crates/r-efi-alloc/2.1.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0 OR LGPL-2.1-or-later</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>AUTHORS</code></summary>
                <pre>Full notice text: stdlib-1dd2d1cd9e6944bf69835af28cba82b7ecd0c3dd65c889336f91dd0256665156</pre>
            </details>
        
        </p>
    

    <h3>📦 rand-0.10.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand/0.10.1">https://crates.io/crates/rand/0.10.1</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand-0.9.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand/0.9.2">https://crates.io/crates/rand/0.9.2</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand-0.9.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand/0.9.4">https://crates.io/crates/rand/0.9.4</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand_chacha-0.9.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand_chacha/0.9.0">https://crates.io/crates/rand_chacha/0.9.0</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers, The CryptoCorrosion Contributors</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand_core-0.10.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand_core/0.10.0">https://crates.io/crates/rand_core/0.10.0</a></p>
    <p><b>Authors:</b> The Rand Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-c9027c55c9307b0cc5252b75c7bb74bb8fbf7270c881fa3a0a745ef742568156</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-179c83ef07a51414e7fb13941958470bbd43c072efbe9635951ebcd7583ae5d5</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-704f0e5f1c8486094f9b08e23ff0955c895dcee8d7de7390beafcad46b5dc4d5</pre>
            </details>
        
        </p>
    

    <h3>📦 rand_core-0.9.3</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand_core/0.9.3">https://crates.io/crates/rand_core/0.9.3</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-179c83ef07a51414e7fb13941958470bbd43c072efbe9635951ebcd7583ae5d5</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand_core-0.9.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand_core/0.9.5">https://crates.io/crates/rand_core/0.9.5</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-179c83ef07a51414e7fb13941958470bbd43c072efbe9635951ebcd7583ae5d5</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rand_xorshift-0.4.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rand_xorshift/0.4.0">https://crates.io/crates/rand_xorshift/0.4.0</a></p>
    <p><b>Authors:</b> The Rand Project Developers, The Rust Project Developers</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21</pre>
            </details>
        
        </p>
    

    <h3>📦 rayon-1.11.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rayon/1.11.0">https://crates.io/crates/rayon/1.11.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-9e0027807b0c548ac1df1bd85fe0d72da6665498b06ebf8a64d5cb841f39fcef</pre>
            </details>
        
        </p>
    

    <h3>📦 rayon-core-1.13.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rayon-core/1.13.0">https://crates.io/crates/rayon-core/1.13.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-9e0027807b0c548ac1df1bd85fe0d72da6665498b06ebf8a64d5cb841f39fcef</pre>
            </details>
        
        </p>
    

    <h3>📦 regex-1.12.3</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/regex/1.12.3">https://crates.io/crates/regex/1.12.3</a></p>
    <p><b>Authors:</b> The Rust Project Developers, Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 regex-automata-0.4.14</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/regex-automata/0.4.14">https://crates.io/crates/regex-automata/0.4.14</a></p>
    <p><b>Authors:</b> The Rust Project Developers, Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 regex-syntax-0.8.10</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/regex-syntax/0.8.10">https://crates.io/crates/regex-syntax/0.8.10</a></p>
    <p><b>Authors:</b> The Rust Project Developers, Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90</pre>
            </details>
        
        </p>
    

    <h3>📦 rustc-demangle-0.1.27</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rustc-demangle/0.1.27">https://crates.io/crates/rustc-demangle/0.1.27</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d</pre>
            </details>
        
        </p>
    

    <h3>📦 rustc-literal-escaper-0.0.8</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rustc-literal-escaper/0.0.8">https://crates.io/crates/rustc-literal-escaper/0.0.8</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 rustix-1.1.4</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/rustix/1.1.4">https://crates.io/crates/rustix/1.1.4</a></p>
    <p><b>Authors:</b> Dan Gohman &#60;dev@sunfishcode.online&#62;, Jakub Konka &#60;kubkon@jakubkonka.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-fde2a68c47d279384c0113efbc29bb43e263dd4cb33137c87365b0218a11d6aa</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 ryu-1.0.23</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/ryu/1.0.23">https://crates.io/crates/ryu/1.0.23</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> Apache-2.0 OR BSL-1.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-BOOST</code></summary>
                <pre>Full notice text: stdlib-8d8291caf1cee26d23acf3eb67c9f9a2d58f1c681b16a4fbe8cbfb9e3c0b5a9b</pre>
            </details>
        
        </p>
    

    <h3>📦 same-file-1.0.6</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/same-file/1.0.6">https://crates.io/crates/same-file/1.0.6</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense/MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-739620ea44ad8f99e96ea272e583b63a7d44a83a71250d7550b2544ea6b49fbf</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 semver-1.0.28</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/semver/1.0.28">https://crates.io/crates/semver/1.0.28</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 serde-1.0.228</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde/1.0.228">https://crates.io/crates/serde/1.0.228</a></p>
    <p><b>Authors:</b> Erick Tryzelaar &#60;erick.tryzelaar@gmail.com&#62;, David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 serde-xml-rs-0.8.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde-xml-rs/0.8.2">https://crates.io/crates/serde-xml-rs/0.8.2</a></p>
    <p><b>Authors:</b> Ingvar Stepanyan &#60;me@rreverser.com&#62;, William Bartlett &#60;bartlettstarman@gmail.com&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-32a0924adcc1b3b8db75b1352cb1d3bc0641a4731dfa96436d74dc3d001d3904</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_core-1.0.228</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_core/1.0.228">https://crates.io/crates/serde_core/1.0.228</a></p>
    <p><b>Authors:</b> Erick Tryzelaar &#60;erick.tryzelaar@gmail.com&#62;, David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_derive-1.0.228</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_derive/1.0.228">https://crates.io/crates/serde_derive/1.0.228</a></p>
    <p><b>Authors:</b> Erick Tryzelaar &#60;erick.tryzelaar@gmail.com&#62;, David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_json-1.0.149</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_json/1.0.149">https://crates.io/crates/serde_json/1.0.149</a></p>
    <p><b>Authors:</b> Erick Tryzelaar &#60;erick.tryzelaar@gmail.com&#62;, David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_with-3.18.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_with/3.18.0">https://crates.io/crates/serde_with/3.18.0</a></p>
    <p><b>Authors:</b> Jonas Bushart, Marcin Kaźmierczak</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-fdd1c2117bcf8157d1d013d0953c0a7e6e5fab73df9e36773cd77634428568eb</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_with_macros-3.18.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_with_macros/3.18.0">https://crates.io/crates/serde_with_macros/3.18.0</a></p>
    <p><b>Authors:</b> Jonas Bushart</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-fdd1c2117bcf8157d1d013d0953c0a7e6e5fab73df9e36773cd77634428568eb</pre>
            </details>
        
        </p>
    

    <h3>📦 serde_yaml-0.8.26</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/serde_yaml/0.8.26">https://crates.io/crates/serde_yaml/0.8.26</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 shlex-1.3.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/shlex/1.3.0">https://crates.io/crates/shlex/1.3.0</a></p>
    <p><b>Authors:</b> comex &#60;comexk@gmail.com&#62;, Fenhl &#60;fenhl@fenhl.net&#62;, Adrian Taylor &#60;adetaylor@chromium.org&#62;, Alex Touchet &#60;alextouchet@outlook.com&#62;, Daniel Parks &#60;dp+git@oxidized.org&#62;, Garrett Berg &#60;googberg@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-a759ce38c686a2042f62a0a6b8ea01781e3447726dcb68f4bb8b9f199feff12e</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-cc5ba5589dfb7bbc1545df0cd433427aac08b1cdf3484161d6785996317b8c3c</pre>
            </details>
        
        </p>
    

    <h3>📦 strsim-0.11.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/strsim/0.11.1">https://crates.io/crates/strsim/0.11.1</a></p>
    <p><b>Authors:</b> Danny Guo &#60;danny@dannyguo.com&#62;, maxbachmann &#60;oss@maxbachmann.de&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-8fd8980cab8977a58aecdb4c48857aa6b70a64250cc923b3eeb0ecd903c51def</pre>
            </details>
        
        </p>
    

    <h3>📦 syn-2.0.117</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/syn/2.0.117">https://crates.io/crates/syn/2.0.117</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 syscalls-0.6.18</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/syscalls/0.6.18">https://crates.io/crates/syscalls/0.6.18</a></p>
    <p><b>Authors:</b> Jason White &#60;rust@jasonwhite.io&#62;, Baojun Wang &#60;wangbj@gmail.com&#62;</p>
    <p><b>License:</b> BSD-2-Clause</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-63a6760390f1b55e9ba342113a5b5027d442468c7b8c38955096da331a21d170</pre>
            </details>
        
        </p>
    

    <h3>📦 tempfile-3.27.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/tempfile/3.27.0">https://crates.io/crates/tempfile/3.27.0</a></p>
    <p><b>Authors:</b> Steven Allen &#60;steven@stebalien.com&#62;, The Rust Project Developers, Ashley Mannix &#60;ashleymannix@live.com.au&#62;, Jason White &#60;me@jasonwhite.io&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-7bdd5c5e8ad0c973e00ae0cc281ad93c5991cae17dcee281198a625475beb3dc</pre>
            </details>
        
        </p>
    

    <h3>📦 termcolor-1.4.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/termcolor/1.4.1">https://crates.io/crates/termcolor/1.4.1</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 thiserror-2.0.18</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/thiserror/2.0.18">https://crates.io/crates/thiserror/2.0.18</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 thiserror-impl-2.0.18</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/thiserror-impl/2.0.18">https://crates.io/crates/thiserror-impl/2.0.18</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 unicode-ident-1.0.24</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/unicode-ident/1.0.24">https://crates.io/crates/unicode-ident/1.0.24</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> (MIT OR Apache-2.0) AND Unicode-3.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-UNICODE</code></summary>
                <pre>Full notice text: stdlib-361d7912957842f2ce61c774b14afba41ae91df84882982e6f7e749e01c07c91</pre>
            </details>
        
        </p>
    

    <h3>📦 unicode-xid-0.2.6</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/unicode-xid/0.2.6">https://crates.io/crates/unicode-xid/0.2.6</a></p>
    <p><b>Authors:</b> erick.tryzelaar &#60;erick.tryzelaar@gmail.com&#62;, kwantam &#60;kwantam@gmail.com&#62;, Manish Goregaokar &#60;manishsmail@gmail.com&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>COPYRIGHT</code></summary>
                <pre>Full notice text: stdlib-20cec30ad77804372faa6c82e5a1a4be426a75e32808a159ef646c2037649071</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-033a9383ff21d1e4811d98dd2e0081b0ba0d9c9a31d6c7ba9e63e3488479bf29</pre>
            </details>
        
        </p>
    

    <h3>📦 unwinding-0.2.8</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/unwinding/0.2.8">https://crates.io/crates/unwinding/0.2.8</a></p>
    <p><b>Authors:</b> Gary Guo &#60;gary@garyguo.net&#62;</p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 utf8parse-0.2.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/utf8parse/0.2.2">https://crates.io/crates/utf8parse/0.2.2</a></p>
    <p><b>Authors:</b> Joe Wilm &#60;joe@jwilm.com&#62;, Christian Duerr &#60;contact@christianduerr.com&#62;</p>
    <p><b>License:</b> Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-db2c904eb5685e69d3ea20f1f8187c8ed82b44077221fd99c4a68234739de941</pre>
            </details>
        
        </p>
    

    <h3>📦 vex-sdk-0.27.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/vex-sdk/0.27.1">https://crates.io/crates/vex-sdk/0.27.1</a></p>
    <p><b>Authors:</b> Tropical</p>
    <p><b>License:</b> MIT</p>
    
    

    <h3>📦 walkdir-2.5.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/walkdir/2.5.0">https://crates.io/crates/walkdir/2.5.0</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense/MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 wasip1-1.0.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasip1/1.0.0">https://crates.io/crates/wasip1/1.0.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasip2-1.0.2+wasi-0.2.9</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasip2/1.0.2+wasi-0.2.9">https://crates.io/crates/wasip2/1.0.2+wasi-0.2.9</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasip2-1.0.3+wasi-0.2.9</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasip2/1.0.3+wasi-0.2.9">https://crates.io/crates/wasip2/1.0.3+wasi-0.2.9</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wasip3-0.4.0+wasi-0.3.0-rc-2026-01-06</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasip3/0.4.0+wasi-0.3.0-rc-2026-01-06">https://crates.io/crates/wasip3/0.4.0+wasi-0.3.0-rc-2026-01-06</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasip3-0.6.0+wasi-0.3.0-rc-2026-03-15</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasip3/0.6.0+wasi-0.3.0-rc-2026-03-15">https://crates.io/crates/wasip3/0.6.0+wasi-0.3.0-rc-2026-03-15</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wasm-encoder-0.244.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasm-encoder/0.244.0">https://crates.io/crates/wasm-encoder/0.244.0</a></p>
    <p><b>Authors:</b> Nick Fitzgerald &#60;fitzgen@gmail.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasm-metadata-0.244.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasm-metadata/0.244.0">https://crates.io/crates/wasm-metadata/0.244.0</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasmparser-0.235.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasmparser/0.235.0">https://crates.io/crates/wasmparser/0.235.0</a></p>
    <p><b>Authors:</b> Yury Delendik &#60;ydelendik@mozilla.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasmparser-0.244.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasmparser/0.244.0">https://crates.io/crates/wasmparser/0.244.0</a></p>
    <p><b>Authors:</b> Yury Delendik &#60;ydelendik@mozilla.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wasmprinter-0.235.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wasmprinter/0.235.0">https://crates.io/crates/wasmprinter/0.235.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 winapi-util-0.1.11</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/winapi-util/0.1.11">https://crates.io/crates/winapi-util/0.1.11</a></p>
    <p><b>Authors:</b> Andrew Gallant &#60;jamslam@gmail.com&#62;</p>
    <p><b>License:</b> Unlicense OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-739620ea44ad8f99e96ea272e583b63a7d44a83a71250d7550b2544ea6b49fbf</pre>
            </details>
        
            <details>
                <summary><code>UNLICENSE</code></summary>
                <pre>Full notice text: stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83</pre>
            </details>
        
        </p>
    

    <h3>📦 windows-link-0.2.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/windows-link/0.2.1">https://crates.io/crates/windows-link/0.2.1</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>license-apache-2.0</code></summary>
                <pre>Full notice text: stdlib-783829b43aacb86cb8e6cedcd777210c13f2081aae94419cc7a30e112977d488</pre>
            </details>
        
            <details>
                <summary><code>license-mit</code></summary>
                <pre>Full notice text: stdlib-ff82c90f84945c60601e96b43246009b9bc589f3ebe1cd8a0fd39a3520d8c310</pre>
            </details>
        
        </p>
    

    <h3>📦 windows-sys-0.61.2</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/windows-sys/0.61.2">https://crates.io/crates/windows-sys/0.61.2</a></p>
    <p><b>Authors:</b> </p>
    <p><b>License:</b> MIT OR Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>license-apache-2.0</code></summary>
                <pre>Full notice text: stdlib-783829b43aacb86cb8e6cedcd777210c13f2081aae94419cc7a30e112977d488</pre>
            </details>
        
            <details>
                <summary><code>license-mit</code></summary>
                <pre>Full notice text: stdlib-ff82c90f84945c60601e96b43246009b9bc589f3ebe1cd8a0fd39a3520d8c310</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-bindgen-0.51.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-bindgen/0.51.0">https://crates.io/crates/wit-bindgen/0.51.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-bindgen-0.57.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-bindgen/0.57.1">https://crates.io/crates/wit-bindgen/0.57.1</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-bindgen-core-0.51.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-bindgen-core/0.51.0">https://crates.io/crates/wit-bindgen-core/0.51.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-bindgen-rust-0.51.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-bindgen-rust/0.51.0">https://crates.io/crates/wit-bindgen-rust/0.51.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-bindgen-rust-macro-0.51.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-bindgen-rust-macro/0.51.0">https://crates.io/crates/wit-bindgen-rust-macro/0.51.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-Apache-2.0_WITH_LLVM-exception</code></summary>
                <pre>Full notice text: stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

    <h3>📦 wit-component-0.244.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-component/0.244.0">https://crates.io/crates/wit-component/0.244.0</a></p>
    <p><b>Authors:</b> Peter Huene &#60;peter@huene.dev&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 wit-parser-0.244.0</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/wit-parser/0.244.0">https://crates.io/crates/wit-parser/0.244.0</a></p>
    <p><b>Authors:</b> Alex Crichton &#60;alex@alexcrichton.com&#62;</p>
    <p><b>License:</b> Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT</p>
    
    

    <h3>📦 xml-1.2.1</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/xml/1.2.1">https://crates.io/crates/xml/1.2.1</a></p>
    <p><b>Authors:</b> Vladimir Matveev &#60;vmatveev@citrine.cc&#62;, Kornel (https://github.com/kornelski)</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE</code></summary>
                <pre>Full notice text: stdlib-06250c7066bcd3f947667887383bf797d5c128d53e27d140fadc461adacdadf1</pre>
            </details>
        
        </p>
    

    <h3>📦 yaml-rust-0.4.5</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/yaml-rust/0.4.5">https://crates.io/crates/yaml-rust/0.4.5</a></p>
    <p><b>Authors:</b> Yuheng Chen &#60;yuhengchen@sensetime.com&#62;</p>
    <p><b>License:</b> MIT/Apache-2.0</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-f853326256f7bf7c9ccf67315b1a6fd3aaa173a8dab6c2ec55bf23defa98bcac</pre>
            </details>
        
        </p>
    

    <h3>📦 zerocopy-0.8.48</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/zerocopy/0.8.48">https://crates.io/crates/zerocopy/0.8.48</a></p>
    <p><b>Authors:</b> Joshua Liebow-Feeser &#60;joshlf@google.com&#62;, Jack Wrenn &#60;jswrenn@amazon.com&#62;</p>
    <p><b>License:</b> BSD-2-Clause OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-98ed0ad9db8a72957b9c45941fe2ed31933a3beacbd193e662df483d0643a13d</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-BSD</code></summary>
                <pre>Full notice text: stdlib-47248d1ec833e0771ddacb65f2cf9978785f4a9976b5b0b69d1e33c60a50be55</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-a03d4daa4f46496a592dbf6734f5ee16ed52f1eb7a56ae4648d609ebf0efd0b7</pre>
            </details>
        
        </p>
    

    <h3>📦 zerocopy-derive-0.8.48</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/zerocopy-derive/0.8.48">https://crates.io/crates/zerocopy-derive/0.8.48</a></p>
    <p><b>Authors:</b> Joshua Liebow-Feeser &#60;joshlf@google.com&#62;, Jack Wrenn &#60;jswrenn@amazon.com&#62;</p>
    <p><b>License:</b> BSD-2-Clause OR Apache-2.0 OR MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-APACHE</code></summary>
                <pre>Full notice text: stdlib-98ed0ad9db8a72957b9c45941fe2ed31933a3beacbd193e662df483d0643a13d</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-BSD</code></summary>
                <pre>Full notice text: stdlib-47248d1ec833e0771ddacb65f2cf9978785f4a9976b5b0b69d1e33c60a50be55</pre>
            </details>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-a03d4daa4f46496a592dbf6734f5ee16ed52f1eb7a56ae4648d609ebf0efd0b7</pre>
            </details>
        
        </p>
    

    <h3>📦 zmij-1.0.21</h3>
    <p><b>URL:</b> <a href="https://crates.io/crates/zmij/1.0.21">https://crates.io/crates/zmij/1.0.21</a></p>
    <p><b>Authors:</b> David Tolnay &#60;dtolnay@gmail.com&#62;</p>
    <p><b>License:</b> MIT</p>
    
    
        <p><b>Notices:</b>
        
            <details>
                <summary><code>LICENSE-MIT</code></summary>
                <pre>Full notice text: stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652</pre>
            </details>
        
        </p>
    

</body>
</html>
```

### stdlib-154c1af2b38e25e5c18613dfe352eed29b0863cb39e494007822cdeb39150ac5

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### stdlib-ca2abdf695884c77ea4b4a5b64ca7b732d9d9dbade4eebc1c2e76c53e9e3bc83

```text
This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <http://unlicense.org/>
```

### stdlib-6dc0e068dcf3a5bc8e054205b85b7720e1d49265bbc64bf515d2cf79197df69a

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "{}"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {yyyy} {name of copyright owner}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### stdlib-4498464c2864825d7bb4c83e2ac4e9dbb533d49964fbf218c24f8d44ee4e87a9

```text
Copyright (c) Individual contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-85ad950cce8752f716dbf49be95b2639172cb49f291336d57f1fdc9989e38179

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### stdlib-30fefc3a7d6a0041541858293bcbea2dde4caa4c0a5802f996a7f7e8c0085652

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-954f335b8baf5e1a5748b3a1bf6eeb2ec0b28ae19813f02063d64be005765a76

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-99afaa30c17801207692138b8a7d9f7522b52711dabb4cde25855dadc950e4c8

```text
Copyright (c) 2018 Josh Stone

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-14435fbcd271e2783f721b57b7bf4f6502c1379249a4300e0e5bb774686c2d90

```text
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-84e1bbfebd74e4196cfa0ea5cf58e677aa24b47c6661adbb19fb07920d089d1d

```text
Copyright (c) 2014 Alex Crichton

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-5a7d13c6710cdec29e74eb3172b80712049c34099ab7259661ada051fc90777b

```text
The MIT License (MIT)

Copyright (c) 2019 The Crossbeam Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-cc8f3c8ab396de7fa549e3907319281cf13d0a4a456a2b0695c5b61d877dba68

```text
MIT License

Copyright (c) 2017 Ted Driggs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-68d40a93aa2c4ac04cb077d066023a54e9285491f78e63171a99176af32c4440

```text
MIT License

Copyright (c) 2015 Utkarsh Kukreti

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-fdd1c2117bcf8157d1d013d0953c0a7e6e5fab73df9e36773cd77634428568eb

```text
Copyright (c) 2015

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-4428cd87371acbd49f9f6380125492cd1e89df621d2fd7f55e30a0891f96a433

```text
Copyright (c) 2016--2023

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-7f91c2a4eddb48282e1f4c1e6a8f9e7d1842655212bcb9b5c0f9f8044aaf0ac5

```text
Copyright (c) 2014 Chris Wong

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-b1181a40b2a7b25cf66fd01481713bc1005df082c53ef73e851e55071b102744

```text
Copyright (c) 2024 Orson Peters

This software is provided 'as-is', without any express or implied warranty. In
no event will the authors be held liable for any damages arising from the use of
this software.

Permission is granted to anyone to use this software for any purpose, including
commercial applications, and to alter it and redistribute it freely, subject to
the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim
    that you wrote the original software. If you use this software in a product,
    an acknowledgment in the product documentation would be appreciated but is
    not required.

2. Altered source versions must be plainly marked as such, and must not be
    misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```

### stdlib-e7330bf53074b4a9c5896f4a03d782be7f163381e45923d5e2369fe194a19f99

```text
Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-73af2019a565c0e6d05ae4ad97bf9c1815f75b7d559ec2c3c5abebf60444b040

```text
Copyright (c) 2018-2025 The rust-random Project Developers
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-94b1870d380ccf537d5bdfda2de882965c9afb814acc375cb1b47fc1a0014ee3

```text
Copyright (c) 2018-2026 The rust-random Project Developers
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-033a9383ff21d1e4811d98dd2e0081b0ba0d9c9a31d6c7ba9e63e3488479bf29

```text
Copyright (c) 2015 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-ae9791f02f2bbe0ce17b434753af97be6e5284b6f8e9f22db3c1f0f11b2e015a

```text
Copyright (c) 2016 Amanieu d'Antras

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-4365cd3ca380a9b9895fb1ecba064b050fd75ee0be7b1370576e72dec597e86a

```text
Copyright (c) 2016 The humantime Developers

Includes parts of http date with the following copyright:
Copyright (c) 2016 Pyfisch

Includes portions of musl libc with the following copyright:
Copyright © 2005-2013 Rich Felker


Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-1847e0e0698142ed4347c1441a9fa81c8fbddd44b1d8bbcd5e3647f991759d7f

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-4f2ac128e429d9646bf481baaa120eb561234f980503d337c710c06d0af6bbf9

```text
Copyright (c) 2016--2017

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-4847d869d2f9624b1eb2afafecfd37b4652098cf98c1def66038a354910a3252

```text
Portions of this project are derived from atty, which bears the following
copyright notice and permission notice:

Copyright (c) 2015-2019 Doug Tangren

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### stdlib-c96302294382bf166f3963bdbce0760aa2b9f0abaa2a7bdb296de7a1c7b51867

```text
Copyright (c) The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-7e1b38c60796dd9949d6f26bd124e353a4a709b70e90810e2608f30195454da0

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-7813bacdaa2b101210b073010307f381a880d6457bed79d2becf26901dc3b93f

```text
Short version for non-lawyers:

`linux-raw-sys` is triple-licensed under Apache 2.0 with the LLVM Exception,
Apache 2.0, and MIT terms.


Longer version:

Copyrights in the `linux-raw-sys` project are retained by their contributors.
No copyright assignment is required to contribute to the `linux-raw-sys`
project.

Some files include code derived from Rust's `libstd`; see the comments in
the code for details.

Except as otherwise noted (below and/or in individual files), `linux-raw-sys`
is licensed under:

 - the Apache License, Version 2.0, with the LLVM Exception
   <LICENSE-Apache-2.0_WITH_LLVM-exception> or
   <http://llvm.org/foundation/relicensing/LICENSE.txt>
 - the Apache License, Version 2.0
   <LICENSE-APACHE> or
   <http://www.apache.org/licenses/LICENSE-2.0>,
 - or the MIT license
   <LICENSE-MIT> or
   <http://opensource.org/licenses/MIT>,

at your option.
```

### stdlib-2f213ec6b1355dc841dc489c9e7ce1dddd07611df474efcf61b8a960797398e9

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.


--- LLVM Exceptions to the Apache 2.0 License ----

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.
```

### stdlib-72d2d882bb6bfc179ccf08d58c48b766835244df8545f1cf8857b89b4ee7bd5f

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright 2023 The Motor OS Project Developers

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-f8885e3247e0fe7fcd7d55d8aba19c6fd9f6a318fe29b517ce0315de9d4b3975

```text
Copyright (c) 2023 The Motor OS Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-f0a559a114200228b3a06d7d22961a7e0fc21a9c2b139a970be5830cebac8e10

```text
Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright 2019 The CryptoCorrosion Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-b2a541f10560a218c2a8b9506c3b5c7ac40d2c99e2d2845eae3c4cf16c70000f

```text
Copyright (c) 2019 The CryptoCorrosion Contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-ef31af832fed9fa9d86febbc8143a7e916482321e5de3675ef3620cbffa596d8

```text
Copyright (c) 2017 Sean McArthur

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### stdlib-12bfa73c9eacbe1e22c772b2cba1f5e3195ae9fafc7773f50493a3e6e306da01

```text
The MIT License (MIT)

Copyright (c) 2016 Johann Tuffe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:


The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### stdlib-f30e9ee33dbf771d1066168d0d8c68401a81340f2241dd726f7891364696c7f9

```text
LICENSE:
        This project is triple-licensed under the MIT License, the Apache
        License, Version 2.0, and the GNU Lesser General Public License,
        Version 2.1+.

AUTHORS-MIT:
        Permission is hereby granted, free of charge, to any person obtaining a
        copy of this software and associated documentation files (the
        "Software"), to deal in the Software without restriction, including
        without limitation the rights to use, copy, modify, merge, publish,
        distribute, sublicense, and/or sell copies of the Software, and to
        permit persons to whom the Software is furnished to do so, subject to
        the following conditions:

        The above copyright notice and this permission notice shall be included
        in all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
        CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
        TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

AUTHORS-ASL:
        Licensed under the Apache License, Version 2.0 (the "License");
        you may not use this file except in compliance with the License.
        You may obtain a copy of the License at

                http://www.apache.org/licenses/LICENSE-2.0

        Unless required by applicable law or agreed to in writing, software
        distributed under the License is distributed on an "AS IS" BASIS,
        WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
        See the License for the specific language governing permissions and
        limitations under the License.

AUTHORS-LGPL:
        This program is free software; you can redistribute it and/or modify it
        under the terms of the GNU Lesser General Public License as published
        by the Free Software Foundation; either version 2.1 of the License, or
        (at your option) any later version.

        This program is distributed in the hope that it will be useful, but
        WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
        Lesser General Public License for more details.

        You should have received a copy of the GNU Lesser General Public License
        along with this program; If not, see <http://www.gnu.org/licenses/>.

COPYRIGHT: (ordered alphabetically)
        Copyright (C) 2017-2023 Red Hat, Inc.
        Copyright (C) 2019-2023 Microsoft Corporation
        Copyright (C) 2022-2023 David Rheinsberg

AUTHORS: (ordered alphabetically)
        Alex James <theracermaster@gmail.com>
        Ayush Singh <ayushsingh1325@gmail.com>
        Boris-Chengbiao Zhou <bobo1239@web.de>
        Bret Barkelew <bret@corthon.com>
        Christopher Zurcher <christopher.zurcher@microsoft.com>
        David Rheinsberg <david@readahead.eu>
        Dmitry Mostovenko <trueberserker@gmail.com>
        Hiroki Tokunaga <tokusan441@gmail.com>
        Joe Richey <joerichey@google.com>
        John Schock <joschock@microsoft.com>
        Michael Kubacki <michael.kubacki@microsoft.com>
        Oliver Smith-Denny <osde@microsoft.com>
        Richard Wiedenhöft <richard@wiedenhoeft.xyz>
        Rob Bradford <robert.bradford@intel.com>, <rbradford@rivosinc.com>
        Tom Gundersen <teg@jklm.no>
        Trevor Gross <tmgross@umich.edu>
```

### stdlib-3349455e35ec57383d0965d8ec4ab4789c9ba7f2540cbf5669f2b90512089913

```text
LICENSE:
        This project is triple-licensed under the MIT License, the Apache
        License, Version 2.0, and the GNU Lesser General Public License,
        Version 2.1+.

AUTHORS-MIT:
        Permission is hereby granted, free of charge, to any person obtaining a
        copy of this software and associated documentation files (the
        "Software"), to deal in the Software without restriction, including
        without limitation the rights to use, copy, modify, merge, publish,
        distribute, sublicense, and/or sell copies of the Software, and to
        permit persons to whom the Software is furnished to do so, subject to
        the following conditions:

        The above copyright notice and this permission notice shall be included
        in all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
        CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
        TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

AUTHORS-ASL:
        Licensed under the Apache License, Version 2.0 (the "License");
        you may not use this file except in compliance with the License.
        You may obtain a copy of the License at

                http://www.apache.org/licenses/LICENSE-2.0

        Unless required by applicable law or agreed to in writing, software
        distributed under the License is distributed on an "AS IS" BASIS,
        WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
        See the License for the specific language governing permissions and
        limitations under the License.

AUTHORS-LGPL:
        This program is free software; you can redistribute it and/or modify it
        under the terms of the GNU Lesser General Public License as published
        by the Free Software Foundation; either version 2.1 of the License, or
        (at your option) any later version.

        This program is distributed in the hope that it will be useful, but
        WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
        Lesser General Public License for more details.

        You should have received a copy of the GNU Lesser General Public License
        along with this program; If not, see <http://www.gnu.org/licenses/>.

COPYRIGHT: (ordered alphabetically)
        Copyright (C) 2017-2023 Red Hat, Inc.
        Copyright (C) 2019-2023 Microsoft Corporation
        Copyright (C) 2022-2023 David Rheinsberg

AUTHORS: (ordered alphabetically)
        Alan Egerton <eggyal@gmail.com>
        Alex James <theracermaster@gmail.com>
        Ayush Singh <ayushsingh1325@gmail.com>
        Boris-Chengbiao Zhou <bobo1239@web.de>
        Bret Barkelew <bret@corthon.com>
        Christopher Zurcher <christopher.zurcher@microsoft.com>
        David Rheinsberg <david@readahead.eu>
        Dmitry Mostovenko <trueberserker@gmail.com>
        Hiroki Tokunaga <tokusan441@gmail.com>
        Joe Richey <joerichey@google.com>
        John Schock <joschock@microsoft.com>
        Michael Kubacki <michael.kubacki@microsoft.com>
        Oliver Smith-Denny <osde@microsoft.com>
        Richard Wiedenhöft <richard@wiedenhoeft.xyz>
        Rob Bradford <robert.bradford@intel.com>, <rbradford@rivosinc.com>
        Tom Gundersen <teg@jklm.no>
        Trevor Gross <tmgross@umich.edu>
```

### stdlib-1dd2d1cd9e6944bf69835af28cba82b7ecd0c3dd65c889336f91dd0256665156

```text
LICENSE:
        This project is triple-licensed under the MIT License, the Apache
        License, Version 2.0, and the GNU Lesser General Public License,
        Version 2.1+.

AUTHORS-MIT:
        Permission is hereby granted, free of charge, to any person obtaining a
        copy of this software and associated documentation files (the
        "Software"), to deal in the Software without restriction, including
        without limitation the rights to use, copy, modify, merge, publish,
        distribute, sublicense, and/or sell copies of the Software, and to
        permit persons to whom the Software is furnished to do so, subject to
        the following conditions:

        The above copyright notice and this permission notice shall be included
        in all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
        OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
        IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
        CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
        TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
        SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

AUTHORS-ASL:
        Licensed under the Apache License, Version 2.0 (the "License");
        you may not use this file except in compliance with the License.
        You may obtain a copy of the License at

                http://www.apache.org/licenses/LICENSE-2.0

        Unless required by applicable law or agreed to in writing, software
        distributed under the License is distributed on an "AS IS" BASIS,
        WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
        See the License for the specific language governing permissions and
        limitations under the License.

AUTHORS-LGPL:
        This program is free software; you can redistribute it and/or modify it
        under the terms of the GNU Lesser General Public License as published
        by the Free Software Foundation; either version 2.1 of the License, or
        (at your option) any later version.

        This program is distributed in the hope that it will be useful, but
        WITHOUT ANY WARRANTY; without even the implied warranty of
        MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
        Lesser General Public License for more details.

        You should have received a copy of the GNU Lesser General Public License
        along with this program; If not, see <http://www.gnu.org/licenses/>.

COPYRIGHT: (ordered alphabetically)
        Copyright (C) 2017-2022 Red Hat, Inc.
        Copyright (C) 2022-2025 David Rheinsberg

AUTHORS: (ordered alphabetically)
        Ayush Singh <ayushsingh1325@gmail.com>
        David Rheinsberg <david@readahead.eu>
        Mizuho MORI <morimolymoly@gmail.com>
        Tom Gundersen <teg@jklm.no>
        Trevor Gross <tmgross@umich.edu>
```

### stdlib-2411d70acb18e15ac32f7aace439a5c2725b8d0074510caf651d4c270d7c05aa

```text
Copyrights in the Rand project are retained by their contributors. No
copyright assignment is required to contribute to the Rand project.

For full authorship information, see the version control history.

Except as otherwise noted (below and/or in individual files), Rand is
licensed under the Apache License, Version 2.0 <LICENSE-APACHE> or
<http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
<LICENSE-MIT> or <http://opensource.org/licenses/MIT>, at your option.

The Rand project includes code from the Rust project
published under these same licenses.
```

### stdlib-fee4d7ce394c9161daabd2797e22d8d5ed80ea3c0f4524b242ab22582d2cc412

```text
Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```

### stdlib-cc367a7134c2b07d995a2f8dea591094a1d100e49c68513f729fdf3eaf580a21

```text
Copyright 2018 Developers of the Rand project
Copyright (c) 2014 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-c9027c55c9307b0cc5252b75c7bb74bb8fbf7270c881fa3a0a745ef742568156

```text
Copyrights in the Rand project are retained by their contributors. No
copyright assignment is required to contribute to the Rand project.

For full authorship information, see the version control history.

Except as otherwise noted (below and/or in individual files), Rand is
licensed under the Apache License, Version 2.0 <LICENSE-APACHE> or
<http://www.apache.org/licenses/LICENSE-2.0> or the MIT license
<LICENSE-MIT> or <http://opensource.org/licenses/MIT>, at your option.
```

### stdlib-179c83ef07a51414e7fb13941958470bbd43c072efbe9635951ebcd7583ae5d5

```text
Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.
```

### stdlib-704f0e5f1c8486094f9b08e23ff0955c895dcee8d7de7390beafcad46b5dc4d5

```text
Copyright (c) 2018-2026 The Rand Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-9e0027807b0c548ac1df1bd85fe0d72da6665498b06ebf8a64d5cb841f39fcef

```text
Copyright (c) 2010 The Rust Project Developers

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-fde2a68c47d279384c0113efbc29bb43e263dd4cb33137c87365b0218a11d6aa

```text
Short version for non-lawyers:

`rustix` is triple-licensed under Apache 2.0 with the LLVM Exception,
Apache 2.0, and MIT terms.


Longer version:

Copyrights in the `rustix` project are retained by their contributors.
No copyright assignment is required to contribute to the `rustix`
project.

Some files include code derived from Rust's `libstd`; see the comments in
the code for details.

Except as otherwise noted (below and/or in individual files), `rustix`
is licensed under:

 - the Apache License, Version 2.0, with the LLVM Exception
   <LICENSE-Apache-2.0_WITH_LLVM-exception> or
   <http://llvm.org/foundation/relicensing/LICENSE.txt>
 - the Apache License, Version 2.0
   <LICENSE-APACHE> or
   <http://www.apache.org/licenses/LICENSE-2.0>,
 - or the MIT license
   <LICENSE-MIT> or
   <http://opensource.org/licenses/MIT>,

at your option.
```

### stdlib-8d8291caf1cee26d23acf3eb67c9f9a2d58f1c681b16a4fbe8cbfb9e3c0b5a9b

```text
Boost Software License - Version 1.0 - August 17th, 2003

Permission is hereby granted, free of charge, to any person or organization
obtaining a copy of the software and accompanying documentation covered by
this license (the "Software") to use, reproduce, display, distribute,
execute, and transmit the Software, and to prepare derivative works of the
Software, and to permit third-parties to whom the Software is furnished to
do so, all subject to the following:

The copyright notices in the Software and this entire statement, including
the above license grant, this restriction and the following disclaimer,
must be included in all copies of the Software, in whole or in part, and
all derivative works of the Software, unless such copies or derivative
works are solely in the form of machine-executable object code generated by
a source language processor.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT. IN NO EVENT
SHALL THE COPYRIGHT HOLDERS OR ANYONE DISTRIBUTING THE SOFTWARE BE LIABLE
FOR ANY DAMAGES OR OTHER LIABILITY, WHETHER IN CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-739620ea44ad8f99e96ea272e583b63a7d44a83a71250d7550b2544ea6b49fbf

```text
The MIT License (MIT)

Copyright (c) 2017 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### stdlib-32a0924adcc1b3b8db75b1352cb1d3bc0641a4731dfa96436d74dc3d001d3904

```text
MIT License

Copyright (c) 2017 Ingvar Stepanyan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-a759ce38c686a2042f62a0a6b8ea01781e3447726dcb68f4bb8b9f199feff12e

```text
Copyright 2015 Nicholas Allegra (comex).

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### stdlib-cc5ba5589dfb7bbc1545df0cd433427aac08b1cdf3484161d6785996317b8c3c

```text
The MIT License (MIT)

Copyright (c) 2015 Nicholas Allegra (comex).

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### stdlib-8fd8980cab8977a58aecdb4c48857aa6b70a64250cc923b3eeb0ecd903c51def

```text
The MIT License (MIT)

Copyright (c) 2015 Danny Guo
Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com>
Copyright (c) 2018 Akash Kurdekar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-63a6760390f1b55e9ba342113a5b5027d442468c7b8c38955096da331a21d170

```text
The below Copyright and License apply uniformly to all files in this
repository, unless a different copyright/license is mentioned
explicitly.

Copyright (c) 2020-2021, Jason White
Copyright (c) 2018-2019, Trustees of Indiana University
    ("University Works" via Baojun Wang)
Copyright (c) 2018-2019, Ryan Newton
    ("Traditional Works of Scholarship")

All rights reserved.

BSD 2-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### stdlib-7bdd5c5e8ad0c973e00ae0cc281ad93c5991cae17dcee281198a625475beb3dc

```text
Copyright (c) 2015 Steven Allen

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-361d7912957842f2ce61c774b14afba41ae91df84882982e6f7e749e01c07c91

```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2023 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```

### stdlib-20cec30ad77804372faa6c82e5a1a4be426a75e32808a159ef646c2037649071

```text
Licensed under the Apache License, Version 2.0
<LICENSE-APACHE or
http://www.apache.org/licenses/LICENSE-2.0> or the MIT
license <LICENSE-MIT or http://opensource.org/licenses/MIT>,
at your option. All files in the project carrying such
notice may not be copied, modified, or distributed except
according to those terms.
```

### stdlib-db2c904eb5685e69d3ea20f1f8187c8ed82b44077221fd99c4a68234739de941

```text
Copyright (c) 2016 Joe Wilm

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### stdlib-783829b43aacb86cb8e6cedcd777210c13f2081aae94419cc7a30e112977d488

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright (c) Microsoft Corporation.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### stdlib-ff82c90f84945c60601e96b43246009b9bc589f3ebe1cd8a0fd39a3520d8c310

```text
MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

### stdlib-06250c7066bcd3f947667887383bf797d5c128d53e27d140fadc461adacdadf1

```text
The MIT License (MIT)

Copyright (c) 2014 Vladimir Matveev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-f853326256f7bf7c9ccf67315b1a6fd3aaa173a8dab6c2ec55bf23defa98bcac

```text
The MIT License (MIT)

Copyright (c) 2015 Chen Yuheng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### stdlib-98ed0ad9db8a72957b9c45941fe2ed31933a3beacbd193e662df483d0643a13d

```text
Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright 2023 The Fuchsia Authors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

### stdlib-47248d1ec833e0771ddacb65f2cf9978785f4a9976b5b0b69d1e33c60a50be55

```text
Copyright 2019 The Fuchsia Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### stdlib-a03d4daa4f46496a592dbf6734f5ee16ed52f1eb7a56ae4648d609ebf0efd0b7

```text
Copyright 2023 The Fuchsia Authors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Embedded viewer

The precompiled browser assets include their original third-party license texts and vendor
notices in `dist/viewer/THIRD_PARTY_NOTICES.txt`. The generated `viewer-build.json` records
resolved component versions and the SHA-256 of each supplied notice text from the frozen build.
The component set conservatively includes normal dependencies of rendered browser modules,
including libraries already bundled into the Mermaid ESM distribution.
