# S24 phase 1 diagnostic

Exit status: 1

```text
src/offscreen/tiled-image-exporter.ts 109ms
[90msrc/shared/errors/error.ts[39m 13ms (unchanged)
[90msrc/shared/i18n.ts[39m 61ms (unchanged)
[90msrc/shared/contracts/offscreen.ts[39m 41ms (unchanged)
[90msrc/background/offscreen-service.ts[39m 24ms (unchanged)
[90msrc/offscreen/entry.ts[39m 20ms (unchanged)
tests/unit/tiled-image-exporter.test.ts 22ms
$ eslint . --max-warnings=0

/home/runner/work/WebCap/WebCap/tests/unit/tiled-image-exporter.test.ts
   97:30  error  '_record' is defined but never used              @typescript-eslint/no-unused-vars
   97:70  error  Async arrow function has no 'await' expression   @typescript-eslint/require-await
  102:9   error  Async method 'decode' has no 'await' expression  @typescript-eslint/require-await

✖ 3 problems (3 errors, 0 warnings)

[ELIFECYCLE] Command failed with exit code 1.

```
