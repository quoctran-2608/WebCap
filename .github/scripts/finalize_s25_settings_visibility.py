from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    content = file.read_text()
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old!r}")
    file.write_text(content.replace(old, new, 1))


replace_once(
    "src/popup/App.tsx",
    '''  const showAdvancedSettings =
    settingsReady &&
    !busy &&
    (tiledMode ? fullPageJob === undefined : status === "idle" && session?.artifact === undefined);
''',
    '''  const showAdvancedSettings =
    settingsReady &&
    !busy &&
    (tiledMode ? fullPageJob === undefined || terminal : status === "idle" || terminal);
''',
)
replace_once(
    "PLAN.md",
    "Technical status nằm trong disclosure; CTA đứng trước Advanced options và settings chỉ xuất hiện ở idle.",
    "Technical status nằm trong disclosure; CTA đứng trước Advanced options và settings chỉ xuất hiện khi idle hoặc terminal, không xuất hiện khi busy.",
)
replace_once(
    "docs/spec-0.2.0.md",
    "Advanced settings follow the CTA and render only while idle; help, privacy, diagnostics and worker/version/tab status use progressive disclosure.",
    "Advanced settings follow the CTA and render only while idle or terminal, never while capture is busy; help, privacy, diagnostics and worker/version/tab status use progressive disclosure.",
)
replace_once(
    "README.md",
    "the primary capture action precedes idle-only advanced settings",
    "the primary capture action precedes advanced settings, which remain available at idle/result and disappear while capture is busy",
)
replace_once(
    "CHANGELOG.md",
    "primary capture actions before idle-only advanced settings",
    "primary capture actions before advanced settings, which are hidden while capture is busy",
)
