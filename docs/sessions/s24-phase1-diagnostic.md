# S24 phase 1 diagnostic

Exit status: 2

```text
src/offscreen/tiled-image-exporter.ts 165ms
[90msrc/shared/errors/error.ts[39m 21ms (unchanged)
[90msrc/shared/i18n.ts[39m 103ms (unchanged)
[90msrc/shared/contracts/offscreen.ts[39m 64ms (unchanged)
[90msrc/background/offscreen-service.ts[39m 40ms (unchanged)
[90msrc/offscreen/entry.ts[39m 27ms (unchanged)
tests/unit/tiled-image-exporter.test.ts 27ms
$ eslint . --max-warnings=0
$ tsc --noEmit
src/offscreen/entry.ts(169,66): error TS2379: Argument of type '{ jobId: string; outputArtifactId: string; targetRect: { x: number; y: number; width: number; height: number; }; tiles: { id: string; jobId: string; index: number; row: number; column: number; sourceRectCss: { ...; }; ... 16 more ...; checksum?: string | undefined; }[]; ... 6 more ...; sourceDomain?: string | undefi...' is not assignable to parameter of type 'TiledImageExportPayload' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.
  Types of property 'sourceTitle' are incompatible.
    Type 'string | undefined' is not assignable to type 'string'.
      Type 'undefined' is not assignable to type 'string'.
[ELIFECYCLE] Command failed with exit code 2.

```
