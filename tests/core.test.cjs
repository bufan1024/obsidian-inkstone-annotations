'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnnotationPlan, buildEditAnnotationPlan, buildRemoveAnnotationPlan, validateSelection, applyChanges, parseAnnotations, projectReadingParagraph } = require('../src/core.cjs');

const select = (document, text) => ({ document, from: document.indexOf(text), to: document.indexOf(text) + text.length });
const planFor = (document, text, options = {}) => buildAnnotationPlan({ ...select(document, text), kind: 'underline', ...options });

test('underline escapes HTML-sensitive text without losing surrounding text', () => {
  const document = '前言：A & B < 3 > 1。尾声';
  const plan = planFor(document, 'A & B < 3 > 1');
  assert.equal(applyChanges(document, plan.changes), '前言：<u class="inkstone-underline">A &amp; B &lt; 3 &gt; 1</u>。尾声');
  assert.equal(plan.noteId, null);
  assert.equal(plan.caretOffset, '前言：<u class="inkstone-underline">A &amp; B &lt; 3 &gt; 1</u>'.length);
});

test('highlight defaults to yellow and supports every documented color', () => {
  assert.equal(applyChanges('重点', planFor('重点', '重点', { kind: 'highlight' }).changes), '<mark class="inkstone-highlight inkstone-yellow">重点</mark>');
  for (const color of ['yellow', 'green', 'blue', 'rose']) {
    assert.equal(applyChanges('重点', planFor('重点', '重点', { kind: 'highlight', color }).changes), `<mark class="inkstone-highlight inkstone-${color}">重点</mark>`);
  }
});

test('note creates an underline, reference and appended footnote while keeping caret by the selection', () => {
  const document = '开头 重点 结尾\n\n后续笔记。';
  const plan = planFor(document, '重点', { kind: 'note', note: '  应当复习  ', noteId: 'inkstone-review-1' });
  assert.equal(applyChanges(document, plan.changes), '开头 <u class="inkstone-underline">重点</u>[^inkstone-review-1] 结尾\n\n后续笔记。\n\n[^inkstone-review-1]: 应当复习\n');
  assert.equal(plan.changes.length, 2);
  assert.equal(plan.noteId, 'inkstone-review-1');
  assert.equal(plan.caretOffset, '开头 <u class="inkstone-underline">重点</u>[^inkstone-review-1]'.length);
});

test('every kind can append a note and multiline footnotes use four-space continuation', () => {
  const plan = planFor('重点 后文', '重点', { kind: 'highlight', color: 'blue', note: '第一行\n第二行\n\n第四行', noteId: 'inkstone-lines' });
  assert.equal(applyChanges('重点 后文', plan.changes), '<mark class="inkstone-highlight inkstone-blue">重点</mark>[^inkstone-lines] 后文\n\n[^inkstone-lines]: 第一行\n    第二行\n    \n    第四行\n');
});

test('selection ending at EOF merges replacement and footnote append into one transaction change', () => {
  const plan = planFor('前文 重点', '重点', { note: '备注', noteId: 'inkstone-eof' });
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.changes[0], { from: 3, to: 5, text: '<u class="inkstone-underline">重点</u>[^inkstone-eof]\n\n[^inkstone-eof]: 备注\n' });
  assert.equal(plan.caretOffset, '前文 <u class="inkstone-underline">重点</u>[^inkstone-eof]'.length);
});

test('existing footnotes, content and line endings survive an append', () => {
  const document = '重点 和已有引用[^old]\r\n\r\n[^old]: 原备注\r\n';
  const plan = planFor(document, '重点', { note: '一\n二', noteId: 'inkstone-new' });
  assert.equal(applyChanges(document, plan.changes), '<u class="inkstone-underline">重点</u>[^inkstone-new] 和已有引用[^old]\r\n\r\n[^old]: 原备注\r\n\r\n[^inkstone-new]: 一\r\n    二\r\n');
});

test('automatic note ids skip every existing reference and definition', () => {
  const document = '重点 [^inkstone-1]\n\n[^inkstone-2]: 已有备注';
  const plan = planFor(document, '重点', { note: '新备注' });
  assert.equal(plan.noteId, 'inkstone-3');
  assert.match(applyChanges(document, plan.changes), /\[\^inkstone-3\]: 新备注\n$/);
});

