import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtMoney, esc } from "../js/render.js";

test("fmtMoney shows signed whole dollars, and cents only when needed", () => {
  assert.equal(fmtMoney(44800), "+$448");
  assert.equal(fmtMoney(-6000), "−$60");
  assert.equal(fmtMoney(0), "$0");
  assert.equal(fmtMoney(2667), "+$26.67");
  assert.equal(fmtMoney(-2666), "−$26.66");
  assert.equal(fmtMoney(-72600), "−$726");
  assert.equal(fmtMoney(5), "+$0.05");
});

test("esc escapes HTML special characters", () => {
  assert.equal(esc(`<b>"D'Andre"</b> & co`), "&lt;b&gt;&quot;D&#39;Andre&quot;&lt;/b&gt; &amp; co");
  assert.equal(esc(undefined), "");
  assert.equal(esc(15), "15");
});
