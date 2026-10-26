/**
 * Remove // line comments outside of JSON string literals.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripJsoncLineComments(text) {
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      if (i < text.length && text[i] === "\n") {
        out += "\n";
      }
      continue;
    }

    out += ch;
  }

  return out;
}