test('whitespace-only note is ignored for underline and highlight', () => {
  const plan = planFor('重点', '重点', { note: ' \n ' });
  assert.equal(plan.noteId, null);
  assert.equal(applyChanges('重点', plan.changes), '<u class="inkstone-underline">重点</u>');
});

test('valid selection returns exactly the original UTF-16 slice', () => {
  assert.equal(validateSelection({ document: '前😀中文后', from: 1, to: 5 }), '😀中文');
  const plan = buildAnnotationPlan({ document: '前😀中文后', from: 1, to: 5, kind: 'underline' });
  assert.equal(applyChanges('前😀中文后', plan.changes), '前<u class="inkstone-underline">😀中文</u>后');
  assert.equal(plan.caretOffset, '前<u class="inkstone-underline">😀中文</u>'.length);
});

test('invalid ranges, empty selections, newlines and split surrogate pairs are rejected', () => {
  for (const input of [
    { document: '重点', from: -1, to: 1 },
    { document: '重点', from: 0, to: 3 },
    { document: '重点', from: 2, to: 1 },
    { document: '重点', from: 0.5, to: 1 },
    { document: '重点', from: 0, to: 0 },
    { document: '  ', from: 0, to: 2 },
    { document: '一\n二', from: 0, to: 3 },
    { document: '一\r\n二', from: 0, to: 4 },
    { document: '😀字', from: 1, to: 2 },
    { document: null, from: 0, to: 1 },
  ]) assert.throws(() => validateSelection(input), /[\u4e00-\u9fff]/);
});

test('selection with existing Markdown or HTML is rejected instead of flattening its formatting', () => {
  for (const text of ['`代码`', '**粗体**', '__粗体__', '*强调*', '_强调_', '~~删除~~', '==高亮==', '[[内部链接]]', '[外链](https://example.com)', '<b>文字</b>', '<!--注释-->', '[^备注]', '![[嵌入]]', '![图片](image.png)']) {
    assert.throws(() => planFor(text, text), /[\u4e00-\u9fff]/, text);
  }
});

test('ordinary asterisks, underscore names and comparisons remain annotatable', () => {
  for (const text of ['2 * 3', 'some_name', '1 < 2', 'A & B']) assert.equal(validateSelection({ document: text, from: 0, to: text.length }), text);
});

test('frontmatter, fenced code and display math content are protected', () => {
  for (const document of ['---\ntitle: 重点\n---\n正文', '```js\n重点\n```\n正文', '~~~\n重点\n~~~', '    ```\n重点\n    ```', '$$\n重点\n$$']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
  }
});

test('normal text after a closed protected block can still be annotated', () => {
  for (const document of ['---\ntitle: 标题\n---\n重点', '```\n代码\n```\n重点', '~~~~\n```\n~~~~\n重点', '$$\nx = y\n$$\n重点']) {
    assert.equal(validateSelection(select(document, '重点')), '重点');
  }
});

test('selecting block structure prefixes is rejected instead of turning the block into plain text', () => {
  for (const document of ['# 标题', '## 二级标题', '- 列表内容', '1. 有序列表', '> 引用内容', '> - 引用列表', '- [ ] 待办事项']) {
    assert.throws(() => validateSelection({ document, from: 0, to: document.length }), /[\u4e00-\u9fff]/, document);
  }
  for (const input of [
    { document: '# 标题', from: 0, to: 1 },
    { document: '  ## 标题', from: 2, to: 3 },
    { document: '- [ ] 待办', from: 2, to: 5 },
  ]) assert.throws(() => validateSelection(input), /[\u4e00-\u9fff]/);
});

test('plain text within headings, lists and quotes can still be annotated', () => {
  for (const document of ['## 普通正文', '- 普通正文', '1. 普通正文', '> 普通正文', '> - 普通正文', '- [ ] 普通正文']) {
    const plan = planFor(document, '普通正文');
    assert.equal(applyChanges(document, plan.changes), document.replace('普通正文', '<u class="inkstone-underline">普通正文</u>'));
  }
});

