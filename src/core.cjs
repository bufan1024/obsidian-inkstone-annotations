'use strict';

const COLORS = new Set(['yellow', 'green', 'blue', 'rose']);
const KINDS = new Set(['underline', 'highlight', 'note']);

function validateRange(document, from, to) {
  if (typeof document !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > document.length) {
    throw new Error('选区位置无效，请重新选择文字。');
  }
  for (const offset of [from, to]) {
    if (offset > 0 && offset < document.length && /[\uD800-\uDBFF]/.test(document[offset - 1]) && /[\uDC00-\uDFFF]/.test(document[offset])) {
      throw new Error('选区不能截断一个字符，请重新选择。');
    }
  }
}

function isProtectedLine(document, from, context) {
  if (context) return context.protectedLines[from] > 0;
  const lineEnd = document.indexOf('\n', from);
  const lines = document.slice(0, lineEnd < 0 ? document.length : lineEnd).split(/\r\n|\n|\r/);
  let frontmatter = lines[0].replace(/^\uFEFF/, '').trim() === '---';
  let fence = null;
  let math = null;
  for (let index = 0; index < lines.length; index++) {
    const quotePrefix = lines[index].match(/^(?:[ \t]*>[ \t]?)+/)?.[0] || '';
    const quoteDepth = (quotePrefix.match(/>/g) || []).length;
    const line = lines[index].slice(quotePrefix.length).trim();
    const target = index === lines.length - 1;
    if (frontmatter) {
      if (target) return true;
      if (index > 0 && /^(---|\.\.\.)$/.test(line)) frontmatter = false;
      continue;
    }
    if (fence) {
      if (target) return true;
      const close = line.match(/^(`+|~+)\s*$/);
      if (quoteDepth === fence.depth && close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) fence = null;
      continue;
    }
    if (math !== null) {
      if (target) return true;
      if (quoteDepth === math && line === '$$') math = null;
      continue;
    }
    const open = line.match(/^(`{3,}|~{3,})/);
    if (open) {
      if (target) return true;
      fence = { marker: open[1], depth: quoteDepth };
    } else if (line.startsWith('$$')) {
      if (target) return true;
      math = line.slice(2).includes('$$') ? null : quoteDepth;
    }
  }
  return false;
}

function buildProtectedLineIndex(document) {
  const protectedLines = new Uint8Array(document.length);
  const firstLine = document.match(/^[^\r\n]*/)[0];
  let frontmatter = firstLine.replace(/^\uFEFF/, '').trim() === '---';
  let fence = null;
  let math = null;
  let index = 0;
  for (const sourceLine of document.matchAll(/[^\n]*(?:\n|$)/g)) {
    let protectedLine = 0;
    // isProtectedLine scans to the next LF, so isolated CRs (and the CR in
    // CRLF) make its final subline determine protection for that whole range.
    for (const source of sourceLine[0].replace(/\n$/, '').split('\r')) {
      const quotePrefix = source.match(/^(?:[ \t]*>[ \t]?)+/)?.[0] || '';
      const quoteDepth = (quotePrefix.match(/>/g) || []).length;
      const line = source.slice(quotePrefix.length).trim();
      protectedLine = frontmatter ? 1 : fence !== null ? 2 : math !== null ? 3 : 0;
      if (frontmatter) {
        if (index > 0 && /^(---|\.\.\.)$/.test(line)) frontmatter = false;
      } else if (fence) {
        const close = line.match(/^(`+|~+)\s*$/);
        if (quoteDepth === fence.depth && close && close[1][0] === fence.marker[0] && close[1].length >= fence.marker.length) fence = null;
      } else if (math !== null) {
        if (quoteDepth === math && line === '$$') math = null;
      } else {
        const open = line.match(/^(`{3,}|~{3,})/);
        if (open) {
          protectedLine = 2;
          fence = { marker: open[1], depth: quoteDepth };
        } else if (line.startsWith('$$')) {
          protectedLine = 3;
          math = line.slice(2).includes('$$') ? null : quoteDepth;
        }
      }
      index++;
    }
    if (protectedLine) protectedLines.fill(protectedLine, sourceLine.index, sourceLine.index + sourceLine[0].length);
  }
  return protectedLines;
}

function coversStructurePrefix(document, from) {
  const lineStart = document.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = document.indexOf('\n', from);
  let remainder = document.slice(lineStart, lineEnd < 0 ? document.length : lineEnd);
  let length = 0;
  let match;
  while ((match = remainder.match(/^[ \t]*(?:>[ \t]?|#{1,6}(?:[ \t]+|$)|(?:[-+*]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/))) {
    length += match[0].length;
    remainder = remainder.slice(match[0].length);
  }
  return from < lineStart + length;
}

function paragraphRange(document, from, context) {
  if (context) {
    if (!context.paragraphs) {
      context.paragraphs = [];
      let start = 0;
      for (const separator of document.matchAll(/\r?\n[ \t]*\r?\n/g)) {
        context.paragraphs.push({ start, end: separator.index });
        start = separator.index + separator[0].length;
      }
      context.paragraphs.push({ start, end: document.length });
    }
    let low = 0;
    let high = context.paragraphs.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (context.paragraphs[middle].end < from) low = middle + 1;
      else high = middle;
    }
    return context.paragraphs[low];
  }
  let start = 0;
  let end = document.length;
  for (const separator of document.matchAll(/\r?\n[ \t]*\r?\n/g)) {
    if (separator.index >= from) { end = separator.index; break; }
    start = separator.index + separator[0].length;
  }
  return { start, end };
}

function insideInlineCode(document, from, to, context) {
  const bounds = paragraphRange(document, from, context);
  if (!bounds.inlineCodeRanges) {
    const { start, end: paragraphEnd } = bounds;
    const paragraph = document.slice(start, paragraphEnd);
    const ticks = [...paragraph.matchAll(/`+/g)].filter(tick => !isProtectedLine(document, start + tick.index, context));
    const ranges = [];
    for (let index = 0; index < ticks.length; index++) {
      const open = ticks[index];
      if (isEscaped(paragraph, open.index)) continue;
      let close = index + 1;
      while (close < ticks.length && ticks[close][0] !== open[0]) close++;
      const nextLine = paragraph.indexOf('\n', open.index);
      const end = close < ticks.length ? ticks[close].index + ticks[close][0].length : nextLine < 0 ? paragraph.length : nextLine;
      ranges.push({ from: start + open.index, to: start + end });
      index = close;
    }
    bounds.inlineCodeRanges = ranges;
  }
  return overlapsRanges(bounds.inlineCodeRanges, from, to);
}

function isEscaped(text, offset) {
  let count = 0;
  while (offset > 0 && text[--offset] === '\\') count++;
  return count % 2 === 1;
}

function overlaps(from, to, start, end) {
  return from < end && to > start;
}

function overlapsRanges(ranges, from, to) {
  return !!overlappingRange(ranges, from, to);
}

function overlappingRange(ranges, from, to) {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].to <= from) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low].from < to ? ranges[low] : null;
}

function validateEntityBoundaries(document, from, to) {
  for (const entity of document.matchAll(/&(?:#(?:[xX][0-9a-fA-F]+|\d+)|[A-Za-z][A-Za-z0-9]+);/g)) {
    const end = entity.index + entity[0].length;
    if (overlaps(from, to, entity.index, end) && (from > entity.index || to < end)) {
      throw new Error('选区不能截断 HTML 实体，请重新选择完整字符。');
    }
  }
}

function htmlSyntaxProtection(document, from, to, context) {
  for (let index = 0; index < document.length; index++) {
    if (document[index] !== '<' || isEscaped(document, index)) continue;
    if (isProtectedLine(document, index, context) || insideInlineCode(document, index, index + 1, context)) continue;
    if (document.startsWith('<!--', index)) {
      const close = document.indexOf('-->', index + 4);
      const end = close < 0 ? document.length : close + 3;
      if (overlaps(from, to, index, end)) return 'html-comment';
      index = end - 1;
      continue;
    }
    if (!/^<\/?[A-Za-z]|^<![A-Za-z]|^<\?/.test(document.slice(index))) continue;
    let quote = null;
    let end = index + 1;
    for (; end < document.length; end++) {
      const character = document[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') { end++; break; }
    }
    if (overlaps(from, to, index, end)) return isAutolink(document.slice(index, end)) ? 'autolink' : 'html-syntax';
    index = end - 1;
  }
  return false;
}

function isIndentedCode(document, lineStart, line) {
  const stripQuote = value => value.replace(/^(?: {0,3}>[ \t]?)+/, '');
  const body = stripQuote(line);
  if (!/^(?: {4}| {0,3}\t)/.test(body)) return false;
  const indentation = body.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
  const previous = document.slice(0, lineStart).split(/\r\n|\n|\r/);
  for (let index = previous.length - 1; index >= 0; index--) {
    const content = stripQuote(previous[index]);
    if (!content.trim()) continue;
    const marker = content.match(/^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]+/);
    if (marker) return indentation >= marker[0].replace(/\t/g, '    ').length + 4;
    if (!/^[ \t]/.test(content)) break;
  }
  return true;
}

function insideLinkDestination(document, from, to, context) {
  const candidates = document.matchAll(/\][ \t]*(?:\r?\n[ \t]*)?[([]/g);
  const matches = context ? (context.linkCandidates ??= [...candidates]) : candidates;
  for (const match of matches) {
    if (isEscaped(document, match.index) || isProtectedLine(document, match.index, context) || insideInlineCode(document, match.index, match.index + 1, context)) continue;
    const open = match.index + match[0].length - 1;
    const marker = document[open];
    const close = marker === '(' ? ')' : ']';
    let depth = 1;
    let end = open + 1;
    for (; end < document.length && depth; end++) {
      if (isEscaped(document, end)) continue;
      if (document[end] === marker) depth++;
      if (document[end] === close) depth--;
      if (document[end] === '\n' && /^\s*\n/.test(document.slice(end + 1))) break;
    }
    if (overlaps(from, to, open, end)) return true;
  }
  return false;
}

function inlineSyntaxProtection(document, from, to, context) {
  let sourceLine = context?.inlineSyntaxLine;
  if (!sourceLine || from < sourceLine.from || from > sourceLine.to) {
    const start = document.lastIndexOf('\n', from - 1) + 1;
    const nextLine = document.indexOf('\n', from);
    const end = nextLine < 0 ? document.length : nextLine;
    const line = document.slice(start, end);
    const ranges = [];
    for (const token of line.matchAll(/!?\[\[[^\r\n]*?(?:\]\]|$)|\[\^[^\]\r\n]*(?:\]|$)/g)) {
      if (!isEscaped(line, token.index)) ranges.push({ from: start + token.index, to: start + token.index + token[0].length, kind: token[0].startsWith('[^') ? 'footnote-reference' : 'wiki-link' });
    }
    const protection = isIndentedCode(document, start, line) ? 'indented-code' : /^ {0,3}\[[^\]\r\n]+\]:/.test(line) ? 'reference-definition' : null;
    sourceLine = { from: start, to: end, ranges, protection };
    if (context) context.inlineSyntaxLine = sourceLine;
  }
  if (sourceLine.protection) return sourceLine.protection;
  if (insideLinkDestination(document, from, to, context)) return 'link-destination';
  if (insideInlineMath(document, from, to, context)) return 'inline-math';
  return overlappingRange(sourceLine.ranges, from, to)?.kind || null;
}

function insideInlineMath(document, from, to, context) {
  const bounds = paragraphRange(document, from, context);
  if (!bounds.inlineMathRanges) {
    const { start, end } = bounds;
    const paragraph = document.slice(start, end);
    const ranges = [];
    for (let index = 0; index < paragraph.length; index++) {
      if (isEscaped(paragraph, index) || !['$', '\\'].includes(paragraph[index])) continue;
      if (isProtectedLine(document, start + index, context) || insideInlineCode(document, start + index, start + index + 1, context)) continue;
      if (paragraph[index] === '$') {
        const marker = paragraph[index + 1] === '$' ? '$$' : '$';
        if (/\s/.test(paragraph[index + marker.length] || ' ')) continue;
        let close = index + marker.length;
        while ((close = paragraph.indexOf(marker, close)) >= 0) {
          if (!isEscaped(paragraph, close) && !/\s/.test(paragraph[close - 1]) && !/\d/.test(paragraph[close + marker.length] || '')) break;
          close += marker.length;
        }
        if (close >= 0) {
          ranges.push({ from: start + index, to: start + close + marker.length });
          index = close + marker.length - 1;
        }
      } else if (paragraph[index + 1] === '(' || paragraph[index + 1] === '[') {
        const close = paragraph.indexOf(paragraph[index + 1] === '(' ? '\\)' : '\\]', index + 2);
        if (close >= 0) {
          ranges.push({ from: start + index, to: start + close + 2 });
          index = close + 1;
        }
      }
    }
    bounds.inlineMathRanges = ranges;
  }
  return overlapsRanges(bounds.inlineMathRanges, from, to);
}

function insideUnsupportedHtml(document, from, to, context) {
  const stack = [];
  const token = /<(?:\/?[A-Za-z]|!|\?)/g;
  let match;
  while ((match = token.exec(document))) {
    if (match.index >= from) break;
    if (isEscaped(document, match.index) || isProtectedLine(document, match.index, context) || insideInlineCode(document, match.index, match.index + 1, context)) continue;
    const html = htmlTokenAt(document, match.index);
    if (!html) continue;
    token.lastIndex = html.end;
    if (!html.name || isAutolink(html.raw)) continue;
    if (html.closing) {
      const index = stack.findLastIndex(open => open.name === html.name);
      if (index >= 0) stack.length = index;
    } else if (!html.selfClosing && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(html.name)) {
      stack.push({ name: html.name, from: match.index });
    }
  }
  if (!stack.length) return false;
  const annotation = stack.length === 1 ? annotationAt(document, stack[0].from) : null;
  return !annotation || from < annotation.contentFrom || to > annotation.contentTo;
}

function unprotectedOffsets(document, offsets) {
  if (typeof document !== 'string') throw new Error('笔记内容必须是文字。');
  const ordered = [...new Set(offsets.filter(offset => Number.isInteger(offset) && offset >= 0 && offset < document.length))].sort((left, right) => left - right);
  if (!ordered.length) return [];
  const context = { protectedLines: buildProtectedLineIndex(document) };
  const allowed = new Set();
  const stack = [];
  const token = /<(?:\/?[A-Za-z]|!|\?)/g;
  let match = token.exec(document);
  let htmlEnd = -1;
  for (const offset of ordered) {
    while (match && match.index <= offset) {
      const from = match.index;
      if (isEscaped(document, from) || isProtectedLine(document, from, context) || insideInlineCode(document, from, from + 1, context) || inlineSyntaxProtection(document, from, from + 1, context)) {
        match = token.exec(document);
        continue;
      }
      let html = htmlTokenAt(document, from);
      // Declarations and processing instructions have no element name, but
      // their quoted attributes can still span a candidate heading.
      if (!html && /^<![A-Za-z]|^<\?/.test(document.slice(from))) {
        let quote = null;
        let end = from + 2;
        for (; end < document.length; end++) {
          const character = document[end];
          if (quote) { if (character === quote) quote = null; }
          else if (character === '"' || character === "'") quote = character;
          else if (character === '>') { end++; break; }
        }
        html = { end, name: null };
      }
      if (html) {
        htmlEnd = html.end;
        token.lastIndex = html.end;
        if (html.name && !isAutolink(html.raw)) {
          if (html.closing) {
            const open = stack.lastIndexOf(html.name);
            if (open >= 0) stack.length = open;
          } else if (!html.selfClosing && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(html.name)) stack.push(html.name);
        }
      }
      match = token.exec(document);
    }
    if (offset < htmlEnd || stack.length || isProtectedLine(document, offset, context) || insideInlineCode(document, offset, offset + 1, context) || inlineSyntaxProtection(document, offset, offset + 1, context)) continue;
    allowed.add(offset);
  }
  return offsets.filter(offset => allowed.has(offset));
}

function validateSelection({ document, from, to }) {
  validateRange(document, from, to);
  validateEntityBoundaries(document, from, to);
  const text = document.slice(from, to);
  if (!text.trim()) throw new Error('请先选择需要标注的文字。');
  if (/[\r\n]/.test(text)) throw new Error('请只选择同一行中的文字，分段添加标注。');
  if (coversStructurePrefix(document, from)) throw new Error('请只选择正文文字，不要包含标题、列表或引用的格式标记。');
  const context = { protectedLines: buildProtectedLineIndex(document) };
  const blockErrors = {
    1: '选区位于笔记属性（frontmatter）中，请改选正文文字。',
    2: '选区位于代码块中，请改选代码块外的正文文字。',
    3: '选区位于公式块中，请改选公式外的正文文字。',
  };
  if (isProtectedLine(document, from, context)) throw new Error(blockErrors[context.protectedLines[from]]);
  if (insideInlineCode(document, from, to, context)) throw new Error('选区包含行内代码，请避开反引号内的内容后重新选择。');
  const protection = htmlSyntaxProtection(document, from, to, context) || inlineSyntaxProtection(document, from, to, context);
  const inlineErrors = {
    'html-comment': '选区位于 HTML 注释中，请改选可见的正文文字。',
    'html-syntax': '选区包含 HTML 标签或属性，请只选择标签外的正文文字。',
    autolink: '选区位于自动链接地址中，请改选链接外的正文文字。',
    'indented-code': '选区位于缩进代码中，请改选代码块外的正文文字。',
    'reference-definition': '选区位于链接或脚注的引用定义中，请改选正文中的显示文字。',
    'link-destination': '选区位于链接目标或引用标识中，请改选链接显示文字或链接外的正文。',
    'inline-math': '选区包含行内公式，请避开公式后重新选择。',
    'wiki-link': '选区包含内部链接或嵌入内容，请改选链接外的正文文字。',
    'footnote-reference': '选区包含脚注引用标识，请改选引用编号外的正文文字。',
  };
  if (protection) throw new Error(inlineErrors[protection]);
  if (insideUnsupportedHtml(document, from, to, context)) throw new Error('选区位于暂不支持的 HTML 元素内，请改选 HTML 外的正文文字，或先简化这段 HTML。');
  const markdown = /`|\*\*|__|~~|==|\[\[|\]\]|\[\^|!\[|\[[^\]]*\]\s*\([^)]*\)|<\/?[A-Za-z][^>]*>|<!--|-->|\*[^*\r\n]+\*|_[^_\r\n]+_/;
  if (markdown.test(text)) throw new Error('选区含有 Markdown 或 HTML 格式，请只选择普通文字。');
  return text;
}

const HTML_ENTITIES = Object.freeze({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009', ndash: '–', mdash: '—',
  hellip: '…', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', middot: '·',
});
const HTML_NUMERIC_REPLACEMENTS = Object.freeze({
  128: 0x20ac, 130: 0x201a, 131: 0x192, 132: 0x201e, 133: 0x2026, 134: 0x2020,
  135: 0x2021, 136: 0x2c6, 137: 0x2030, 138: 0x160, 139: 0x2039, 140: 0x152,
  142: 0x17d, 145: 0x2018, 146: 0x2019, 147: 0x201c, 148: 0x201d, 149: 0x2022,
  150: 0x2013, 151: 0x2014, 152: 0x2dc, 153: 0x2122, 154: 0x161, 155: 0x203a,
  156: 0x153, 158: 0x17e, 159: 0x178,
});

function entityAt(text, offset) {
  const match = text.slice(offset).match(/^&(#(?:[xX][0-9a-fA-F]+|\d+)|[A-Za-z][A-Za-z0-9]+);/);
  if (!match) return null;
  let value;
  if (match[1][0] === '#') {
    const number = match[1][1].toLowerCase() === 'x' ? parseInt(match[1].slice(2), 16) : Number(match[1].slice(1));
    value = String.fromCodePoint(!number || number > 0x10ffff || number >= 0xd800 && number <= 0xdfff ? 0xfffd : HTML_NUMERIC_REPLACEMENTS[number] || number);
  } else value = Object.hasOwn(HTML_ENTITIES, match[1]) ? HTML_ENTITIES[match[1]] : undefined;
  return { value, length: match[0].length };
}

function projectText(raw, sourceOffset = 0) {
  let text = '';
  const starts = [];
  const ends = [];
  for (let offset = 0; offset < raw.length;) {
    const entity = raw[offset] === '&' ? entityAt(raw, offset) : null;
    if (entity && entity.value === undefined) return null;
    const value = entity ? entity.value : raw[offset];
    const length = entity ? entity.length : 1;
    text += value;
    for (let index = 0; index < value.length; index++) {
      starts.push(sourceOffset + offset);
      ends.push(sourceOffset + offset + length);
    }
    offset += length;
  }
  return { text, starts, ends };
}

function htmlTokenAt(document, from) {
  const match = document.slice(from).match(/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)\b/);
  if (!match) {
    if (document.startsWith('<!--', from)) {
      const close = document.indexOf('-->', from + 4);
      return { end: close < 0 ? document.length : close + 3, name: null };
    }
    return null;
  }
  let quote = null;
  let end = from + match[0].length;
  for (; end < document.length; end++) {
    const character = document[end];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') {
      end++;
      const raw = document.slice(from, end);
      return { end, raw, name: match[2].toLowerCase(), closing: !!match[1], selfClosing: /\/\s*>$/.test(raw) };
    }
  }
  return { end: document.length, name: null };
}

function isAutolink(raw) {
  if (typeof raw !== 'string') return false;
  return /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>\x00-\x20]*>$/.test(raw)
    || /^<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*>$/.test(raw);
}

function annotationAt(document, from) {
  const open = htmlTokenAt(document, from);
  if (!open || open.closing || open.selfClosing || !['u', 'mark'].includes(open.name)) return null;
  const attribute = open.raw.match(/^<(?:u|mark)\s+class\s*=\s*(["'])([^"']*)\1\s*>$/i);
  if (!attribute) return null;
  const classes = attribute[2].trim().split(/\s+/);
  const base = open.name === 'mark' ? 'inkstone-highlight' : 'inkstone-underline';
  if (!classes.includes(base) || new Set(classes).size !== classes.length) return null;
  const colors = classes.filter(value => value !== base);
  if (colors.length > 1 || colors.length && (open.name !== 'mark' || !/^inkstone-(yellow|green|blue|rose)$/.test(colors[0]))) return null;
  const close = new RegExp(`</${open.name}\\s*>`, 'ig');
  close.lastIndex = open.end;
  const match = close.exec(document);
  if (!match) return null;
  const content = document.slice(open.end, match.index);
  if (/[\r\n]|<(?:\/?[A-Za-z]|!|\?)/.test(content)) return null;
  const projection = projectText(content, open.end);
  if (!projection) return null;
  const to = match.index + match[0].length;
  const reference = document.slice(to).match(/^\[\^([^\]\r\n]+)\](?!:)/);
  const referenceTo = to + (reference ? reference[0].length : 0);
  return {
    from, to, contentFrom: open.end, contentTo: match.index, referenceTo,
    text: projection.text, kind: open.name === 'mark' ? 'highlight' : 'underline',
    color: colors.length ? colors[0].slice(9) : null,
    noteId: reference ? reference[1] : null, note: '', raw: document.slice(from, referenceTo),
  };
}

function footnoteKey(id) {
  return id.trim().replace(/[ \t]+/g, ' ').toLowerCase();
}

function footnoteDefinitions(document, context) {
  const lines = [...document.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)].filter(match => match[0]);
  const definitions = new Map();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index][0].replace(/[\r\n]+$/, '');
    const match = line.match(/^ {0,3}\[\^([^\]\r\n]+)\]:[ \t]?(.*)$/);
    if (!match || isProtectedLine(document, lines[index].index, context)) continue;
    const from = lines[index].index;
    const content = [match[2]];
    let to = from + lines[index][0].length;
    while (index + 1 < lines.length) {
      const next = lines[index + 1][0].replace(/[\r\n]+$/, '');
      const continuation = next.match(/^(?: {4}|\t)(.*)$/);
      if (!continuation) {
        if (!next && index + 2 < lines.length && /^(?: {4}|\t)/.test(lines[index + 2][0])) {
          content.push('');
          index++;
          to = lines[index].index + lines[index][0].length;
          continue;
        }
        break;
      }
      content.push(continuation[1]);
      index++;
      to = lines[index].index + lines[index][0].length;
    }
    const key = footnoteKey(match[1]);
    const entries = definitions.get(key) || [];
    entries.push({ from, to, note: content.join('\n') });
    definitions.set(key, entries);
  }
  return definitions;
}

function parseAnnotations(document) {
  if (typeof document !== 'string') throw new Error('笔记内容必须是文字。');
  const records = [];
  const context = { protectedLines: buildProtectedLineIndex(document) };
  const definitions = footnoteDefinitions(document, context);
  const stack = [];
  const token = /<(?:\/?[A-Za-z]|!|\?)/g;
  let match;
  while ((match = token.exec(document))) {
    const from = match.index;
    if (isEscaped(document, from) || isProtectedLine(document, from, context) || insideInlineCode(document, from, from + 1, context) || inlineSyntaxProtection(document, from, from + 1, context)) continue;
    const html = htmlTokenAt(document, from);
    if (!html) continue;
    token.lastIndex = html.end;
    if (isAutolink(html.raw)) continue;
    const annotation = stack.length ? null : annotationAt(document, from);
    if (annotation) {
      const entries = annotation.noteId ? definitions.get(footnoteKey(annotation.noteId)) : null;
      annotation.note = entries && entries.length === 1 ? entries[0].note : '';
      records.push(annotation);
      token.lastIndex = annotation.referenceTo;
    } else if (html.name) {
      if (html.closing) {
        const open = stack.lastIndexOf(html.name);
        if (open >= 0) stack.length = open;
      } else if (!html.selfClosing && !/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(html.name)) stack.push(html.name);
    }
  }
  return records;
}

function projectReadingParagraph(raw) {
  if (typeof raw !== 'string' || /[\r\n]/.test(raw)) return null;
  let text = '';
  const starts = [];
  const ends = [];
  for (let offset = 0; offset < raw.length;) {
    if (raw[offset] === '<' && /^<(?:\/?[A-Za-z]|!|\?)/.test(raw.slice(offset))) {
      const annotation = annotationAt(raw, offset);
      if (!annotation) return null;
      const content = projectText(raw.slice(annotation.contentFrom, annotation.contentTo), annotation.contentFrom);
      text += content.text;
      starts.push(...content.starts);
      ends.push(...content.ends);
      offset = annotation.referenceTo;
      continue;
    }
    const reference = raw.slice(offset).match(/^\[\^[^\]\r\n]+\](?!:)/);
    if (reference) { offset += reference[0].length; continue; }
    const entity = raw[offset] === '&' ? entityAt(raw, offset) : null;
    if (entity && entity.value === undefined) return null;
    const length = entity ? entity.length : 1;
    const content = projectText(raw.slice(offset, offset + length), offset);
    text += content.text;
    starts.push(...content.starts);
    ends.push(...content.ends);
    offset += length;
  }
  return { text, starts, ends };
}

function validateStyle(kind, color) {
  if (!KINDS.has(kind)) throw new Error('不支持此标注类型。');
  if (!COLORS.has(color)) throw new Error('不支持此标注颜色。');
}

function normalizeNote(note) {
  if (typeof note !== 'string') throw new Error('备注内容必须是文字。');
  return note.replace(/\r\n|\r/g, '\n').trim();
}

function freshNoteId(document, requested) {
  const used = new Set([...document.matchAll(/\[\^([^\]\r\n]+)\]/g)].map(match => footnoteKey(match[1])));
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !/^inkstone-[A-Za-z0-9][A-Za-z0-9-]*$/.test(requested)) throw new Error('备注编号无效。');
    if (used.has(footnoteKey(requested))) throw new Error('备注编号已存在，请重新添加备注。');
    return requested;
  }
  let sequence = 1;
  while (used.has(`inkstone-${sequence}`)) sequence++;
  return `inkstone-${sequence}`;
}

