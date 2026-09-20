import test from "node:test";
import assert from "node:assert/strict";

import { jsAttr } from "../server/lib/inline.js";

test("jsAttr round-trips every value through JSON", () => {
  const values = ["", "main", 'a"b\\c', "</script>", "<img src=x>", "line\u2028sep", "para\u2029sep", "café 🦊"];
  for (const v of values) {
    assert.equal(JSON.parse(`"${jsAttr(v)}"`), v);
  }
});

test("jsAttr escapes < and the U+2028/U+2029 line separators", () => {
  const out = jsAttr("</script><script>alert(1)</script>\u2028\u2029");
  assert.equal(out.includes("<"), false);
  assert.equal(out.includes("\u2028"), false);
  assert.equal(out.includes("\u2029"), false);
  assert.ok(out.includes("\\u003c"));
  assert.ok(out.includes("\\u2028"));
  assert.ok(out.includes("\\u2029"));
});

test("jsAttr treats null and undefined as the empty string", () => {
  assert.equal(jsAttr(null), "");
  assert.equal(jsAttr(undefined), "");
});