test('fenced code and display math nested in blockquotes remain protected', () => {
  for (const document of ['> ```js\n> 重点\n> ```', '> > ~~~\n> > 重点\n> > ~~~', '> $$\n> 重点\n> $$', '> > $$\n> > 重点\n> > $$']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
  }
});

test('normal text after quoted code or math blocks remains annotatable', () => {
  for (const document of ['> ```\n> 代码\n> ```\n> 重点', '> > ~~~\n> > 代码\n> > ~~~\n重点', '> $$\n> x = y\n> $$\n> 重点']) {
    assert.equal(validateSelection(select(document, '重点')), '重点');
  }
});

test('quoted fence characters inside an outer code block do not close that block', () => {
  const document = '```\n> ```\n重点\n```';
  assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/);
});

test('text inside inline code is protected but other text on that line is allowed', () => {
  assert.throws(() => validateSelection(select('`代码里的重点` 后文', '重点')), /[\u4e00-\u9fff]/);
  assert.equal(validateSelection(select('`代码` 后文', '后文')), '后文');
});

test('partial HTML tags, attributes and comments cannot be annotated', () => {
  for (const [document, text] of [
    ['前 <span title="重点">正文</span> 后', '重点'],
    ['前 <span data-title="a > 重点">正文</span> 后', '重点'],
    ['前 <span>正文</span> 后', 'span'],
    ['<!-- 隐藏的重点 --> 正文', '重点'],
    ['<span title="重点', '重点'],
  ]) assert.throws(() => validateSelection(select(document, text)), /[\u4e00-\u9fff]/, document);
});

test('Markdown link destinations and reference identifiers cannot be annotated', () => {
  for (const [document, text] of [
    ['[正文](https://example.com/重点)', '重点'],
    ['[正文](folder/重点(1).md "说明")', '重点'],
    ['[正文][重点]', '重点'],
    ['[ref]: https://example.com/重点 "标题"', '重点'],
    ['<https://example.com/重点>', '重点'],
    ['[[重点|别名]]', '重点'],
    ['正文[^重点]', '重点'],
  ]) assert.throws(() => validateSelection(select(document, text)), /[\u4e00-\u9fff]/, document);
  assert.equal(validateSelection(select('[正文](https://example.com) 后文', '后文')), '后文');
});

test('indented code and inline math are protected while neighboring prose remains available', () => {
  for (const document of ['    重点', '\t重点', '>     重点', '> \t重点', '正文 $x + 重点$ 后文', '正文 $$重点$$ 后文', '正文 \\(重点\\) 后文']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
  }
  for (const document of ['正文 $x + y$ 后文', '价格 $10 和 $20 后文', '\\$重点', '三空格\n   重点']) {
    const text = document.includes('重点') ? '重点' : '后文';
    assert.equal(validateSelection(select(document, text)), text);
  }
});

test('inline code delimiters of different lengths and fenced code keep their protection', () => {
  for (const document of ['``a ` 重点`` 后文', '前 `重点` 后', '~~~js\n重点\n~~~', '> ```js\n> 重点\n> ```']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
  }
});

test('invalid kind, color and empty note commands fail with a readable error', () => {
  for (const options of [{ kind: 'script' }, { kind: 'highlight', color: 'red' }, { color: 'red' }, { kind: 'note', note: '  ' }, { note: {} }]) {
    assert.throws(() => planFor('重点', '重点', options), /[\u4e00-\u9fff]/);
  }
});

test('unsafe or colliding note ids cannot inject markup or duplicate a footnote', () => {
  for (const noteId of ['other-id', 'inkstone-', 'inkstone-x] <script>', 'inkstone-x_1', 'inkstone-中文']) {
    assert.throws(() => planFor('重点', '重点', { note: '备注', noteId }), /[\u4e00-\u9fff]/);
  }
  for (const document of ['重点 [^inkstone-used]', '重点\n\n[^inkstone-used]: 已有']) {
    assert.throws(() => planFor(document, '重点', { note: '新备注', noteId: 'inkstone-used' }), /[\u4e00-\u9fff]/);
  }
});