function annotationMarkup(content, kind, color, id) {
  const tag = kind === 'highlight' ? 'mark' : 'u';
  const classes = kind === 'highlight' ? `inkstone-highlight${color ? ` inkstone-${color}` : ''}` : 'inkstone-underline';
  return `<${tag} class="${classes}">${content}</${tag}>${id ? `[^${id}]` : ''}`;
}

function formatFootnote(id, note, newline, suffix = newline) {
  return note.split('\n').map((line, index) => index ? `    ${line}` : `[^${id}]: ${line}`).join(newline) + suffix;
}

function appendFootnote(document, changes, id, note) {
  const newline = document.includes('\r\n') ? '\r\n' : '\n';
  const separator = document.endsWith(newline + newline) ? '' : document.endsWith(newline) ? newline : newline + newline;
  const append = separator + formatFootnote(id, note, newline);
  const ending = changes.find(change => change.to === document.length);
  if (ending) ending.text += append;
  else changes.push({ from: document.length, to: document.length, text: append });
}

function buildAnnotationPlan(options) {
  const { document, from, to, kind, color = 'yellow', note, noteId } = options;
  validateRange(document, from, to);
  validateEntityBoundaries(document, from, to);
  const existing = from < to && parseAnnotations(document).find(record => from >= record.contentFrom && to <= record.contentTo);
  if (existing) return buildEditAnnotationPlan({ document, from: existing.from, kind, color, note });
  const selected = validateSelection({ document, from, to });
  validateStyle(kind, color);
  const content = normalizeNote(note === undefined ? '' : note);
  if (kind === 'note' && !content) throw new Error('请填写备注内容。');
  const id = content ? freshNoteId(document, noteId) : null;
  const projected = projectText(selected);
  if (!projected) throw new Error('选区包含暂不支持的 HTML 实体，请重新选择。');
  const escaped = projected.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const replacement = annotationMarkup(escaped, kind, color, id);
  const changes = [{ from, to, text: replacement }];
  if (id) appendFootnote(document, changes, id, content);
  return { changes, caretOffset: from + replacement.length, noteId: id };
}

