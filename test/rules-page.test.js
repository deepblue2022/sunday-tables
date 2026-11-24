import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rulesHtml } from "../js/rules.js";

const md = readFileSync(new URL("../RULES.md", import.meta.url), "utf8");

test("the Rules popup shows the league rules from RULES.md, not the scorekeeping notes", () => {
  const { title, html } = rulesHtml(md);
  assert.equal(title, "Sunday Tables: league rules");
  for (const n of [1, 2, 3, 4, 5, 6, 7]) assert.match(html, new RegExp(`<h3>${n}\\. `));
  assert.match(html, /<strong>Tight ends count as WR:<\/strong>/);
  assert.match(html, /Thanksgiving/);
  assert.doesNotMatch(html, /Scorekeeping|npm run|two_pt_fixes|<h2>/);
});

test("list items keep their wrapped lines; bold, code and escaping work", () => {
  const { html } = rulesHtml("# T\n\nIntro\nline two.\n\n## A\n- **Bold** one\n  continues here\n- `x` <b>&\n\n---\n\nhidden");
  assert.equal(
    html,
    "<p>Intro line two.</p>\n<h3>A</h3>\n<ul><li><strong>Bold</strong> one continues here</li><li><code>x</code> &lt;b&gt;&amp;</li></ul>",
  );
});