test('applyChanges accepts unsorted independent edits in original-document coordinates', () => {
  assert.equal(applyChanges('abcdef', [{ from: 4, to: 6, text: '尾' }, { from: 0, to: 1, text: '头' }]), '头bcd尾');
  assert.equal(applyChanges('abcdef', [{ from: 0, to: 2, text: 'A' }, { from: 2, to: 4, text: 'B' }]), 'ABef');
});

test('applyChanges rejects overlaps, malformed changes and invalid ranges before applying anything', () => {
  for (const changes of [
    [{ from: 0, to: 3, text: '' }, { from: 2, to: 4, text: '' }],
    [{ from: 2, to: 2, text: 'a' }, { from: 2, to: 2, text: 'b' }],
    [{ from: -1, to: 0, text: '' }],
    [{ from: 0, to: 7, text: '' }],
    [{ from: 0, to: 1, text: null }],
    [{ from: 3, to: 2, text: '' }],
    [null, { from: 1, to: 2, text: '' }],
    [undefined],
  ]) assert.throws(() => applyChanges('abcdef', changes), /[\u4e00-\u9fff]/);
});

test('parseAnnotations reports precise source ranges, decoded text and multiline CRLF notes', () => {
  const raw = '<mark class="inkstone-highlight inkstone-blue">A &amp; 😀 &lt; 3</mark>[^inkstone-1]';
  const document = `前 ${raw} 后\r\n\r\n[^inkstone-1]: 第一行\r\n    第二行\r\n    \r\n    第四行\r\n\r\n用户后续正文\r\n`;
  assert.deepEqual(parseAnnotations(document), [{
    from: 2, to: 73, contentFrom: 49, contentTo: 66, referenceTo: 86,
    text: 'A & 😀 < 3', kind: 'highlight', color: 'blue', noteId: 'inkstone-1',
    note: '第一行\n第二行\n\n第四行', raw,
  }]);
});

test('parseAnnotations supports legacy underline, class ordering and missing footnote definitions', () => {
  const document = '<u class="inkstone-underline">一</u> <mark class=\'inkstone-rose inkstone-highlight\'>二</mark>[^inkstone-missing]';
  const records = parseAnnotations(document);
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, 'underline');
  assert.equal(records[0].color, null);
  assert.equal(records[0].noteId, null);
  assert.equal(records[0].note, '');
  assert.equal(records[1].color, 'rose');
  assert.equal(records[1].noteId, 'inkstone-missing');
  assert.equal(records[1].note, '');
});

test('parseAnnotations skips code, unknown attributes and unsafe nested wrappers', () => {
  const mark = '<u class="inkstone-underline">重点</u>';
  for (const document of [
    '`' + mark + '`', '```html\n' + mark + '\n```', '    ' + mark,
    '<div>' + mark + '</div>', '<u class="inkstone-underline"><b>重点</b></u>',
    '<u class="inkstone-underline" onclick="x">重点</u>',
    '<u class="inkstone-underline">前 ' + mark + '</u>',
  ]) assert.deepEqual(parseAnnotations(document), [], document);
});

test('reading projection maps repeated text, wrappers, footnotes, entities and emoji in UTF-16 units', () => {
  const raw = '同 A&amp;😀 <u class="inkstone-underline">同</u>[^old] 同 &#x1F600;';
  const projected = projectReadingParagraph(raw);
  assert.equal(projected.text, '同 A&😀 同 同 😀');
  assert.equal(projected.starts.length, projected.text.length);
  assert.equal(projected.ends.length, projected.text.length);
  assert.deepEqual(projected.starts.slice(0, 6), [0, 1, 2, 3, 8, 9]);
  assert.deepEqual(projected.ends.slice(0, 6), [1, 2, 3, 8, 9, 10]);
  assert.equal(raw.slice(projected.starts[7], projected.ends[7]), '同');
  assert.equal(raw.slice(projected.starts.at(-2), projected.ends.at(-1)), '&#x1F600;');
  assert.equal(projected.starts.at(-2), projected.starts.at(-1));
  assert.equal(projected.ends.at(-2), projected.ends.at(-1));
  assert.equal(projectReadingParagraph('&amp;lt; &quot;x&quot; &nbsp;').text, '&lt; "x" \u00a0');
});

