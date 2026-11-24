// The Rules popup: RULES.md is the one rulebook. The site shows the league rules from it (everything
// above the first "---" line); the scorekeeping notes below that line stay out.
// A small Markdown reader for what RULES.md uses: headings, paragraphs, "- " lists (with wrapped
// lines), **bold** and `code`. Everything is escaped first, so the file can't inject HTML.
import { esc } from "./render.js";

const inline = (text) =>
  esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

// The league rules part of RULES.md as HTML; the top "# " heading becomes `title`.
export function rulesHtml(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const end = lines.findIndex((l) => /^-{3,}\s*$/.test(l));
  const out = [];
  let title = null;
  let para = null; // lines of the paragraph being read
  let list = null; // items of the list being read
  const flush = () => {
    if (para) out.push(`<p>${inline(para.join(" "))}</p>`);
    if (list) out.push(`<ul>${list.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`);
    para = list = null;
  };
  for (const line of end === -1 ? lines : lines.slice(0, end)) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length === 1 && title === null) title = h[2].trim();
      else out.push(`<h${Math.min(h[1].length + 1, 4)}>${inline(h[2].trim())}</h${Math.min(h[1].length + 1, 4)}>`);
    } else if (/^\s*$/.test(line)) {
      flush();
    } else if (/^- /.test(line)) {
      if (para) flush();
      (list ??= []).push(line.slice(2).trim());
    } else if (list && /^\s+\S/.test(line)) {
      list[list.length - 1] += ` ${line.trim()}`; // a list item's wrapped line
    } else {
      if (list) flush();
      (para ??= []).push(line.trim());
    }
  }
  flush();
  return { title, html: out.join("\n") };
}