function annotationForEdit(document, from) {
  validateRange(document, from, from);
  const record = parseAnnotations(document).find(annotation => annotation.from === from);
  if (!record) throw new Error('标注已变化或格式不受支持，请重新打开。');
  return record;
}

function privateFootnote(document, record) {
  if (!record.noteId || !/^inkstone-[A-Za-z0-9][A-Za-z0-9-]*$/.test(record.noteId)) return null;
  const definitions = footnoteDefinitions(document).get(footnoteKey(record.noteId)) || [];
  if (definitions.length > 1) throw new Error('备注编号有重复定义，请先在源码中处理。');
  let references = 0;
  for (const match of document.matchAll(/\[\^([^\]\r\n]+)\]/g)) {
    if (footnoteKey(match[1]) !== footnoteKey(record.noteId) || isEscaped(document, match.index)) continue;
    const lineStart = document.lastIndexOf('\n', match.index - 1) + 1;
    if (document[match.index + match[0].length] === ':' && /^ {0,3}$/.test(document.slice(lineStart, match.index))) continue;
    references++;
  }
  return references === 1 ? { definition: definitions[0] || null } : null;
}

function caretAfterChanges(from, replacement, changes) {
  return from + replacement.length + changes.filter(change => change.from !== from && change.to <= from).reduce((delta, change) => delta + change.text.length - (change.to - change.from), 0);
}

