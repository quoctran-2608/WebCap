from pathlib import Path

path = Path("src/popup/App.tsx")
text = path.read_text()


def replace(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"Missing App marker: {old[:120]!r}")
    text = text.replace(old, new, 1)


replace(
    'import type { CaptureJob, CaptureMode, ImageFormat, OutputFormat } from "@shared/contracts/domain";',
    'import type {\n  CaptureJob,\n  CaptureMode,\n  CaptureSettings,\n  ImageFormat,\n  OutputFormat,\n} from "@shared/contracts/domain";',
)
replace(
    'import type {\n  VisibleSessionSnapshot,\n  VisibleSessionStatus,\n} from "@shared/contracts/visible-session";\n',
    'import type {\n  VisibleSessionSnapshot,\n  VisibleSessionStatus,\n} from "@shared/contracts/visible-session";\nimport {\n  DEFAULT_MODE_OUTPUT_PREFERENCES,\n  type ModeOutputPreferences,\n} from "@shared/popup-preferences";\nimport { DEFAULT_CAPTURE_SETTINGS } from "@shared/settings";\n',
)
replace(
    'import { createArtifactPreview } from "./artifact-preview";\n',
    'import { createArtifactPreview } from "./artifact-preview";\nimport { captureSettingsForOutput } from "./capture-settings";\n',
)
replace(
    'import { estimateOutputBytes, formatBytes } from "./formatting";\n',
    'import { estimateOutputBytes, formatBytes } from "./formatting";\nimport { PopupSettingsClient, selectedImageFormat } from "./settings-client";\n',
)
replace(
    'const IMAGE_QUALITY = 0.92;\nconst SESSION_POLL_MS = 350;\n',
    'const SESSION_POLL_MS = 350;\nconst popupSettingsClient = new PopupSettingsClient();\n',
)
replace(
    '  const [selectedMode, setSelectedMode] = useState<CaptureMode>("visible");\n  const [selectedFormat, setSelectedFormat] = useState<ImageFormat>("png");\n',
    '  const [selectedMode, setSelectedMode] = useState<CaptureMode>("visible");\n  const [selectedFormat, setSelectedFormat] = useState<ImageFormat>("png");\n  const [captureSettings, setCaptureSettings] =\n    useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);\n  const [outputByMode, setOutputByMode] = useState<ModeOutputPreferences>(\n    DEFAULT_MODE_OUTPUT_PREFERENCES,\n  );\n  const [settingsReady, setSettingsReady] = useState(false);\n',
)
replace(
    '  useEffect(() => {\n    let active = true;\n\n    void (async () => {\n',
    '  useEffect(() => {\n    let active = true;\n    void popupSettingsClient\n      .load()\n      .then((snapshot) => {\n        if (!active) return;\n        setCaptureSettings(snapshot.capture);\n        setOutputByMode(snapshot.outputByMode);\n        setSelectedFormat(selectedImageFormat(snapshot.outputByMode, "visible"));\n        setSettingsReady(true);\n      })\n      .catch((error: unknown) => {\n        if (!active) return;\n        setSettingsReady(false);\n        setUiError(genericErrorCopy(locale, error));\n      });\n\n    return () => {\n      active = false;\n    };\n  }, [locale]);\n\n  useEffect(() => {\n    let active = true;\n\n    void (async () => {\n',
)
replace(
    '              setFullPageJob(activeJob);\n              setSelectedMode(activeJob.mode);\n',
    '              setFullPageJob(activeJob);\n              setSelectedMode(activeJob.mode);\n              if (activeJob.settings.outputFormat !== "pdf") {\n                setSelectedFormat(activeJob.settings.outputFormat);\n              }\n',
)
replace(
    '  const canCapture =\n    workerStatus === "connected" &&\n',
    '  const jobSettings = useMemo(\n    () => captureSettingsForOutput(captureSettings, selectedFormat),\n    [captureSettings, selectedFormat],\n  );\n  const canCapture =\n    settingsReady &&\n    workerStatus === "connected" &&\n',
)
replace(
    '        quality: IMAGE_QUALITY,\n',
    '        quality: captureSettings.imageQuality,\n',
)
replace(
    '      await runExport(metadata.captureId, selectedFormat, IMAGE_QUALITY);\n',
    '      await runExport(metadata.captureId, selectedFormat, captureSettings.imageQuality);\n',
)
replace(
    '  }, [handleOperationError, runExport, selectedFormat]);\n',
    '  }, [captureSettings.imageQuality, handleOperationError, runExport, selectedFormat]);\n',
)
replace(
    '      const job = await startFullPageCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        outputFormat: selectedFormat,\n      });\n',
    '      const job = await startFullPageCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        settings: jobSettings,\n      });\n',
)
replace(
    '      const job = await startRegionCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        outputFormat: selectedFormat,\n      });\n',
    '      const job = await startRegionCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        settings: jobSettings,\n      });\n',
)
replace(
    '      const job = await startElementCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        outputFormat: selectedFormat,\n      });\n',
    '      const job = await startElementCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        settings: jobSettings,\n      });\n',
)
replace(
    '      const job = await startScrollAreaCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        outputFormat: selectedFormat,\n      });\n',
    '      const job = await startScrollAreaCapture({\n        tabId: tabCapability.tabId,\n        windowId: tabCapability.windowId,\n        settings: jobSettings,\n      });\n',
)
replace(
    '  }, [locale, selectedFormat, syncFullPageJob, tabCapability.tabId, tabCapability.windowId]);\n',
    '  }, [jobSettings, locale, syncFullPageJob, tabCapability.tabId, tabCapability.windowId]);\n',
)
replace(
    '  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);\n',
    '  }, [jobSettings, locale, tabCapability.tabId, tabCapability.windowId]);\n',
)
replace(
    '  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);\n',
    '  }, [jobSettings, locale, tabCapability.tabId, tabCapability.windowId]);\n',
)
replace(
    '  }, [locale, selectedFormat, tabCapability.tabId, tabCapability.windowId]);\n',
    '  }, [jobSettings, locale, tabCapability.tabId, tabCapability.windowId]);\n',
)
replace(
    '      await runExport(session.source.captureId, selectedFormat, IMAGE_QUALITY);\n',
    '      await runExport(\n        session.source.captureId,\n        selectedFormat,\n        captureSettings.imageQuality,\n      );\n',
)
replace(
    '    fullPageJob,\n    handleFullPageCapture,\n',
    '    captureSettings.imageQuality,\n    fullPageJob,\n    handleFullPageCapture,\n',
)
replace(
    '  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {\n',
    '  const handleModeSelect = useCallback(\n    (mode: CaptureMode): void => {\n      setSelectedMode(mode);\n      setSelectedFormat(selectedImageFormat(outputByMode, mode));\n    },\n    [outputByMode],\n  );\n\n  const handleFormatSelect = useCallback(\n    async (format: ImageFormat): Promise<void> => {\n      const previous = selectedFormat;\n      setSelectedFormat(format);\n      setUiError(undefined);\n      try {\n        setOutputByMode(\n          await popupSettingsClient.saveModeOutput(outputByMode, selectedMode, format),\n        );\n      } catch (error) {\n        setSelectedFormat(previous);\n        setUiError(genericErrorCopy(locale, error));\n      }\n    },\n    [locale, outputByMode, selectedFormat, selectedMode],\n  );\n\n  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {\n',
)
replace(
    '                onClick={() => setSelectedMode(mode)}\n',
    '                onClick={() => handleModeSelect(mode)}\n',
)
replace(
    '              onChange={(event) => setSelectedFormat(event.target.value as ImageFormat)}\n',
    '              onChange={(event) =>\n                void handleFormatSelect(event.target.value as ImageFormat)\n              }\n',
)

path.write_text(text)