test('reading projection refuses unknown HTML and malformed or nested annotations', () => {
  for (const raw of ['<b>重点</b>', '<u class="inkstone-underline">重点', '<u class="inkstone-underline"><u class="inkstone-underline">重点</u></u>', '<u class="inkstone-underline">重点</mark>', '<!--隐藏-->正文', '<u class="inkstone-underline" data-x="1">重点</u>']) {
    assert.equal(projectReadingParagraph(raw), null, raw);
  }
  assert.equal(projectReadingParagraph('普通文字 1 < 2').text, '普通文字 1 < 2');
});

test('selecting existing annotation content updates its whole wrapper and preserves an omitted note', () => {
  const document = '前 <u class="inkstone-underline">一重点二 &amp; 三</u>[^inkstone-1] 后\n\n[^inkstone-1]: 旧备注\n';
  const plan = planFor(document, '重点', { kind: 'highlight', color: 'rose' });
  assert.equal(applyChanges(document, plan.changes), '前 <mark class="inkstone-highlight inkstone-rose">一重点二 &amp; 三</mark>[^inkstone-1] 后\n\n[^inkstone-1]: 旧备注\n');
  assert.equal(plan.noteId, 'inkstone-1');
});

test('editing a private multiline footnote keeps its id, CRLF and following user content', () => {
  const document = '<mark class="inkstone-highlight inkstone-yellow">重点</mark>[^inkstone-1]\r\n\r\n[^inkstone-1]: 旧备注\r\n    旧续行\r\n\r\n用户后来写的内容\r\n';
  const plan = buildEditAnnotationPlan({ document, from: 0, color: 'blue', note: '新第一行\n\n新第三行' });
  assert.equal(applyChanges(document, plan.changes), '<mark class="inkstone-highlight inkstone-blue">重点</mark>[^inkstone-1]\r\n\r\n[^inkstone-1]: 新第一行\r\n    \r\n    新第三行\r\n\r\n用户后来写的内容\r\n');
  assert.equal(plan.noteId, 'inkstone-1');
  assert.equal(plan.caretOffset, '<mark class="inkstone-highlight inkstone-blue">重点</mark>[^inkstone-1]'.length);
});

test('editing a shared footnote allocates a fresh id and leaves every old reference and definition intact', () => {
  const document = '<u class="inkstone-underline">重点</u>[^inkstone-1] 其他[^inkstone-1]\n\n[^inkstone-1]: 共享备注\n';
  const plan = buildEditAnnotationPlan({ document, from: 0, note: '独立备注' });
  assert.equal(applyChanges(document, plan.changes), '<u class="inkstone-underline">重点</u>[^inkstone-2] 其他[^inkstone-1]\n\n[^inkstone-1]: 共享备注\n\n[^inkstone-2]: 独立备注\n');
  assert.equal(plan.noteId, 'inkstone-2');
});

test('removing an annotation unwraps its source content and cleans only its unshared owned definition', () => {
  const document = '前 <u class="inkstone-underline">A &amp; &lt;b&gt;</u>[^inkstone-1] 后\n\n[^inkstone-1]: 备注\n    续行\n\n后续文字\n';
  const plan = buildRemoveAnnotationPlan({ document, from: 2 });
  assert.equal(applyChanges(document, plan.changes), '前 A &amp; &lt;b&gt; 后\n\n\n后续文字\n');
  assert.equal(plan.caretOffset, '前 A &amp; &lt;b&gt;'.length);
  assert.equal(plan.noteId, null);
  const shared = '<u class="inkstone-underline">重点</u>[^inkstone-1] 其他[^inkstone-1]\n\n[^inkstone-1]: 备注\n';
  assert.equal(applyChanges(shared, buildRemoveAnnotationPlan({ document: shared, from: 0 }).changes), '重点 其他[^inkstone-1]\n\n[^inkstone-1]: 备注\n');
});

