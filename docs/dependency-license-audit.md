# Dependency and license audit

S19 adds a deterministic basic dependency/license gate before the release-candidate session.

## Automated check

Run:

```bash
pnpm audit:dependencies
```

The script resolves every direct production and development dependency from the frozen install, records its exact installed version and declared license, and fails when:

- package metadata cannot be resolved;
- a direct dependency has no declared license metadata;
- a direct dependency declares AGPL, GPL, SSPL, BUSL, or another string matching the configured incompatible-license rule;
- the pnpm virtual store is unavailable, indicating the audit is not running against a complete install.

The machine-readable summary also reports the number of pnpm virtual-store entries as a basic transitive-inventory signal. S20 must retain the exact lockfile, review automated security alerts, and include the final inventory/release artifact in the release checklist.

## Current declared direct dependencies

Runtime:

- `pdf-lib` — PDF assembly from local page images;
- `react` and `react-dom` — popup/editor UI;
- `zod` — validation at message/storage boundaries.

Development:

- TypeScript, Vite, Vitest, Playwright, ESLint, Prettier, and their typed adapters/plugins.

No dependency is loaded from a CDN or remote module at runtime. All executable code is bundled into the extension build and pinned by `pnpm-lock.yaml`.

## Scope and limitations

This is a release hygiene gate, not legal advice. It checks declared package metadata and obvious incompatible identifiers; it does not replace legal review of every transitive license text, notice obligation, patent clause, or dual-license choice. Any dependency addition or version change must update the lockfile, pass this audit, pass the privacy audit, and be reviewed again during S20.
