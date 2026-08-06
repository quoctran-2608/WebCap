from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing {label} marker: {old[:120]!r}")
    return text.replace(old, new, 1)


app_path = Path("src/popup/App.tsx")
app = app_path.read_text()
app = replace_once(
    app,
    'import { createArtifactPreview } from "./artifact-preview";\n',
    'import { AdvancedSettingsPanel } from "./AdvancedSettingsPanel";\nimport { createArtifactPreview } from "./artifact-preview";\n',
    "App import",
)
app = replace_once(
    app,
    '  const [settingsReady, setSettingsReady] = useState(false);\n',
    '  const [settingsReady, setSettingsReady] = useState(false);\n  const [settingsSaving, setSettingsSaving] = useState(false);\n  const [settingsNotice, setSettingsNotice] = useState<string>();\n',
    "App settings state",
)
app = replace_once(
    app,
    '  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {\n',
    '  const handleSaveCaptureSettings = useCallback(\n    async (next: CaptureSettings): Promise<void> => {\n      setSettingsSaving(true);\n      setSettingsNotice(undefined);\n      try {\n        setCaptureSettings(await popupSettingsClient.saveCapture(next));\n        setSettingsNotice(t(locale, "popup.settings.saved"));\n      } catch (error) {\n        setSettingsNotice(genericErrorCopy(locale, error));\n      } finally {\n        setSettingsSaving(false);\n      }\n    },\n    [locale],\n  );\n\n  const handleResetOptions = useCallback(async (): Promise<void> => {\n    setSettingsSaving(true);\n    setSettingsNotice(undefined);\n    try {\n      const snapshot = await popupSettingsClient.reset();\n      setCaptureSettings(snapshot.capture);\n      setOutputByMode(snapshot.outputByMode);\n      setSelectedFormat(selectedImageFormat(snapshot.outputByMode, selectedMode));\n      setSettingsNotice(t(locale, "popup.settings.resetDone"));\n    } catch (error) {\n      setSettingsNotice(genericErrorCopy(locale, error));\n    } finally {\n      setSettingsSaving(false);\n    }\n  }, [locale, selectedMode]);\n\n  const handleCopyDiagnostics = useCallback(async (): Promise<void> => {\n',
    "App settings handlers",
)
app = replace_once(
    app,
    '        ) : (\n          <p className="field-label">{tiledOutputHint}</p>\n        )}\n\n        {busy ? (\n',
    '        ) : (\n          <p className="field-label">{tiledOutputHint}</p>\n        )}\n\n        <AdvancedSettingsPanel\n          locale={locale}\n          settings={captureSettings}\n          busy={busy}\n          saving={settingsSaving}\n          notice={settingsNotice}\n          onSave={handleSaveCaptureSettings}\n          onReset={handleResetOptions}\n        />\n\n        {busy ? (\n',
    "App settings panel",
)
app_path.write_text(app)


