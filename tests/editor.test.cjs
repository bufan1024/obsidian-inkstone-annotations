'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { visibleAnnotations } = require('../src/editor.cjs');

const first = { from: 10, to: 45, referenceTo: 60, text: '甲', kind: 'highlight', color: 'yellow' };
const second = { from: 80, to: 115, referenceTo: 115, text: '乙', kind: 'underline', color: null };

test('source mode never conceals annotation markup', () => {
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 0, to: 0 }], false), []);
});

test('an inactive annotation remains rendered while the cursor is elsewhere', () => {
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 70, to: 70 }], true), [first, second]);
});

test('entering any part of a wrapper or its attached note reference reveals its source', () => {
  for (const cursor of [10, 22, 45, 55, 60]) {
    assert.deepEqual(visibleAnnotations([first, second], [{ from: cursor, to: cursor }], true), [second]);
  }
});

test('a selection crossing an annotation reveals it even with both endpoints outside', () => {
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 0, to: 70 }], true), [second]);
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 30, to: 90 }], true), []);
});

test('all cursors participate and adjacent nonempty selections leave markup rendered', () => {
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 0, to: 10 }, { from: 115, to: 130 }], true), [first, second]);
  assert.deepEqual(visibleAnnotations([first, second], [{ from: 0, to: 0 }, { from: 90, to: 90 }], true), [first]);
});

function editorFixture() {
  const core = require('../src/core.cjs');
  let parses = 0;
  const editor = {}, infoField = {}, liveField = {};
  const view = { editor };
  const api = {
    obsidian: { editorInfoField: infoField, editorLivePreviewField: liveField },
    '@codemirror/state': { Prec: { highest: extension => extension }, StateField: { define: definition => definition } },
    '@codemirror/view': {
      WidgetType: class {},
      EditorView: { decorations: { from: field => field } },
      Decoration: { none: [], set: ranges => ranges, replace: spec => ({ range: (from, to) => ({ from, to, spec }) }) },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/editor.cjs'), 'utf8'), {
    module,
    require: name => { assert(name in api); return api[name]; },
    annotationCore: { parseAnnotations: source => { parses += 1; return core.parseAnnotations(source); } },
  });
  const extension = module.exports.createEditorExtension({ app: { workspace: { getLeavesOfType: () => [{ view }] } } });
  return {
    extension,
    get parses() { return parses; },
    state(doc, cursor) {
      return { doc, selection: { ranges: [{ from: cursor, to: cursor }] }, field: key => key === liveField ? true : key === infoField ? { file: { path: '笔记.md' }, editor } : undefined };
    },
  };
}

test('moving the selection toggles source without rescanning an unchanged document', () => {
  const fixture = editorFixture();
  const source = '前 <u class="inkstone-underline">甲</u> 后';
  const doc = { toString: () => source };
  const rendered = fixture.extension.create(fixture.state(doc, source.length));
  assert.equal(rendered.length, 1);
  const active = fixture.extension.update(rendered, { state: fixture.state(doc, source.indexOf('甲')) });
  assert.equal(active.length, 0);
  const renderedAgain = fixture.extension.update(active, { state: fixture.state(doc, source.length) });
  assert.equal(renderedAgain.length, 1);
  assert.equal(fixture.parses, 1);
});

test('a new document refreshes records and keeps prior widget snapshots unchanged', () => {
  const fixture = editorFixture();
  const original = '前 <u class="inkstone-underline">甲</u> 后';
  const updated = '前 <u class="inkstone-underline">乙</u> 后';
  const first = fixture.extension.create(fixture.state({ toString: () => original }, original.length));
  const next = fixture.extension.update(first, { state: fixture.state({ toString: () => updated }, updated.length) });
  assert.equal(next[0].spec.widget.record.text, '乙');
  assert.equal(next[0].spec.widget.context.snapshot, updated);
  assert.equal(first[0].spec.widget.context.snapshot, original);
  assert.equal(first[0].spec.widget.record.text, '甲');
  assert.equal(fixture.parses, 2);
});
