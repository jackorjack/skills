import fs from 'node:fs';
import path from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/render_geo_markdown.mjs <input.md> <output.html>');
  process.exit(1);
}

const source = fs.readFileSync(inputPath, 'utf8').replace(/\r\n/g, '\n').trim();
const lines = source.split('\n');

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const inline = (value) => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>');

const isTableDivider = (line) => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

let title = '';
let paragraph = [];
let listType = null;
const body = [];

const flushParagraph = () => {
  if (!paragraph.length) return;
  body.push(`<p>${inline(paragraph.join(' '))}</p>`);
  paragraph = [];
};

const closeList = () => {
  if (!listType) return;
  body.push(`</${listType}>`);
  listType = null;
};

for (let index = 0; index < lines.length; index += 1) {
  const line = lines[index];
  const trimmed = line.trim();

  if (!trimmed) {
    flushParagraph();
    closeList();
    continue;
  }

  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    flushParagraph();
    closeList();
    const level = heading[1].length;
    const text = heading[2].trim();
    if (level === 1 && !title) title = text;
    body.push(`<h${level}>${inline(text)}</h${level}>`);
    continue;
  }

  if (trimmed === '---') {
    flushParagraph();
    closeList();
    body.push('<hr>');
    continue;
  }

  if (trimmed.startsWith('>')) {
    flushParagraph();
    closeList();
    body.push(`<blockquote>${inline(trimmed.replace(/^>\s?/, ''))}</blockquote>`);
    continue;
  }

  if (trimmed.includes('|') && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
    flushParagraph();
    closeList();
    const headers = cells(trimmed);
    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].trim().includes('|')) {
      rows.push(cells(lines[index]));
      index += 1;
    }
    index -= 1;
    body.push('<div class="table-wrap"><table><thead><tr>');
    body.push(headers.map((cell) => `<th>${inline(cell)}</th>`).join(''));
    body.push('</tr></thead><tbody>');
    for (const row of rows) body.push(`<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
    body.push('</tbody></table></div>');
    continue;
  }

  const unordered = trimmed.match(/^[-*]\s+(.+)$/);
  const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
  if (unordered || ordered) {
    flushParagraph();
    const nextType = unordered ? 'ul' : 'ol';
    if (listType !== nextType) {
      closeList();
      listType = nextType;
      body.push(`<${listType}>`);
    }
    const item = (unordered || ordered)[1].replace(/^\[([ xX])\]\s*/, (_, state) => state.toLowerCase() === 'x' ? '☑ ' : '☐ ');
    body.push(`<li>${inline(item)}</li>`);
    continue;
  }

  paragraph.push(trimmed);
}

flushParagraph();
closeList();

if (!title) title = path.basename(inputPath, path.extname(inputPath));
const firstParagraph = source.split(/\n\s*\n/).find((part) => !part.trim().startsWith('#')) || title;
const description = firstParagraph.replace(/[#>*_`|\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 150);

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--ink:#18212b;--muted:#5f6b78;--line:#dfe5ea;--brand:#175b57;--accent:#b45309;--soft:#f4f8f7;--paper:#fff}
    *{box-sizing:border-box}
    body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif;font-size:17px;line-height:1.78;letter-spacing:0}
    main{max-width:900px;margin:0 auto;padding:42px 22px 76px}
    h1{font-size:34px;line-height:1.28;margin:0 0 24px;color:#101820}
    h2{font-size:24px;line-height:1.4;margin:44px 0 16px;padding-bottom:9px;border-bottom:2px solid var(--line);color:#101820}
    h3{font-size:19px;line-height:1.45;margin:26px 0 10px;color:var(--brand)}
    p{margin:0 0 18px}
    ul,ol{padding-left:25px;margin:0 0 22px}
    li{margin:7px 0}
    main>h2:first-of-type+ol,main>h2:first-of-type+p{background:var(--soft);border-left:5px solid var(--brand);padding:18px 20px}
    blockquote{margin:18px 0 24px;padding:14px 18px;border-left:4px solid var(--accent);background:#fff8ed;color:#3f3322}
    .table-wrap{overflow-x:auto;margin:18px 0 28px}
    table{width:100%;border-collapse:collapse;font-size:15px;table-layout:fixed}
    th,td{border:1px solid var(--line);padding:11px 12px;text-align:left;vertical-align:top;word-break:break-word}
    th{background:#edf4f3;color:#174944}
    hr{border:0;border-top:1px solid var(--line);margin:40px 0 24px}
    code{background:#f3f4f6;padding:1px 4px;border-radius:3px}
    @media(max-width:640px){body{font-size:16px}main{padding:28px 16px 56px}h1{font-size:27px}h2{font-size:21px}table{min-width:620px;table-layout:auto}}
  </style>
</head>
<body>
<main>
${body.join('\n')}
</main>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, 'utf8');
