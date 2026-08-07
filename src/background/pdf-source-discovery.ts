export interface PdfSourceDiscoveryPort {
  discover(tabId: number): Promise<string[]>;
}

function discoverPdfSourceUrlsInPage(): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null, force = false): void => {
    if (raw === null || raw.trim().length === 0) return;
    try {
      const url = new URL(raw, document.baseURI);
      const looksPdf = /\.pdf(?:$|[?#])/iu.test(url.href);
      const blob = url.protocol === "blob:";
      if (!force && !looksPdf && !blob) return;
      if (seen.has(url.href)) return;
      seen.add(url.href);
      found.push(url.href);
    } catch {
      // Ignore malformed or browser-restricted element URLs.
    }
  };

  for (const element of document.querySelectorAll("embed[src]")) {
    const embed = element as HTMLEmbedElement;
    add(embed.getAttribute("src"), embed.type.toLowerCase() === "application/pdf");
  }
  for (const element of document.querySelectorAll("object[data]")) {
    const object = element as HTMLObjectElement;
    add(object.getAttribute("data"), object.type.toLowerCase() === "application/pdf");
  }
  for (const element of document.querySelectorAll("iframe[src]")) {
    add(element.getAttribute("src"));
  }
  for (const element of document.querySelectorAll("source[src]")) {
    const source = element as HTMLSourceElement;
    add(source.getAttribute("src"), source.type.toLowerCase() === "application/pdf");
  }
  for (const element of document.querySelectorAll("a[href]")) {
    add(element.getAttribute("href"));
  }

  return found.slice(0, 32);
}

export const browserPdfSourceDiscovery: PdfSourceDiscoveryPort = {
  async discover(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        func: discoverPdfSourceUrlsInPage,
      });
      const urls = results[0]?.result;
      return Array.isArray(urls)
        ? urls.filter((value): value is string => typeof value === "string").slice(0, 32)
        : [];
    } catch {
      return [];
    }
  },
};
