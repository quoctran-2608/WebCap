# S24 completion services diagnostic

Retry trigger: syntax fixture correction revision 2.

Exit status: 2

```text
src/background/capture-completion-policy.ts 57ms (unchanged)
src/background/capture-output.ts 4ms (unchanged)
src/background/tiled-image-export-service.ts 44ms
src/background/capture-completion-service.ts 36ms
src/background/job-coordinator.ts 62ms (unchanged)
src/background/job-state-machine.ts 21ms
src/background/pdf-export-service.ts 20ms (unchanged)
src/shared/contracts/domain.ts 27ms (unchanged)
src/storage/artifact-repository.ts 15ms (unchanged)
tests/unit/capture-completion-policy.test.ts 3ms (unchanged)
[error] tests/unit/tiled-image-export-service.test.ts: SyntaxError: Argument expression expected. (135:7)
[error]   133 |               }),
[error]   134 |             ),
[error] > 135 |       },
[error]       |       ^
[error]   136 |       now: () => NOW,
[error]   137 |     });
[error]   138 |
tests/unit/capture-completion-service.test.ts 11ms (unchanged)
```
