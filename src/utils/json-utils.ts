/**
 * Utility to repair potentially broken JSON strings from LLM responses.
 */
export function repairJSON(s: string): string {
  let repaired = s.trim();
  // Remove trailing commas
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  if (repaired.endsWith(',')) repaired = repaired.slice(0, -1);

  // Close unclosed quotes
  let inString = false;
  let escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '\\' && !escaped) {
      escaped = true;
    } else {
      if (repaired[i] === '"' && !escaped) inString = !inString;
      escaped = false;
    }
  }
  if (inString) repaired += '"';

  // Balance braces and brackets
  let braces = 0;
  let brackets = 0;
  inString = false;
  escaped = false;
  for (let i = 0; i < repaired.length; i++) {
    if (repaired[i] === '\\' && !escaped) {
      escaped = true;
    } else {
      if (repaired[i] === '"' && !escaped) inString = !inString;
      if (!inString) {
        if (repaired[i] === '{') braces++;
        else if (repaired[i] === '}') braces--;
        else if (repaired[i] === '[') brackets++;
        else if (repaired[i] === ']') brackets--;
      }
      escaped = false;
    }
  }
  while (brackets > 0) { repaired += ']'; brackets--; }
  while (braces > 0) { repaired += '}'; braces--; }
  return repaired;
}

/**
 * Strategy-based JSON extraction from LLM text responses.
 */
export function extractJSON(text: string): any {
  const strategies: Array<() => string> = [
    () => text.trim(),
    () => {
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (!m) throw new Error('no codeblock');
      return m[1].trim();
    },
    () => {
      const start = text.indexOf('{');
      if (start === -1) throw new Error('no {');
      let depth = 0, i = start;
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) break; }
      }
      return text.slice(start, i + 1);
    },
    () => {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start === -1 || end <= start) throw new Error('no bounds');
      return text.slice(start, end + 1);
    },
  ];

  let lastErr = 'no strategy succeeded';
  for (const strategy of strategies) {
    try {
      let candidate = strategy();
      // Clean up control characters in strings
      candidate = candidate.replace(/"([^"\\]|\\.)*"/g, (match) => {
        return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
      });

      try {
        return JSON.parse(candidate);
      } catch (e) {
        // Attempt repair if JSON.parse fails
        return JSON.parse(repairJSON(candidate));
      }
    } catch (e: any) { lastErr = e.message; }
  }
  throw new Error('JSON invalide : ' + lastErr);
}
