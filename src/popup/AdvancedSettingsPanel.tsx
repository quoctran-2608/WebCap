import { useEffect, useState } from "react";

import type { CaptureSettings } from "@shared/contracts/domain";
import { t, type UiLocale } from "@shared/i18n";

export interface AdvancedSettingsPanelProps {
  locale: UiLocale;
  settings: CaptureSettings;
  busy: boolean;
  saving: boolean;
  notice?: string;
  onSave(settings: CaptureSettings): Promise<void>;
  onReset(): Promise<void>;
}

function percentage(value: number): number {
  return Math.round(value * 100);
}

export function AdvancedSettingsPanel({
  locale,
  settings,
  busy,
  saving,
  notice,
  onSave,
  onReset,
}: AdvancedSettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  return (
    <details className="advanced-settings" data-testid="advanced-settings">
      <summary>{t(locale, "popup.settings.summary")}</summary>
      <div className="advanced-settings__body" aria-busy={saving}>
        <p className="advanced-settings__intro">{t(locale, "popup.settings.intro")}</p>

        <label className="settings-field" htmlFor="image-quality">
          <span>
            {t(locale, "popup.settings.imageQuality", {
              value: percentage(draft.imageQuality),
            })}
          </span>
          <input
            id="image-quality"
            data-testid="image-quality"
            type="range"
            min="40"
            max="100"
            step="1"
            value={percentage(draft.imageQuality)}
            disabled={busy || saving}
            onChange={(event) =>
              setDraft({ ...draft, imageQuality: Number(event.target.value) / 100 })
            }
          />
        </label>

        <label className="settings-field" htmlFor="fixed-element-mode">
          <span>{t(locale, "popup.settings.fixedMode")}</span>
          <select
            id="fixed-element-mode"
            data-testid="fixed-element-mode"
            value={draft.fixedElementMode}
            disabled={busy || saving}
            onChange={(event) =>
              setDraft({
                ...draft,
                fixedElementMode: event.target.value as CaptureSettings["fixedElementMode"],
              })
            }
          >
            <option value="smart">{t(locale, "popup.settings.fixed.smart")}</option>
            <option value="preserve">{t(locale, "popup.settings.fixed.preserve")}</option>
            <option value="remove">{t(locale, "popup.settings.fixed.remove")}</option>
          </select>
        </label>

        <fieldset className="settings-group">
          <legend>{t(locale, "popup.settings.pdfGroup")}</legend>
          <div className="settings-grid">
            <label className="settings-field" htmlFor="pdf-page-size">
              <span>{t(locale, "popup.settings.pageSize")}</span>
              <select
                id="pdf-page-size"
                data-testid="pdf-page-size"
                value={draft.pdf.pageSize}
                disabled={busy || saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pdf: {
                      ...draft.pdf,
                      pageSize: event.target.value as CaptureSettings["pdf"]["pageSize"],
                    },
                  })
                }
              >
                <option value="a4">A4</option>
                <option value="letter">Letter</option>
                <option value="fit-width">{t(locale, "popup.settings.fitWidth")}</option>
              </select>
            </label>

            <label className="settings-field" htmlFor="pdf-orientation">
              <span>{t(locale, "popup.settings.orientation")}</span>
              <select
                id="pdf-orientation"
                data-testid="pdf-orientation"
                value={draft.pdf.orientation}
                disabled={busy || saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pdf: {
                      ...draft.pdf,
                      orientation: event.target.value as CaptureSettings["pdf"]["orientation"],
                    },
                  })
                }
              >
                <option value="portrait">{t(locale, "popup.settings.portrait")}</option>
                <option value="landscape">{t(locale, "popup.settings.landscape")}</option>
              </select>
            </label>

            <label className="settings-field" htmlFor="pdf-margin">
              <span>{t(locale, "popup.settings.margin")}</span>
              <input
                id="pdf-margin"
                data-testid="pdf-margin"
                type="number"
                min="0"
                max="50"
                step="1"
                value={draft.pdf.marginMm}
                disabled={busy || saving}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    pdf: { ...draft.pdf, marginMm: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>

          <label className="settings-field" htmlFor="pdf-quality">
            <span>
              {t(locale, "popup.settings.pdfQuality", {
                value: percentage(draft.pdf.jpegQuality),
              })}
            </span>
            <input
              id="pdf-quality"
              data-testid="pdf-quality"
              type="range"
              min="40"
              max="100"
              step="1"
              value={percentage(draft.pdf.jpegQuality)}
              disabled={busy || saving}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  pdf: { ...draft.pdf, jpegQuality: Number(event.target.value) / 100 },
                })
              }
            />
          </label>
        </fieldset>

        <div className="settings-actions">
          <button
            className="primary-action"
            type="button"
            data-testid="save-settings"
            disabled={busy || saving}
            onClick={() => void onSave(draft)}
          >
            {saving ? t(locale, "popup.settings.saving") : t(locale, "popup.settings.save")}
          </button>
          <button
            className="secondary-action"
            type="button"
            data-testid="reset-settings"
            disabled={busy || saving}
            onClick={() => void onReset()}
          >
            {t(locale, "popup.settings.reset")}
          </button>
        </div>
        {notice !== undefined && (
          <p className="settings-notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}
      </div>
    </details>
  );
}
