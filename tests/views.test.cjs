'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

class Element extends EventTarget {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.classList = {
      add: value => { this.className = `${this.className} ${value}`.trim(); },
      remove: value => { this.className = this.className.split(' ').filter(item => item !== value).join(' '); },
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

class Events {
  constructor() { this.handlers = new Set(); }
  on(name, callback) { const ref = { name, callback }; this.handlers.add(ref); return ref; }
  offref(ref) { this.handlers.delete(ref); }
  emit(name, ...args) { for (const ref of this.handlers) if (ref.name === name) ref.callback(...args); }
}

const record = (from, kind, color, text, note = '') => ({ from, to: from + 20, referenceTo: from + 20, contentFrom: from + 4, contentTo: from + 5, text, kind, color, noteId: null, note, raw: 'wrapper' });
const allNodes = element => [element, ...element.children.flatMap(allNodes)];
const text = element => allNodes(element).map(node => node.textContent).join(' ');
const button = (view, label) => allNodes(view.contentEl).find(node => node.tagName === 'button' && node.textContent === label);
const cards = view => allNodes(view.contentEl).filter(node => node.className === 'inkstone-annotation-card');

function setup() {
  const workspace = new Events();
  const vault = new Events();
  const document = { createElement: tagName => new Element(tagName, document) };
  const app = { workspace, vault };
  class ItemView {
    constructor(leaf) { this.leaf = leaf; this.app = app; this.contentEl = document.createElement('div'); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/views.cjs'), 'utf8'), {
    module,
    require: name => {
      assert.equal(name, 'obsidian');
      return { ItemView, Notice: class {} };
    },
  });
  let context = { view: {}, filePath: '阅读/笔记.md', snapshot: '旧正文', records: [record(10, 'highlight', 'yellow', '甲 <b>原文</b>', '记得复习'), record(70, 'underline', null, '乙')] };
  const calls = [];
  const plugin = {
    app,
    getAnnotationContext: () => context,
    revealAnnotation: (...args) => calls.push(['reveal', ...args]),
    showSidebarAnnotationMenu: (...args) => calls.push(['edit-menu', ...args]),
    removeAnnotation: (...args) => calls.push(['remove', ...args]),
    exportAnnotations: () => calls.push(['export']),
  };
  const Sidebar = module.exports.createSidebarClass(plugin);
  const view = new Sidebar({});
  return { view, workspace, vault, calls, get context() { return context; }, setContext: value => { context = value; } };
}

test('sidebar lists current excerpts and notes as text and filters underline independently from colors', async () => {
  const fixture = setup();
  await fixture.view.onOpen();
  assert.equal(cards(fixture.view).length, 2);
  const source = allNodes(fixture.view.contentEl).find(node => node.className === 'inkstone-annotation-sidebar-source');
  assert.equal(source.attributes.title, '阅读/笔记.md');
  assert.equal(source.attributes['aria-label'], '当前笔记：阅读/笔记.md');
  assert.equal(source.children[0].textContent, '笔记');
  assert.equal(source.children[1].textContent, '阅读');
  assert.match(text(fixture.view.contentEl), /甲 <b>原文<\/b>/);
  assert.match(text(fixture.view.contentEl), /记得复习/);
  const filter = allNodes(fixture.view.contentEl).find(node => node.attributes['aria-label'] === '筛选标注颜色');
  filter.value = 'underline';
  filter.dispatchEvent(new Event('change'));
  assert.equal(cards(fixture.view).length, 1);
  assert.match(text(cards(fixture.view)[0]), /乙/);
  const nextFilter = allNodes(fixture.view.contentEl).find(node => node.attributes['aria-label'] === '筛选标注颜色');
  nextFilter.value = 'yellow';
  nextFilter.dispatchEvent(new Event('change'));
  assert.equal(cards(fixture.view).length, 1);
  assert.match(text(cards(fixture.view)[0]), /甲 <b>原文<\/b>/);
});

test('card actions keep their rendered context instead of attaching old offsets to a new document', async () => {
  const fixture = setup();
  const renderedContext = fixture.context;
  await fixture.view.onOpen();
  fixture.setContext({ ...renderedContext, snapshot: '已被修改的正文', records: [] });
  button(fixture.view, '定位原文').dispatchEvent(new Event('click'));
  const edit = button(fixture.view, '编辑');
  edit.dispatchEvent(new Event('click'));
  button(fixture.view, '删除').dispatchEvent(new Event('click'));
  button(fixture.view, '导出摘录').dispatchEvent(new Event('click'));
  assert.equal(fixture.calls.length, 4);
  for (const [index, action] of ['reveal', 'edit-menu', 'remove'].entries()) {
    assert.equal(fixture.calls[index][0], action);
    assert.equal(fixture.calls[index][1], 10);
    assert.equal(fixture.calls[index][2], renderedContext);
  }
  assert.equal(fixture.calls[1][3], edit);
  assert.equal(edit.attributes['aria-haspopup'], 'dialog');
  assert.equal(fixture.calls[3][0], 'export');
});

test('typing refreshes annotations and switching to a non-Markdown leaf clears the current note', async () => {
  const fixture = setup();
  await fixture.view.onOpen();
  fixture.setContext({ ...fixture.context, snapshot: '新正文', records: [record(0, 'highlight', 'blue', '新摘录')] });
  fixture.workspace.emit('editor-change');
  assert.equal(cards(fixture.view).length, 1);
  assert.match(text(fixture.view.contentEl), /新摘录/);
  fixture.workspace.emit('active-leaf-change', { view: { getViewType: () => 'empty' } });
  assert.equal(cards(fixture.view).length, 0);
  assert.match(text(fixture.view.contentEl), /打开一篇 Markdown 笔记/);
  assert.equal(button(fixture.view, '导出摘录').disabled, true);
});

test('vault changes refresh notes and closing detaches all event subscriptions', async () => {
  const fixture = setup();
  await fixture.view.onOpen();
  fixture.setContext({ ...fixture.context, records: [record(10, 'underline', null, '仍是原文', '外部改过的备注')] });
  fixture.vault.emit('modify', { path: '阅读/笔记.md' });
  assert.match(text(fixture.view.contentEl), /外部改过的备注/);
  await fixture.view.onClose();
  assert.equal(fixture.workspace.handlers.size + fixture.vault.handlers.size, 0);
  assert.equal(fixture.view.contentEl.children.length, 0);
  await fixture.view.onOpen();
  assert.equal(cards(fixture.view).length, 1);
});

test('refreshing the same note keeps list position while filtering and changing notes start at the top', async () => {
  const fixture = setup();
  const list = () => allNodes(fixture.view.contentEl).find(node => node.className === 'inkstone-annotation-sidebar-list');
  await fixture.view.onOpen();
  list().scrollTop = 144;
  fixture.setContext({ ...fixture.context, snapshot: '更新正文' });
  fixture.workspace.emit('editor-change');
  assert.equal(list().scrollTop, 144);
  const filter = allNodes(fixture.view.contentEl).find(node => node.attributes['aria-label'] === '筛选标注颜色');
  filter.value = 'underline';
  filter.dispatchEvent(new Event('change'));
  assert.equal(list().scrollTop, 0);
  list().scrollTop = 70;
  fixture.setContext({ ...fixture.context, filePath: '阅读/另一篇.md' });
  fixture.workspace.emit('active-leaf-change', { view: { getViewType: () => 'markdown' } });
  assert.equal(list().scrollTop, 0);
  await fixture.view.onClose();
  await fixture.view.onOpen();
  assert.equal(list().scrollTop, 0);
});

test('activating the sidebar preserves its buttons while source edits still refresh them', async () => {
  const fixture = setup();
  await fixture.view.onOpen();
  const edit = button(fixture.view, '编辑');
  fixture.workspace.emit('active-leaf-change', {view: fixture.view});
  assert.equal(button(fixture.view, '编辑'), edit);
  fixture.setContext({...fixture.context, snapshot: '更新正文'});
  fixture.workspace.emit('editor-change');
  assert.notEqual(button(fixture.view, '编辑'), edit);
});
