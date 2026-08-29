export function normalizeAuthEmail(value: string) {
  return value.trim().replace(/\\+@/g, '@')
}
