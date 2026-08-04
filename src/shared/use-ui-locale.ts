import { useCallback, useEffect, useState } from "react";

import { DEFAULT_UI_LOCALE, t, type MessageKey, type UiLocale } from "@shared/i18n";
import { loadUiLocale, saveUiLocale } from "@shared/ui-locale";

export function useUiLocale() {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_UI_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadUiLocale().then((stored) => {
      if (!active) return;
      setLocaleState(stored);
      document.documentElement.lang = stored;
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (next: UiLocale) => {
    const persisted = await saveUiLocale(next);
    setLocaleState(persisted);
    document.documentElement.lang = persisted;
  }, []);

  const translate = useCallback(
    (key: MessageKey, params: Record<string, string | number> = {}) => t(locale, key, params),
    [locale],
  );

  return { locale, setLocale, t: translate, ready };
}
