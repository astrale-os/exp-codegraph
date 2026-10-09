```sh
pnpm build
SOURCE_REVISION="$(git rev-parse HEAD)" pnpm viewer:assemble
```

The default `.viewer-release-assets/` contains `viewer-<sourceRevision>.tar.gz`
and `viewer-release.json`. `--assets-dir <directory>` selects another output.
The identical light header is written to the package root; browser assets stay
outside npm. Release inputs must match the committed checkout.

The gzip holds deterministic, sorted, regular-file ustar entries with 100-byte
ASCII paths, no links, directories, extended headers or source maps. Original
browser notices and fonts remain in the bundle. The header authenticates both
gzip and decoded tar sizes and SHA256, tied to package version and source.

Installed `cg dev` and explicit viewer preload materialize one verified tar in
the viewer cache. The server pins its inode and serves byte ranges directly,
without extraction. Warm caches work offline; source checkouts retain Vite HMR.
