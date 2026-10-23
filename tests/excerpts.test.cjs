'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExcerptLines } = require('../src/excerpts.cjs');

const generatedAt = '2026-10-23T07:00:00.000Z';
const heading = (text, level, offset) => ({ heading: text, level, position: { start: { line: 0, col: 0, offset }, end: { line: 0, col: 1, offset: offset + 1 } } });
const render = options => buildExcerptLines({ sourceName: '原笔记', sourceLink: '[原文](source.md)', generatedAt, records: [], ...options });

test('excerpts preserve every record, Markdown notes and explicit snapshot metadata', () => {
  const records = [
    { from: 5, kind: 'underline', text: '第一条', note: '**想法**\n\n- 保留清单' },
    { from: 15, kind: 'highlight', color: 'green', text: '第二条', note: '[参考](https://example.com)' },
    { from: 25, kind: 'highlight', color: null, text: '第三条', note: '' },
  ];
  const before = structuredClone(records);
  const lines = render({ records });
  assert.deepEqual(lines, [
    '# 原笔记 · 墨读摘录', '', '来源：[原文](source.md)', `快照生成时间：${generatedAt}`, '',
    '## 1. 下划线', '', '来源：[原文](source.md)', '', '> 第一条', '', '备注：', '', '**想法**\n\n- 保留清单', '',
    '## 2. 绿色', '', '来源：[原文](source.md)', '', '> 第二条', '', '备注：', '', '[参考](https://example.com)', '',
    '## 3. 高亮', '', '来源：[原文](source.md)', '', '> 第三条', '',
  ]);
  assert.deepEqual(records, before);
});

test('nested and repeated headings use the nearest heading object and current ancestor path', () => {
  const first = heading('重复', 1, 10);
  const child = heading('细节', 3, 20);
  const sibling = heading('同级', 2, 30);
  const repeated = heading('重复', 1, 40);
  const headings = [repeated, child, first, sibling];
  const records = [
    { from: 5, kind: 'underline', text: '开篇', note: '' },
    { from: 25, kind: 'underline', text: '细节内容', note: '' },
    { from: 35, kind: 'underline', text: '同级内容', note: '' },
    { from: 45, kind: 'underline', text: '重复内容', note: '' },
  ];
  const before = structuredClone({ headings, records });
  const links = new Map([[child, '[细节位置](safe-child.md)'], [sibling, '[同级位置](safe-sibling.md)'], [repeated, '[重复位置](safe-repeated.md)']]);
  const lines = render({ records, headings, linkForHeading: item => links.get(item) });
  assert.deepEqual(lines.filter(line => /^(来源|位置)：/.test(line)), [
    '来源：[原文](source.md)', '来源：[原文](source.md)',
    '位置：重复 › 细节（[细节位置](safe-child.md)）',
    '位置：重复 › 同级（[同级位置](safe-sibling.md)）',
    '位置：重复（[重复位置](safe-repeated.md)）',
  ]);
  assert.deepEqual({ headings, records }, before);
});

test('excerpt literals and heading paths cannot become Markdown markup', () => {
  const parent = heading('[标题](unsafe.md)', 1, 0);
  const child = heading('*段落* <script>', 2, 10);
  const lines = render({
    sourceName: '[危险] **标题**',
    headings: [parent, child],
    linkForHeading: () => '[返回标题](safe.md)',
    records: [{ from: 20, kind: 'highlight', text: '[x](javascript:alert(1))\n> <script> &amp; `code`', note: '**保留备注**' }],
    labelForRecord: () => '*自定义*',
  });
  assert.equal(lines[0], '# \\[危险\\] \\*\\*标题\\*\\* · 墨读摘录');
  assert.ok(lines.includes('## 1. \\*自定义\\*'));
  assert.ok(lines.includes('位置：\\[标题\\]\\(unsafe\\.md\\) › \\*段落\\* \\<script\\>（[返回标题](safe.md)）'));
  assert.ok(lines.includes('> \\[x\\]\\(javascript:alert\\(1\\)\\)'));
  assert.ok(lines.includes('> \\> \\<script\\> \\&amp; \\`code\\`'));
  assert.ok(lines.includes('**保留备注**'));
});

test('translation hooks return templates and preserve custom record labels', () => {
  const messages = new Map([
    ['墨读摘录', 'Inkstone excerpts'],
    ['来源：{link}', 'Source: {link}'],
    ['快照生成时间：{generatedAt}', 'Snapshot created: {generatedAt}'],
    ['位置：{path}{link}', 'Section: {path}{link}'],
    ['备注：', 'Note:'],
  ]);
  const lines = render({
    headings: [heading('Part', 1, 0)],
    linkForHeading: () => '[Go](safe.md)',
    records: [{ from: 10, text: 'Text', note: '*Note*', color: 'yellow' }],
    labelForRecord: record => record.color === 'yellow' ? 'Review' : 'Other',
    t: (source, params) => {
      assert.equal(params, undefined);
      return messages.get(source) || source;
    },
  });
  assert.equal(lines[0], '# 原笔记 · Inkstone excerpts');
  assert.ok(lines.includes('Source: [原文](source.md)'));
  assert.ok(lines.includes(`Snapshot created: ${generatedAt}`));
  assert.ok(lines.includes('Section: Part（[Go](safe.md)）'));
  assert.ok(lines.includes('## 1. Review'));
  assert.ok(lines.includes('Note:'));
});


test('export parameters are substituted once even when source links contain template syntax', () => {
  const {translate} = require('../src/i18n.cjs');
  const link = '[[notes/{link}|{generatedAt}]]';
  const lines = buildExcerptLines({sourceName:'note',records:[],sourceLink:link,generatedAt:'2026-10-23',t:(source,params)=>translate('en',source,params)});
  assert.equal(lines[2], 'Source: ' + link);
});