test('clearing a note keeps the annotation, and adding a note at EOF stays in one change', () => {
  const document = '<u class="inkstone-underline">重点</u>[^inkstone-1]\n\n[^inkstone-1]: 备注\n';
  const cleared = buildEditAnnotationPlan({ document, from: 0, note: '' });
  assert.equal(applyChanges(document, cleared.changes), '<u class="inkstone-underline">重点</u>\n\n');
  assert.equal(cleared.noteId, null);
  const bare = '<u class="inkstone-underline">重点</u>';
  const added = buildEditAnnotationPlan({ document: bare, from: 0, note: '新备注' });
  assert.equal(added.changes.length, 1);
  assert.equal(applyChanges(bare, added.changes), '<u class="inkstone-underline">重点</u>[^inkstone-1]\n\n[^inkstone-1]: 新备注\n');
});

test('footnote definitions before annotations update caret offsets and preserve their final newline', () => {
  const document = '[^inkstone-1]: 备注\n\n前 <u class="inkstone-underline">重点</u>[^inkstone-1] 后';
  const from = document.indexOf('<u');
  const plan = buildRemoveAnnotationPlan({ document, from });
  assert.equal(applyChanges(document, plan.changes), '\n前 重点 后');
  assert.equal(plan.caretOffset, '\n前 重点'.length);
});

test('stale, partial, unsupported annotations and duplicate note definitions reject edits safely', () => {
  const document = '<u class="inkstone-underline">重点</u>';
  for (const operation of [buildEditAnnotationPlan, buildRemoveAnnotationPlan]) {
    for (const from of [-1, 1, 30, document.length]) assert.throws(() => operation({ document, from }), /[\u4e00-\u9fff]/);
    assert.throws(() => operation({ document: '<u class="inkstone-underline"><b>重点</b></u>', from: 0 }), /[\u4e00-\u9fff]/);
  }
  for (const options of [{ kind: 'bad' }, { color: 'red' }, { note: {} }]) {
    assert.throws(() => buildEditAnnotationPlan({ document, from: 0, ...options }), /[\u4e00-\u9fff]/);
  }
  const duplicate = document + '[^inkstone-1]\n\n[^inkstone-1]: 一\n[^inkstone-1]: 二\n';
  assert.throws(() => buildEditAnnotationPlan({ document: duplicate, from: 0, note: '三' }), /[\u4e00-\u9fff]/);
});

test('new annotations preserve rendered entities instead of decoding twice or double escaping', () => {
  const document = '前 A &amp; &#x1F600; &amp;lt; 后';
  const plan = planFor(document, 'A &amp; &#x1F600; &amp;lt;');
  assert.equal(applyChanges(document, plan.changes), '前 <u class="inkstone-underline">A &amp; 😀 &amp;lt;</u> 后');
});

test('multiline HTML attributes and Markdown link destinations remain protected', () => {
  for (const document of ['<span\n title="重点">正文</span>', '[正文](\n  https://example.com/重点\n)', '[正文](\n  <https://example.com/重点>\n  "标题"\n)']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
  }
});

test('HTML-looking text in code cannot hide later prose or real annotations', () => {
  const mark = '<u class="inkstone-underline">重点</u>';
  for (const document of ['```html\n<!--\n```\n普通正文 ' + mark, '`<span title="` 普通正文 ' + mark, '`[正文](` 普通正文 ' + mark]) {
    assert.equal(validateSelection(select(document, '普通正文')), '普通正文', document);
    assert.equal(parseAnnotations(document).length, 1, document);
  }
});

test('indented list prose stays annotatable while deeper code indentation stays protected', () => {
  for (const document of ['- 正文\n    普通正文', '1. 正文\n    普通正文', '> - 正文\n>     普通正文']) {
    assert.equal(validateSelection(select(document, '普通正文')), '普通正文', document);
  }
  for (const document of ['- 正文\n      代码', '1. 正文\n       代码', '> - 正文\n>       代码']) {
    assert.throws(() => validateSelection(select(document, '代码')), /[\u4e00-\u9fff]/, document);
  }
});

test('partial entity selections are refused so annotation cannot corrupt the remaining source', () => {
  for (const text of ['amp', '&am', 'mp;', '#x1F600']) {
    const document = 'A &amp; &#x1F600; B';
    assert.throws(() => planFor(document, text), /[\u4e00-\u9fff]/, text);
    assert.throws(() => validateSelection(select(document, text)), /[\u4e00-\u9fff]/, text);
  }
  assert.equal(applyChanges('A &amp; B', planFor('A &amp; B', '&amp;').changes), 'A <u class="inkstone-underline">&amp;</u> B');
});