function buildEditAnnotationPlan({ document, from, kind, color, note }) {
  const record = annotationForEdit(document, from);
  const selectedKind = kind === undefined ? record.kind : kind;
  const selectedColor = color === undefined ? record.color : color;
  validateStyle(selectedKind, selectedColor === null ? 'yellow' : selectedColor);
  const content = note === undefined ? record.note : normalizeNote(note);
  if (selectedKind === 'note' && !content.trim()) throw new Error('请填写备注内容。');
  let id = record.noteId;
  let append = false;
  const changes = [];
  if (note !== undefined && (content !== record.note || !content && id)) {
    const owned = privateFootnote(document, record);
    if (!content) {
      id = null;
      if (owned?.definition) changes.push({ from: owned.definition.from, to: owned.definition.to, text: '' });
    } else if (id && owned) {
      if (owned.definition) {
        const previous = document.slice(owned.definition.from, owned.definition.to);
        const newline = previous.includes('\r\n') ? '\r\n' : document.includes('\r\n') ? '\r\n' : '\n';
        const suffix = previous.match(/(?:\r\n|\n|\r)$/)?.[0] || '';
        changes.push({ from: owned.definition.from, to: owned.definition.to, text: formatFootnote(id, content, newline, suffix) });
      } else append = true;
    } else {
      id = freshNoteId(document);
      append = true;
    }
  }
  const replacement = annotationMarkup(document.slice(record.contentFrom, record.contentTo), selectedKind, selectedColor, id);
  changes.unshift({ from, to: record.referenceTo, text: replacement });
  const caretOffset = caretAfterChanges(from, replacement, changes);
  if (append) appendFootnote(document, changes, id, content);
  return { changes, caretOffset, noteId: id };
}

