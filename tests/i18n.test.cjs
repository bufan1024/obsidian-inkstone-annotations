'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translate } = require('../src/i18n.cjs');

test('English translates complete interface messages across annotation and reading controls', () => {
  const messages = [
    ['当前笔记标注', 'Current note annotations'],
    ['搜索摘录和想法', 'Search excerpts and thoughts'],
    ['仅有想法', 'With thoughts only'],
    ['清空筛选', 'Clear filters'],
    ['编辑想法', 'Edit thought'],
    ['墨读：添加下划线', 'Inkstone: Add underline'],
    ['墨读：下一条标注', 'Inkstone: Next annotation'],
    ['复制草稿', 'Copy draft'],
    ['汇总墨读摘录', 'Collect Inkstone excerpts'],
    ['阅读行高', 'Reading line height'],
    ['选区位于代码块中，请改选代码块外的正文文字。', 'The selection is in a code block. Select body text outside the code block.'],
    ['未能打开标注，请重新选择。', 'Could not open the annotation. Select it again.'],
  ];
  for (const [source, expected] of messages) assert.equal(translate('en', source), expected);
});

test('Chinese is the default and unknown languages and messages retain their source wording', () => {
  assert.equal(translate(undefined, '导出全部'), '导出全部');
  assert.equal(translate('zh', '导出全部'), '导出全部');
  assert.equal(translate('fr', '导出全部'), '导出全部');
  assert.equal(translate('en', '新增但尚未翻译的提示。'), '新增但尚未翻译的提示。');
  assert.equal(translate('en', 'constructor'), 'constructor');
});

test('formatting interpolates owned parameters once without changing literal user text', () => {
  assert.equal(translate('en', '{shown} / {total} 条标注', { shown: 0, total: 12 }), '0 / 12 annotations');
  assert.equal(translate('zh', '当前笔记：{filePath}', { filePath: '阅读/取消与保存.md' }), '当前笔记：阅读/取消与保存.md');
  assert.equal(translate('en', '当前笔记：{filePath}', { filePath: '阅读/取消与保存.md' }), 'Current note: 阅读/取消与保存.md');
  assert.equal(translate('en', '编辑标注：{text}', { text: '写想法 {total} <b>原文</b>' }), 'Edit annotation: 写想法 {total} <b>原文</b>');
  assert.equal(translate('en', '我想先取消，再写想法。'), '我想先取消，再写想法。');
  assert.equal(translate('en', '想法：{note}', { note: '删除标注' }), 'Thought: 删除标注');
});

test('missing or inherited parameters stay visible instead of leaking prototype values', () => {
  assert.equal(translate('en', '{shown} / {total} 条标注', { shown: 2 }), '2 / {total} annotations');
  assert.equal(translate('en', '值：{constructor}', {}), '值：{constructor}');
  assert.equal(translate('en', '值：{flag}', { flag: false }), '值：false');
  assert.equal(translate('en', '值：{missing}', null), '值：{missing}');
});
