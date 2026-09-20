const MARKS = /[̀-ͯ]/g;

/** Two spellings of one name are the normal case: accents, case, punctuation and word order must not matter. */
export function nameKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((token) => token !== "")
    .sort()
    .join(" ");
}

export function emailKey(value: string | null | undefined): string | null {
  const key = (value ?? "").trim().toLowerCase();
  return key === "" ? null : key;
}
