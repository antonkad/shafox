// inline.js — safely embed runtime values inside an inline <script>.
//
// The served index.html carries a small `window.__SHAFOX__ = { ... }` block
// whose string values are filled at request time from the environment (branch,
// ref, build time). That text is not trusted to be free of HTML/JS delimiters:
// a ref containing `</script>`, a `<`, or a U+2028/U+2029 line separator could
// otherwise break out of the string literal. We emit JSON string *content*
// (the caller's template keeps the surrounding double quotes) with `<` and the
// two line separators escaped, so it is safe in both HTML and JS contexts.

export function jsAttr(value) {
  const json = JSON.stringify(value === undefined || value === null ? "" : String(value));
  return json
    .slice(1, -1) // drop the surrounding quotes the JSON encoder added
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
