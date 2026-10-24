/** Remove explicit stress marks only. NFC preserves ё and й as letters. */
export function normalizeSearch(value: string): string {
  return value.normalize('NFC').replace(/[\u0300\u0301\u0340\u0341]/g, '')
    .toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
}

/** е/ё relaxation is a search alias, never an identity or display rewrite. */
export function searchAliases(value: string): string[] {
  const normalized = normalizeSearch(value);
  return [...new Set([normalized, normalized.replace(/ё/g, 'е')])];
}

export function matchesSearch(query: string, ...values: Array<string | null | undefined>): boolean {
  const needles = searchAliases(query);
  return values.some((value) => value != null && searchAliases(value).some((haystack) => needles.some((needle) => haystack.includes(needle))));
}

/** OCR review hint only; never automatically replace a possibly intentional Latin word. */
export function hasMixedAlphabet(value: string): boolean {
  return value.split(/\s+/).some((word) => /[а-яё]/iu.test(word) && /[aceopxykmthb]/i.test(word));
}
