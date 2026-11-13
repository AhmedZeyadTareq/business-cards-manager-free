/** The query string of a request as a plain object, for Zod. Empty values are left out. */
export function queryOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (value !== "") out[key] = value;
  }
  return out;
}