test('numeric HTML entities follow browser replacement rules for invalid and C1 codepoints', () => {
  assert.equal(projectReadingParagraph('&#128; &#x80; &#0; &#xD800; &#x110000;').text, '€ € � � �');
});

test('editing a note preserves a legacy highlight without a color class', () => {
  const document = '<mark class="inkstone-highlight">重点</mark>';
  const plan = buildEditAnnotationPlan({ document, from: 0, note: '备注' });
  assert.equal(applyChanges(document, plan.changes), '<mark class="inkstone-highlight">重点</mark>[^inkstone-1]\n\n[^inkstone-1]: 备注\n');
});

test('case variants of footnote ids count as shared and reserve their generated id', () => {
  const document = '<u class="inkstone-underline">重点</u>[^inkstone-1] 其他[^INKSTONE-1]\n\n[^inkstone-1]: 共享\n';
  const removed = buildRemoveAnnotationPlan({ document, from: 0 });
  assert.equal(applyChanges(document, removed.changes), '重点 其他[^INKSTONE-1]\n\n[^inkstone-1]: 共享\n');
  assert.equal(planFor('重点 [^INKSTONE-1]', '重点', { note: '新' }).noteId, 'inkstone-2');
});

test('new annotations reject content nested inside unsupported or malformed HTML', () => {
  for (const document of ['<b>重点</b>', '<u class="inkstone-underline"><b>重点</b></u>', '<u class="inkstone-underline">重点', '<span title="x">重点</span>']) {
    assert.throws(() => planFor(document, '重点'), /[\u4e00-\u9fff]/, document);
  }
  assert.equal(validateSelection(select('<https://example.com> 后文', '后文')), '后文');
});

test('inline code and math spanning source lines protect their inner text without hiding following prose', () => {
  for (const document of ['前 `code\n重点` 后文', '前 $x +\n重点$ 后文', '前 \\(x +\n重点\\) 后文']) {
    assert.throws(() => validateSelection(select(document, '重点')), /[\u4e00-\u9fff]/, document);
    assert.equal(validateSelection(select(document, '后文')), '后文', document);
  }
});

test('unsupported named entities are rejected without consulting inherited object properties', () => {
  for (const raw of ['&eacute;', '&constructor;', '&toString;']) {
    assert.equal(projectReadingParagraph(raw), null, raw);
    assert.deepEqual(parseAnnotations(`<u class="inkstone-underline">${raw}</u>`), [], raw);
    assert.throws(() => planFor(raw, raw), /[\u4e00-\u9fff]/, raw);
  }
});

test('URI and email autolinks cannot hide later annotations or cause a nested update', () => {
  for (const link of ['<https://example.com>', '<mailto:reader@example.com>', '<reader@example.com>', '<first.last+notes@example.co.uk>']) {
    const document = `参见 ${link}\n\n<u class="inkstone-underline">重点</u>`;
    const records = parseAnnotations(document);
    assert.equal(records.length, 1, link);
    assert.equal(records[0].text, '重点');
    const plan = planFor(document, '重点', { kind: 'highlight', color: 'green' });
    assert.equal(applyChanges(document, plan.changes), `参见 ${link}\n\n<mark class="inkstone-highlight inkstone-green">重点</mark>`, link);
    assert.equal(validateSelection(select(`参见 ${link} 普通正文`, '普通正文')), '普通正文', link);
  }
});

test('HTML-looking text inside a comment or attribute cannot pollute following prose', () => {
  for (const document of ['<!-- 示例 <div> -->\n普通正文', '<img alt="<div>"> 普通正文']) {
    assert.equal(validateSelection(select(document, '普通正文')), '普通正文', document);
    assert.equal(applyChanges(document, planFor(document, '普通正文').changes), document.replace('普通正文', '<u class="inkstone-underline">普通正文</u>'));
    assert.throws(() => validateSelection(select(document, 'div')), /[\u4e00-\u9fff]/, document);
  }
});