i18n_path = Path("src/shared/i18n.ts")
i18n = i18n_path.read_text()
vi_marker = '  "popup.outputFormat": "Định dạng đầu ra",\n'
vi_copy = vi_marker + '''  "popup.settings.summary": "Tùy chọn nâng cao",
  "popup.settings.intro":
    "Các tùy chọn này được lưu trên thiết bị và áp dụng cho những lượt chụp mới.",
  "popup.settings.imageQuality": "Chất lượng ảnh: {value}%",
  "popup.settings.fixedMode": "Phần tử cố định và sticky",
  "popup.settings.fixed.smart": "Thông minh (khuyến nghị)",
  "popup.settings.fixed.preserve": "Giữ nguyên",
  "popup.settings.fixed.remove": "Loại bỏ",
  "popup.settings.pdfGroup": "PDF",
  "popup.settings.pageSize": "Khổ trang",
  "popup.settings.fitWidth": "Vừa chiều rộng",
  "popup.settings.orientation": "Hướng trang",
  "popup.settings.portrait": "Dọc",
  "popup.settings.landscape": "Ngang",
  "popup.settings.margin": "Lề trang (mm)",
  "popup.settings.pdfQuality": "Chất lượng ảnh trong PDF: {value}%",
  "popup.settings.save": "Lưu tùy chọn",
  "popup.settings.saving": "Đang lưu…",
  "popup.settings.reset": "Đặt lại tùy chọn",
  "popup.settings.saved": "Đã lưu tùy chọn cho các lượt chụp mới.",
  "popup.settings.resetDone":
    "Đã đặt lại tùy chọn mặc định. Dữ liệu chụp hiện tại không bị thay đổi.",
'''
i18n = replace_once(i18n, vi_marker, vi_copy, "Vietnamese settings copy")
en_marker = '  "popup.outputFormat": "Output format",\n'
en_copy = en_marker + '''  "popup.settings.summary": "Advanced options",
  "popup.settings.intro":
    "These options are stored on this device and applied to new captures.",
  "popup.settings.imageQuality": "Image quality: {value}%",
  "popup.settings.fixedMode": "Fixed and sticky elements",
  "popup.settings.fixed.smart": "Smart (recommended)",
  "popup.settings.fixed.preserve": "Preserve",
  "popup.settings.fixed.remove": "Remove",
  "popup.settings.pdfGroup": "PDF",
  "popup.settings.pageSize": "Page size",
  "popup.settings.fitWidth": "Fit width",
  "popup.settings.orientation": "Orientation",
  "popup.settings.portrait": "Portrait",
  "popup.settings.landscape": "Landscape",
  "popup.settings.margin": "Page margin (mm)",
  "popup.settings.pdfQuality": "PDF image quality: {value}%",
  "popup.settings.save": "Save options",
  "popup.settings.saving": "Saving…",
  "popup.settings.reset": "Reset options",
  "popup.settings.saved": "Options saved for new captures.",
  "popup.settings.resetDone":
    "Default options restored. Current capture data was not changed.",
'''
i18n = replace_once(i18n, en_marker, en_copy, "English settings copy")
i18n_path.write_text(i18n)


css_path = Path("src/popup/popup.css")
css = css_path.read_text()
if ".advanced-settings" in css:
    raise SystemExit("Advanced settings CSS already exists")
css += '''

.advanced-settings {
  border: 1px solid rgb(23 58 45 / 10%);
  border-radius: 13px;
  background: #f8faf7;
}

.advanced-settings summary {
  padding: 11px 12px;
  color: #274c3d;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.advanced-settings summary:focus-visible {
  outline: 3px solid rgb(189 143 60 / 36%);
  outline-offset: 2px;
  border-radius: 10px;
}

.advanced-settings__body {
  display: grid;
  gap: 12px;
  border-top: 1px solid rgb(23 58 45 / 8%);
  padding: 12px;
}

.advanced-settings__intro,
.settings-notice {
  margin: 0;
  color: #718077;
  font-size: 10px;
  line-height: 1.45;
}

.settings-field {
  display: grid;
  gap: 6px;
  color: #52645a;
  font-size: 11px;
  font-weight: 700;
}

.settings-field input[type="number"] {
  width: 100%;
  min-height: 42px;
  border: 1px solid rgb(23 58 45 / 12%);
  border-radius: 12px;
  padding: 0 12px;
  color: #42574c;
  background: #f7f9f5;
  font: inherit;
}

.settings-field input[type="range"] {
  width: 100%;
  accent-color: #1d5e42;
}

.settings-field input:focus-visible {
  outline: 3px solid rgb(189 143 60 / 36%);
  outline-offset: 2px;
}

.settings-group {
  display: grid;
  gap: 10px;
  margin: 0;
  border: 1px solid rgb(23 58 45 / 9%);
  border-radius: 11px;
  padding: 10px;
}

.settings-group legend {
  padding: 0 5px;
  color: #274c3d;
  font-size: 11px;
  font-weight: 800;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.settings-grid .settings-field:last-child {
  grid-column: 1 / -1;
}

.settings-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.settings-notice {
  color: #1d6a49;
}
'''
css_path.write_text(css)
