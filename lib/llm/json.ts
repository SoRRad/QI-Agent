/**
 * Pulls one JSON value out of a model reply.
 *
 * Models asked for "only JSON" still sometimes wrap it in a code fence or a
 * sentence. Rather than fail on that, take the outermost object or array.
 * Anything this cannot parse goes back to the model once, with the error.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall through to the outermost-bracket search.
  }

  const starts = [candidate.indexOf("{"), candidate.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new SyntaxError("The reply contained no JSON object or array.");
  const start = Math.min(...starts);
  const close = candidate[start] === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end <= start) throw new SyntaxError("The reply's JSON was not closed.");

  return JSON.parse(candidate.slice(start, end + 1));
}
