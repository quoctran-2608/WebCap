from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"missing marker in {path}: {old[:140]!r}")
    p.write_text(text.replace(old, new, 1))


replace(
    "src/background/persistent-job-router.ts",
    'import { PdfWriterCheckpointRepository } from "@storage/pdf-writer-checkpoint-repository";',
    'import { IndexedDbPdfWriterCheckpointRepository } from "@storage/pdf-writer-checkpoint-repository";',
)
replace(
    "src/background/persistent-job-router.ts",
    '  const pdfWriterCheckpoints = new PdfWriterCheckpointRepository();',
    '  const pdfWriterCheckpoints = new IndexedDbPdfWriterCheckpointRepository();',
)
replace(
    "tests/e2e/pdf-recovery-s33.spec.ts",
    '  const workerUrl = worker.url();\n  const origin = `chrome-extension://${new URL(workerUrl).host}`;\n  const session = await browser.newBrowserCDPSession();',
    '  const workerUrl = worker.url();\n  const session = await browser.newBrowserCDPSession();',
)
replace(
    "tests/e2e/pdf-recovery-s33.spec.ts",
    '''  const response: unknown = await popup.evaluate(\n    async (message) => chrome.runtime.sendMessage(message),\n    request,\n  );''',
    '''  const response: unknown = await popup.evaluate(\n    async (message): Promise<unknown> => {\n      const value: unknown = await chrome.runtime.sendMessage(message);\n      return value;\n    },\n    request,\n  );''',
)