function buildRemoveAnnotationPlan({ document, from }) {
  const record = annotationForEdit(document, from);
  const replacement = document.slice(record.contentFrom, record.contentTo);
  const changes = [{ from, to: record.referenceTo, text: replacement }];
  const owned = privateFootnote(document, record);
  if (owned?.definition) changes.push({ from: owned.definition.from, to: owned.definition.to, text: '' });
  return { changes, caretOffset: caretAfterChanges(from, replacement, changes), noteId: null };
}

function applyChanges(document, changes) {
  if (typeof document !== 'string' || !Array.isArray(changes)) throw new Error('笔记或修改内容无效。');
  for (const change of changes) {
    if (!change || typeof change.text !== 'string') throw new Error('修改内容必须是文字。');
    validateRange(document, change.from, change.to);
  }
  const sorted = [...changes].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 0; index < sorted.length; index++) {
    const change = sorted[index];
    const previous = sorted[index - 1];
    if (previous && (change.from < previous.to || change.from === previous.from)) throw new Error('修改范围不能重叠。');
  }
  return sorted.reduceRight((text, change) => text.slice(0, change.from) + change.text + text.slice(change.to), document);
}

module.exports = { buildAnnotationPlan, buildEditAnnotationPlan, buildRemoveAnnotationPlan, validateSelection, applyChanges, parseAnnotations, projectReadingParagraph, unprotectedOffsets };
