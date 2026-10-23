const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/core.cjs');
class MarkdownView {}
function pluginFixture(text = '<u class="inkstone-underline">宿主原文</u>') {
  const notices = [], openedModals = [], builtMenus = [];
  const sandbox = { module: { exports: {} }, annotationCore: core, annotationExcerpts: require('../src/excerpts.cjs'), annotationViews: { VIEW_TYPE: 'inkstone-annotations-list' },
    annotationMenu: { createAnnotationMenu(options) {
      builtMenus.push(options);
      return { ownerDocument: options.doc, isConnected: true, addEventListener() {}, querySelector() { return null; }, remove() { this.isConnected = false; } };
    } },
    require(name) { assert.equal(name, 'obsidian'); return { Plugin: class {}, Modal: class { open() { openedModals.push(this); } }, PluginSettingTab: class {}, MarkdownView, Notice: class { constructor(message) { notices.push(message); } } }; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/plugin.cjs'), 'utf8'), sandbox);
  const plugin = Object.create(sandbox.module.exports.prototype), events = {};
  const styles = new Map();
  const doc = { body: { appendChild() {}, style: { getPropertyValue: name => styles.get(name) || '', getPropertyPriority: () => '', setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) }, classList: { toggle() {} } }, getSelection: () => ({ isCollapsed: true }) };
  const view = Object.assign(new MarkdownView(), { file: { path: 'host.md', basename: 'host', parent: {path: '/'} }, getMode: () => 'preview', getViewData: () => text,
    contentEl: { contains: () => true }, containerEl: { ownerDocument: doc } });
  view.leaf = { view }; view.editor = { getValue: () => text };
  plugin.app = { workspace: { activeLeaf: view.leaf, getActiveViewOfType: Type => view instanceof Type ? view : null, getLeavesOfType: () => [view.leaf] } };
  Object.assign(plugin, { active: true, settings: {monochrome: false, toolbar: false}, sections: new WeakMap(), readingTargets: new WeakMap(), readingRefreshes: new WeakMap(), recordCache: new Map(), documents: new Set(), readingOriginals: new Map(), toolbars: new Map(), toolbarStates: new WeakMap(), toolbarTimers: new Map(), modals: new Set() });
  plugin.registerDomEvent = (_doc, name, callback) => { events[name] = callback; };
  plugin.bindDocument(doc);
  const calls = []; plugin.editAnnotation = (...args) => calls.push(args); plugin.showAnnotationMenu = (...args) => calls.push(args);
  const node = { ownerDocument: doc, isConnected: true, getBoundingClientRect: () => ({}), dataset: {}, textContent: '宿主原文', setAttribute() {}, closest: () => node };
  const element = { querySelectorAll: () => [node], parentElement: view.contentEl };
  node.parentElement = element;
  const render = (sourcePath, snapshot) => { node.textContent = core.parseAnnotations(snapshot)[0].text; plugin.processReadingSection(element, {sourcePath, getSectionInfo: () => ({text:snapshot,lineStart:0,lineEnd:0})}); };
  const click = () => events.click({target:node,preventDefault(){}});
  const openMenu = () => {
    node.textContent = core.parseAnnotations(text)[0].text;
    plugin.positionToolbar = () => {};
    Object.getPrototypeOf(plugin).showAnnotationMenu.call(plugin, 0, plugin.getAnnotationContext(), node);
    assert.equal(builtMenus.length, 1);
    return builtMenus[0];
  };
  const openIdea = (from = 0, to = text.length) => {
    plugin.positionToolbar = () => {};
    const context = plugin.getAnnotationContext();
    const annotation = context.records.find(record => from >= record.contentFrom && to <= record.contentTo);
    plugin.showSelectionIdea({...context,editor:view.editor,from,to,annotation,reading:false}, {}, text.slice(from,to));
    assert.equal(builtMenus.length, 1);
    return builtMenus[0];
  };
  return {plugin, view, node, render, click, calls, notices, openedModals, builtMenus, openMenu, openIdea, setText: value => { text = value; }};
}

function sidebarAnchor(fixture) {
  const doc = fixture.view.containerEl.ownerDocument;
  const anchor = { ownerDocument: doc, isConnected: true, matches: selector => selector === 'button', getBoundingClientRect: () => ({left: 600, top: 200, bottom: 230, width: 50, height: 30}), focus() {} };
  const contentEl = { ownerDocument: doc, contains: element => element === anchor };
  const leaf = {view: {contentEl, getViewType: () => 'inkstone-annotations-list'}};
  const leaves = fixture.plugin.app.workspace.getLeavesOfType;
  fixture.plugin.app.workspace.getLeavesOfType = type => type === 'inkstone-annotations-list' ? [leaf] : leaves(type);
  return anchor;
}

test('sidebar edit opens the shared menu at its own button with current style and idea', () => {
  const fixture = pluginFixture('<mark class="inkstone-highlight inkstone-green">侧栏原文</mark>[^inkstone-1]\n\n[^inkstone-1]: 已有想法');
  const anchor = sidebarAnchor(fixture), positions = [];
  fixture.view.contentEl.contains = () => false;
  fixture.plugin.positionToolbar = (_menu, capture, rect) => positions.push({capture, rect});
  fixture.plugin.showSidebarAnnotationMenu(0, fixture.plugin.getAnnotationContext(), anchor);
  assert.equal(fixture.builtMenus.length, 1);
  const options = fixture.builtMenus[0];
  assert.equal(options.record.color, 'green');
  assert.equal(options.record.note, '已有想法');
  assert.equal(options.startComposer, false);
  assert.deepEqual(positions[0].rect, anchor.getBoundingClientRect());
  assert.equal(positions[0].capture.view, fixture.view);
  assert.equal(positions[0].capture.snapshot, fixture.view.getViewData());
  assert.equal(fixture.openedModals.length, 0);
  let focused = false;
  anchor.focus = () => { focused = true; };
  options.onClose();
  assert.equal(focused, true);
  assert.equal(fixture.plugin.toolbars.size, 0);
});

test('sidebar menu rejects stale content and disconnected, foreign or unregistered buttons', () => {
  for (const failure of ['stale', 'switched-file', 'closed-plugin', 'detached', 'other-document', 'other-sidebar-document', 'not-button', 'unregistered']) {
    const fixture = pluginFixture(), anchor = sidebarAnchor(fixture), context = fixture.plugin.getAnnotationContext();
    fixture.plugin.positionToolbar = () => {};
    if (failure === 'stale') fixture.setText('原文已改变');
    if (failure === 'switched-file') fixture.view.file = {path: 'other.md'};
    if (failure === 'closed-plugin') fixture.plugin.active = false;
    if (failure === 'detached') anchor.isConnected = false;
    if (failure === 'other-document') anchor.ownerDocument = {};
    if (failure === 'other-sidebar-document') fixture.plugin.app.workspace.getLeavesOfType = type => type === 'markdown' ? [fixture.view.leaf] : [{view: {contentEl: {ownerDocument: {}, contains: () => true}}}];
    if (failure === 'not-button') anchor.matches = () => false;
    if (failure === 'unregistered') fixture.plugin.app.workspace.getLeavesOfType = type => type === 'markdown' ? [fixture.view.leaf] : [];
    fixture.plugin.showSidebarAnnotationMenu(0, context, anchor);
    assert.equal(fixture.builtMenus.length, 0, failure);
    assert.equal(fixture.openedModals.length, 0, failure);
    assert.equal(fixture.notices.length, 1, failure);
  }
});

test('all sidebar-menu writes revalidate the captured note before invoking mutations', async () => {
  const fixture = pluginFixture(), anchor = sidebarAnchor(fixture), writes = [];
  fixture.plugin.positionToolbar = () => {};
  fixture.plugin.showSidebarAnnotationMenu(0, fixture.plugin.getAnnotationContext(), anchor);
  assert.equal(fixture.builtMenus.length, 1);
  const options = fixture.builtMenus[0];
  fixture.plugin.commit = async () => writes.push('commit');
  fixture.plugin.removeAnnotation = async () => writes.push('remove');
  fixture.setText('原文已被用户修改');
  await assert.rejects(() => options.onStyle({kind: 'highlight', color: 'blue'}), /变化/);
  await assert.rejects(() => options.onSaveNote('新想法', {kind: 'underline'}), /变化/);
  await assert.rejects(() => options.onDelete(), /变化/);
  assert.deepEqual(writes, []);
});

test('a delayed activation of the sidebar that opened a menu keeps that same menu', () => {
  const fixture = pluginFixture(), anchor = sidebarAnchor(fixture);
  fixture.plugin.positionToolbar = () => {};
  fixture.plugin.showSidebarAnnotationMenu(0, fixture.plugin.getAnnotationContext(), anchor);
  const doc = anchor.ownerDocument, menu = fixture.plugin.toolbars.get(doc);
  const sidebar = fixture.plugin.app.workspace.getLeavesOfType('inkstone-annotations-list')[0];
  fixture.plugin.app.workspace.activeLeaf = sidebar;
  fixture.plugin.app.workspace.getActiveViewOfType = () => null;
  fixture.plugin.lastMarkdownView = fixture.view;
  fixture.plugin.handleActiveLeafChange(sidebar);
  assert.equal(fixture.plugin.toolbars.get(doc), menu);
  assert.equal(menu.isConnected, true);
  fixture.plugin.app.workspace.activeLeaf = fixture.view.leaf;
  fixture.plugin.app.workspace.getActiveViewOfType = () => fixture.view;
  fixture.plugin.handleActiveLeafChange(fixture.view.leaf);
  assert.equal(fixture.plugin.toolbars.size, 0);
});

test('sidebar activation still closes a menu with stale content, a detached anchor or a different leaf', () => {
  for (const failure of ['stale', 'detached', 'different-sidebar', 'no-longer-active']) {
    const fixture = pluginFixture(), anchor = sidebarAnchor(fixture);
    fixture.plugin.positionToolbar = () => {};
    fixture.plugin.showSidebarAnnotationMenu(0, fixture.plugin.getAnnotationContext(), anchor);
    const sidebar = fixture.plugin.app.workspace.getLeavesOfType('inkstone-annotations-list')[0];
    fixture.plugin.app.workspace.activeLeaf = sidebar;
    fixture.plugin.app.workspace.getActiveViewOfType = () => null;
    fixture.plugin.lastMarkdownView = fixture.view;
    if (failure === 'stale') fixture.setText('原文已变化');
    if (failure === 'detached') anchor.isConnected = false;
    if (failure === 'different-sidebar') sidebar.view.contentEl = {ownerDocument: anchor.ownerDocument, contains: () => false};
    if (failure === 'no-longer-active') fixture.plugin.app.workspace.activeLeaf = {view: {getViewType: () => 'empty'}};
    fixture.plugin.handleActiveLeafChange(sidebar);
    assert.equal(fixture.plugin.toolbars.size, 0, failure);
  }
});

test('clicking an annotation embedded from another note never edits the host note', () => {
  const fixture=pluginFixture();
  fixture.render('embedded.md','<u class="inkstone-underline">嵌入原文</u>');
  fixture.click();
  assert.equal(fixture.calls.length,0);
  assert(fixture.notices.some(message=>/原笔记|来源|嵌入/.test(message)));
});

test('clicking stale reading DOM refuses the old offset in a new snapshot', () => {
  const fixture=pluginFixture();
  fixture.render('host.md','<u class="inkstone-underline">宿主原文</u>');
  fixture.setText('<u class="inkstone-underline">新内容</u>');
  fixture.click();
  assert.equal(fixture.calls.length,0);
  assert(fixture.notices.some(message=>/变化|更新/.test(message)));
});

test('clicking a current annotation passes its rendered file and full snapshot', () => {
  const fixture=pluginFixture(); const snapshot='<u class="inkstone-underline">宿主原文</u>';
  fixture.render('host.md',snapshot); fixture.click();
  assert.equal(fixture.calls.length,1);
  assert.equal(fixture.calls[0][0],0);
  assert.equal(fixture.calls[0][1]?.snapshot,snapshot);
  assert.equal(fixture.calls[0][1]?.filePath,'host.md');
});

test('an empty tab cannot target the last opened note through a stale selection', () => {
  const fixture=pluginFixture();
  fixture.plugin.lastMarkdownView=fixture.view;
  fixture.plugin.app.workspace.getActiveViewOfType=()=>null;
  fixture.plugin.app.workspace.activeLeaf={view:{getViewType:()=> 'empty'}};
  assert.throws(()=>fixture.plugin.currentView(),/打开.*笔记/);
});

test('export keeps literal HTML and Markdown as quoted text in a unique new note', async () => {
  const fixture=pluginFixture(); const original='<u class="inkstone-underline">&lt;img src=&quot;https://example.com/probe.png&quot;&gt; **字面量** 与 &amp;copy; 以及 &amp;lt;img&amp;gt;</u>';
  fixture.setText(original);
  const created=[]; let opened;
  fixture.plugin.app.vault={ getAbstractFileByPath: name=> name==='host-墨读摘录.md' ? {path:name}:null,
    async create(name,text){created.push({name,text});return {path:name};} };
  fixture.plugin.app.fileManager={generateMarkdownLink:()=>'[[host|原文]]'};
  fixture.plugin.app.workspace.getLeaf=()=>({openFile:async file=>{opened=file.path;}});
  await fixture.plugin.exportAnnotations();
  assert.equal(created.length,1);
  assert.equal(created[0].name,'host-墨读摘录-2.md');
  assert.equal(opened,created[0].name);
  assert(!created[0].text.includes('> <img'));
  assert(!created[0].text.includes('**字面量**'));
  assert(created[0].text.includes('\\&copy;'));
  assert(created[0].text.includes('\\&lt;img\\&gt;'));
  assert(created[0].text.includes('[[host|原文]]'));
  assert.equal(fixture.view.getViewData(),original);
});


test('editing only the note of an uncolored legacy highlight preserves its appearance', async () => {
  const fixture = pluginFixture('<mark class="inkstone-highlight">旧高亮</mark>');
  fixture.plugin.settings.lastColor = 'blue';
  const annotation = core.parseAnnotations(fixture.view.getViewData())[0];
  fixture.plugin.openAnnotation({ annotation, snapshot: fixture.view.getViewData() });
  const modal = fixture.openedModals[0];
  let result;
  fixture.plugin.commit = async (_capture, options) => {
    const plan = core.buildEditAnnotationPlan({ document: fixture.view.getViewData(), from: annotation.from, ...options });
    result = core.applyChanges(fixture.view.getViewData(), plan.changes);
  };
  modal.note = '补充备注';
  modal.perform = work => work();
  await modal.submit();
  assert.equal(core.parseAnnotations(result)[0].color, null);
  assert.equal(core.parseAnnotations(result)[0].note, '补充备注');
});

test('sidebar locate skips an embedded annotation at the same source offset', async () => {
  const snapshot = '![[b]]\n\n<u class="inkstone-underline">宿主正文</u>';
  const fixture = pluginFixture(snapshot), calls = [];
  const embedded = {textContent:'嵌入正文',scrollIntoView(){calls.push('embedded');},focus(){} };
  const own = {textContent:'宿主正文',scrollIntoView(){calls.push('host');},focus(){} };
  fixture.plugin.readingTargets.set(embedded,{filePath:'b.md',snapshot:'12345678<u class="inkstone-underline">嵌入正文</u>',from:8,text:'嵌入正文'});
  fixture.plugin.readingTargets.set(own,{filePath:'host.md',snapshot,from:8,text:'宿主正文'});
  fixture.view.contentEl.querySelector = () => embedded;
  fixture.view.contentEl.querySelectorAll = () => [embedded,own];
  fixture.plugin.app.workspace.setActiveLeaf = () => {};
  await fixture.plugin.revealAnnotation(8,fixture.plugin.getAnnotationContext());
  assert.deepEqual(calls,['host']);
});

test('the note shortcut preserves the style of an existing highlight', async () => {
  const fixture = pluginFixture('<mark class="inkstone-highlight inkstone-green">已有观点</mark>');
  const annotation = core.parseAnnotations(fixture.view.getViewData())[0];
  fixture.plugin.openAnnotation({annotation,snapshot:fixture.view.getViewData()},'note');
  const modal = fixture.openedModals[0];
  let result;
  fixture.plugin.commit = async (_capture,options) => {
    result=core.applyChanges(fixture.view.getViewData(),core.buildEditAnnotationPlan({document:fixture.view.getViewData(),from:annotation.from,...options}).changes);
  };
  modal.note='新增备注';modal.perform=work=>work();
  await modal.submit();
  const updated=core.parseAnnotations(result)[0];
  assert.equal(updated.kind,'highlight');
  assert.equal(updated.color,'green');
  assert.equal(updated.note,'新增备注');
});

test('copy uses the captured visible text without modifying the note', async () => {
  const fixture=pluginFixture(), copied=[];
  const context=fixture.plugin.getAnnotationContext();
  await fixture.plugin.copySelection(context,'宿主原文',{defaultView:{navigator:{clipboard:{writeText:async text=>copied.push(text)}}}});
  assert.deepEqual(copied,['宿主原文']);
  assert.equal(fixture.view.getViewData(),context.snapshot);
});

test('copy refuses a stale selection before invoking the clipboard API', async () => {
  const fixture=pluginFixture(), copied=[];
  const context=fixture.plugin.getAnnotationContext();fixture.setText('选区已变化');
  await assert.rejects(()=>fixture.plugin.copySelection(context,'宿主原文',{defaultView:{navigator:{clipboard:{writeText:async text=>copied.push(text)}}}}),/变化/);
  assert.deepEqual(copied,[]);
});

test('repeated events for the same selection retain the open toolbar node', () => {
  const fixture=pluginFixture(), plugin=fixture.plugin, doc=fixture.view.containerEl.ownerDocument;
  const capture={...plugin.getAnnotationContext(),from:0,to:2};
  doc.querySelector=()=>null;plugin.settings.toolbar=true;plugin.capture=()=>({...capture});
  const toolbar={isConnected:true,remove(){throw new Error('Open styles must not be discarded');}};
  plugin.toolbarStates.set(doc,{capture,dismissed:false});plugin.toolbars.set(doc,toolbar);
  plugin.showToolbar(doc);
  assert.equal(plugin.toolbars.get(doc),toolbar);
});

test('dismissed selection stays closed until the user makes a new selection', () => {
  const fixture=pluginFixture(), plugin=fixture.plugin, doc=fixture.view.containerEl.ownerDocument;
  const capture={...plugin.getAnnotationContext(),from:0,to:2};
  doc.querySelector=()=>null;plugin.settings.toolbar=true;plugin.capture=()=>({...capture});
  plugin.toolbarStates.set(doc,{capture,dismissed:false});
  plugin.dismissToolbar(doc);plugin.showToolbar(doc);
  assert.equal(plugin.toolbars.size,0);
  assert.equal(plugin.toolbarStates.get(doc).dismissed,true);
});

test('clicking an existing mark opens an anchored menu instead of the full editor', () => {
  const fixture=pluginFixture(), menus=[];
  fixture.plugin.showAnnotationMenu=(...args)=>menus.push(args);
  fixture.render('host.md',fixture.view.getViewData());fixture.click();
  assert.equal(menus.length,1);
  assert.equal(menus[0][2],fixture.node);
  assert.equal(fixture.calls.length,0);
  assert.equal(fixture.openedModals.length,0);
});

test('all existing-menu writes reject a changed note before invoking mutation helpers', async () => {
  const fixture = pluginFixture(), options = fixture.openMenu(), writes = [];
  fixture.plugin.commit = async () => writes.push('commit');
  fixture.plugin.removeAnnotation = async () => writes.push('remove');
  fixture.setText('原文已被用户修改');
  await assert.rejects(() => options.onStyle({kind:'highlight',color:'blue'}), /变化/);
  await assert.rejects(() => options.onSaveNote('新的想法'), /变化/);
  await assert.rejects(() => options.onDelete(), /变化/);
  assert.deepEqual(writes, []);
});

test('saving an idea through the small menu keeps an uncolored legacy highlight', async () => {
  const fixture = pluginFixture('<mark class="inkstone-highlight">旧高亮</mark>');
  fixture.plugin.settings.lastColor = 'blue';
  const options = fixture.openMenu();
  let result;
  fixture.plugin.commit = async (capture, changes) => {
    result = core.applyChanges(capture.snapshot, core.buildEditAnnotationPlan({document:capture.snapshot,from:capture.annotation.from,...changes}).changes);
  };
  await options.onSaveNote('补充想法');
  const updated = core.parseAnnotations(result)[0];
  assert.equal(updated.kind, 'highlight');
  assert.equal(updated.color, null);
  assert.equal(updated.note, '补充想法');
  assert.equal(fixture.plugin.toolbars.size, 0);
  assert.equal(fixture.openedModals.length, 0);
});

test('a reused reading paragraph receives the committed footnote snapshot only from its current source section', () => {
  const before = '<u class="inkstone-underline">宿主原文</u>[^inkstone-1]\n\n[^inkstone-1]: 原想法';
  const after = before.replace('原想法','更新想法');
  const fixture = pluginFixture(before), {plugin, view, node} = fixture;
  const element = node.parentElement;
  let sectionText = before;
  const context = {sourcePath:'host.md',getSectionInfo:()=>({text:sectionText,lineStart:0,lineEnd:0})};
  plugin.processReadingSection(element, context);
  view.contentEl.querySelectorAll = () => [node];
  fixture.setText(after);
  plugin.readingRefreshes.set(view, {filePath:'host.md',before,after});
  plugin.refreshReadingTargets(view, after);
  assert.throws(() => plugin.readingAnnotationContext(node, view), /更新/);
  sectionText = after;
  context.sourcePath = 'embedded.md';
  plugin.refreshReadingTargets(view, after);
  assert.throws(() => plugin.readingAnnotationContext(node, view), /更新/);
  context.sourcePath = 'host.md';
  const getInfo = context.getSectionInfo;
  context.getSectionInfo = () => { throw new Error('section detached'); };
  assert.doesNotThrow(() => plugin.refreshReadingTargets(view, after));
  assert.throws(() => plugin.readingAnnotationContext(node, view), /更新/);
  context.getSectionInfo = getInfo;
  assert.equal(plugin.readingAnnotationContext(node, view).snapshot, after);
  assert.equal(plugin.readingAnnotationContext(node, view).records[0].note, '更新想法');
  fixture.setText(before);
  sectionText = before;
  assert.throws(() => plugin.readingAnnotationContext(node, view), /更新/);
  plugin.readingRefreshes.set(view, {filePath:'host.md',before:after,after:before});
  assert.equal(plugin.readingAnnotationContext(node, view).snapshot, before);
});

test('selection ideas open directly in the small composer and add one underline with a footnote', async () => {
  const fixture = pluginFixture('首段，选中的文字，末段。');
  const options = fixture.openIdea(3,8);
  assert.equal(options.startComposer, true);
  assert.equal(options.record.text, '选中的文字');
  assert.equal(fixture.openedModals.length, 0);
  let result;
  fixture.plugin.commit = async (capture, changes) => {
    result = core.applyChanges(capture.snapshot, core.buildAnnotationPlan({document:capture.snapshot,from:capture.from,to:capture.to,...changes}).changes);
  };
  await options.onSaveNote('可以试一试');
  const records = core.parseAnnotations(result);
  assert.equal(records.length,1);
  assert.equal(records[0].kind,'underline');
  assert.equal(records[0].text,'选中的文字');
  assert.equal(records[0].note,'可以试一试');
  assert(result.startsWith('首段，'));
  assert(result.includes('，末段。'));
});

test('a new selection idea rejects empty input and cancel never writes a mark', async () => {
  const fixture = pluginFixture('先读再想'), options = fixture.openIdea(), writes=[];
  fixture.plugin.commit = async () => writes.push('commit');
  await assert.rejects(() => options.onSaveNote(' \n '),/想法/);
  assert.deepEqual(writes,[]);
  assert.equal(fixture.plugin.toolbars.size,1);
  options.onCancel();
  assert.deepEqual(writes,[]);
  assert.equal(fixture.plugin.toolbars.size,0);
  assert.equal(fixture.view.getViewData(),'先读再想');
});

test('a selection idea refuses an updated snapshot before a write helper runs', async () => {
  const fixture=pluginFixture('先读再想'), options=fixture.openIdea(), writes=[];
  fixture.plugin.commit=async()=>writes.push('commit');
  fixture.setText('另一人已经修改原文');
  await assert.rejects(()=>options.onSaveNote('不能写回旧位置'),/变化/);
  assert.deepEqual(writes,[]);
});

test('a selection inside a legacy highlight keeps its existing style when saving an idea', async () => {
  const fixture=pluginFixture('<mark class="inkstone-highlight">已有观点</mark>');
  const annotation=core.parseAnnotations(fixture.view.getViewData())[0];
  const options=fixture.openIdea(annotation.contentFrom,annotation.contentTo);
  let result;
  fixture.plugin.commit=async(capture,changes)=>{
    result=core.applyChanges(capture.snapshot,core.buildEditAnnotationPlan({document:capture.snapshot,from:capture.annotation.from,...changes}).changes);
  };
  await options.onSaveNote('保留原来的样式');
  const updated=core.parseAnnotations(result)[0];
  assert.equal(updated.kind,'highlight');
  assert.equal(updated.color,null);
  assert.equal(updated.note,'保留原来的样式');
});

test('a selection idea saves the chosen style and note together in one write', async () => {
  for (const style of [{kind:'underline'}, ...['yellow','green','blue','rose'].map(color=>({kind:'highlight',color}))]) {
    const fixture=pluginFixture('首段，选中的文字，末段。'), options=fixture.openIdea(3,8);
    const writes=[];
    let result;
    fixture.plugin.commit=async(capture,changes)=>{
      writes.push(changes);
      result=core.applyChanges(capture.snapshot,core.buildAnnotationPlan({document:capture.snapshot,from:capture.from,to:capture.to,...changes}).changes);
    };
    await options.onSaveNote('跟着所选样式一起保存',style);
    assert.equal(writes.length,1);
    const updated=core.parseAnnotations(result)[0];
    assert.equal(updated.kind,style.kind);
    assert.equal(updated.color,style.color || null);
    assert.equal(updated.text,'选中的文字');
    assert.equal(updated.note,'跟着所选样式一起保存');
  }
});

test('an existing annotation idea saves its chosen style and note as one edit', async () => {
  const fixture=pluginFixture('<mark class="inkstone-highlight inkstone-green">原有观点</mark>[^inkstone-1]\n\n[^inkstone-1]: 原有想法');
  const annotation=core.parseAnnotations(fixture.view.getViewData())[0];
  const options=fixture.openIdea(annotation.contentFrom,annotation.contentTo);
  const writes=[];
  let result;
  fixture.plugin.commit=async(capture,changes)=>{
    writes.push(changes);
    result=core.applyChanges(capture.snapshot,core.buildEditAnnotationPlan({document:capture.snapshot,from:capture.annotation.from,...changes}).changes);
  };
  await options.onSaveNote('配合新颜色的想法',{kind:'highlight',color:'rose'});
  assert.equal(writes.length,1);
  const records=core.parseAnnotations(result);
  assert.equal(records.length,1);
  assert.equal(records[0].color,'rose');
  assert.equal(records[0].note,'配合新颜色的想法');
});

test('a stale idea refuses the chosen style and note together', async () => {
  const fixture=pluginFixture('先读再想'),options=fixture.openIdea(),writes=[];
  fixture.plugin.commit=async()=>writes.push('commit');
  fixture.setText('原文被别人改过');
  await assert.rejects(()=>options.onSaveNote('新想法',{kind:'highlight',color:'blue'}),/变化/);
  assert.deepEqual(writes,[]);
  assert.equal(fixture.view.getViewData(),'原文被别人改过');
});

test('writing a thought uses the same small composer without changing the selected note', () => {
  const fixture = pluginFixture('先读再想');
  const context = fixture.plugin.getAnnotationContext();
  fixture.plugin.capture = () => ({ ...context, editor: fixture.view.editor, from: 1, to: 3, reading: false });
  fixture.plugin.positionToolbar = () => {};
  fixture.plugin.writeThought();
  assert.equal(fixture.builtMenus.length, 1);
  assert.equal(fixture.builtMenus[0].startComposer, true);
  assert.equal(fixture.builtMenus[0].record.text, '读再');
  assert.equal(fixture.openedModals.length, 0);
  assert.equal(fixture.view.getViewData(), '先读再想');
});

test('reactivating the source pane preserves a dirty thought while stale content still closes it', () => {
  const fixture = pluginFixture();
  fixture.openMenu();
  const doc = fixture.view.containerEl.ownerDocument;
  const menu = fixture.plugin.toolbars.get(doc);
  menu.inkstoneHasDraft = () => true;
  fixture.plugin.handleActiveLeafChange(fixture.view.leaf);
  assert.equal(fixture.plugin.toolbars.get(doc), menu);
  assert.equal(menu.isConnected, true);
  fixture.setText('正文已发生变化');
  fixture.plugin.handleActiveLeafChange(fixture.view.leaf);
  assert.equal(fixture.plugin.toolbars.size, 0);
  assert.equal(menu.isConnected, false);
});

test('annotation navigation follows cursor order, reports boundaries and resets in another note', async () => {
  const fixture = pluginFixture('前言 <u class="inkstone-underline">一</u> 接续 <u class="inkstone-underline">二</u>');
  let cursor = 0;
  fixture.view.getMode = () => 'source';
  fixture.view.editor.getCursor = () => cursor;
  fixture.view.editor.posToOffset = value => value;
  const visited = [];
  fixture.plugin.revealAnnotation = async from => { visited.push(from); cursor = from; };
  const records = fixture.plugin.getAnnotationContext().records;
  await fixture.plugin.navigateAnnotation(1);
  await fixture.plugin.navigateAnnotation(1);
  await fixture.plugin.navigateAnnotation(1);
  await fixture.plugin.navigateAnnotation(-1);
  assert.deepEqual(visited, [records[0].from, records[1].from, records[0].from]);
  assert.match(fixture.notices.at(-1), /最后/);
  fixture.view.file = {path:'other.md'};
  fixture.setText('新笔记');
  await fixture.plugin.navigateAnnotation(1);
  assert.match(fixture.notices.at(-1), /没有.*标注/);
});

test('color aliases are display-only and normalize unsafe whitespace', () => {
  const fixture = pluginFixture();
  fixture.plugin.settings.colorLabels = {yellow:'  重点\n结论  ', blue:' ', rose:'a'.repeat(90)};
  assert.equal(fixture.plugin.annotationLabel({kind:'highlight',color:'yellow'}), '重点 结论');
  assert.equal(fixture.plugin.annotationLabel({kind:'highlight',color:'blue'}), '蓝色');
  assert.equal(fixture.plugin.annotationLabel({kind:'highlight',color:'rose'}).length, 40);
  assert.equal(fixture.plugin.annotationLabel({kind:'underline'}), '下划线');
});

test('implicit menu dismissal archives only bounded session text, explicit cancel discards it', () => {
  const fixture = pluginFixture();
  const options = fixture.openMenu(), doc = fixture.node.ownerDocument;
  const menu = fixture.plugin.toolbars.get(doc);
  fixture.node.focus = () => {};
  menu.inkstoneDiscardDraft = () => { menu.inkstoneGetDraft = () => null; };
  menu.inkstoneGetDraft = () => ({note:'尚未保存',kind:'highlight',color:'blue',quote:'宿主原文'});
  fixture.plugin.hideToolbars();
  const draft = fixture.plugin.sessionDrafts.get('host.md');
  assert.equal(draft.note, '尚未保存');
  assert.equal(draft.quote, '宿主原文');
  assert.equal('snapshot' in draft, false);
  assert.equal('from' in draft, false);
  fixture.plugin.toolbars.set(doc, menu);
  options.onClose();
  assert.equal(fixture.plugin.sessionDrafts.has('host.md'), false);
  menu.inkstoneGetDraft = () => ({note:'另一个草稿',quote:'原文'});
  for (let index = 0; index < 15; index++) {
    fixture.plugin.toolbarStates.set(doc,{capture:{filePath:`${index}.md`}});
    fixture.plugin.toolbars.set(doc,menu);
    fixture.plugin.hideToolbars();
  }
  assert.equal(fixture.plugin.sessionDrafts.size,10);
});

test('manual excerpt collection deduplicates markdown files in selected folders', async () => {
  const fixture = pluginFixture();
  const a = {path:'A/a.md',basename:'a',extension:'md'}, b = {path:'b.md',basename:'b',extension:'md'};
  const folder = {path:'A',children:[a,{path:'A/image.png',extension:'png'}]};
  assert.deepEqual(Array.from(fixture.plugin.selectedMarkdownFiles([b,folder,a]),file=>file.path),['A/a.md','b.md']);
  const created = [];
  fixture.plugin.app.vault = {getAbstractFileByPath:()=>null,cachedRead:async file=>`<u class="inkstone-underline">${file.basename}内容</u>`,create:async(path,text)=>{created.push({path,text});return {path};}};
  fixture.plugin.app.fileManager = {generateMarkdownLink:(file)=>`[[${file.path}]]`};
  fixture.plugin.app.workspace.getLeavesOfType = () => [];
  fixture.plugin.app.workspace.getLeaf = () => ({openFile:async()=>{}});
  await fixture.plugin.exportSelectedAnnotations([folder,b,a]);
  assert.equal(created.length,1);
  assert.equal((created[0].text.match(/> a内容/g)||[]).length,1);
  assert(created[0].text.includes('[[b.md]]'));
  assert.match(created[0].text,/快照生成时间/);
});

test('Escape outside a dirty composer discards its archived session draft', () => {
  const fixture = pluginFixture();
  fixture.openMenu();
  const doc = fixture.node.ownerDocument, menu = fixture.plugin.toolbars.get(doc);
  let discarded = false;
  menu.inkstoneGetDraft = () => discarded ? null : {note:'不要保留',quote:'宿主原文'};
  menu.inkstoneDiscardDraft = () => {discarded = true;};
  fixture.plugin.sessionDrafts = new Map([['host.md',{note:'旧草稿'}]]);
  const events = {};
  fixture.plugin.documents.delete(doc);
  fixture.plugin.registerDomEvent = (_doc,name,callback) => {events[name]=callback;};
  fixture.plugin.bindDocument(doc);
  events.keydown({key:'Escape',target:{closest:()=>null}});
  assert.equal(fixture.plugin.toolbars.size,0);
  assert.equal(fixture.plugin.sessionDrafts.has('host.md'),false);
});

test('excerpt heading context rejects old cache when a heading has become plain text', () => {
  const fixture = pluginFixture('章节\n\n<u class="inkstone-underline">观点</u>');
  fixture.plugin.app.metadataCache = {getFileCache:()=>({headings:[{heading:'章节',level:1,position:{start:{offset:0,line:0,col:0}}}]})};
  fixture.plugin.app.fileManager = {generateMarkdownLink:(_file,_path,subpath)=>`[[host${subpath}]]`};
  const lines = fixture.plugin.excerptLines(fixture.view.file,fixture.view.getViewData(),'export.md','2026-10-23');
  assert.equal(lines.some(line=>line.includes('#章节')),false);
  assert.equal(lines.some(line=>line.includes('位置：')),false);
});

test('previous annotation from the gap between marks goes toward the preceding mark', async () => {
  const fixture = pluginFixture('<u class="inkstone-underline">前一条</u>\n\n<u class="inkstone-underline">后一条</u>');
  const context = fixture.plugin.getAnnotationContext(), visited=[];
  const nodes=context.records.map((record,index)=>({dataset:{inkstoneFrom:String(record.from)},getBoundingClientRect:()=>index?{top:1100,bottom:1120,height:20}:{top:-40,bottom:-20,height:20}}));
  nodes.forEach((node,index)=>fixture.plugin.readingTargets.set(node,{...context,from:context.records[index].from}));
  fixture.view.contentEl.querySelector=()=>({getBoundingClientRect:()=>({top:0,bottom:600})});
  fixture.view.contentEl.querySelectorAll=()=>nodes;
  fixture.plugin.revealAnnotation=async from=>visited.push(from);
  await fixture.plugin.navigateAnnotation(-1);
  assert.deepEqual(visited,[context.records[0].from]);
});

test('excerpt heading context rejects a cached heading moved inside a fenced block', () => {
  const fixture=pluginFixture('```\n# 章节\n```\n\n<u class="inkstone-underline">正文</u>');
  fixture.plugin.app.metadataCache={getFileCache:()=>({headings:[{heading:'章节',level:1,position:{start:{offset:4,line:1,col:0}}}]})};
  fixture.plugin.app.fileManager={generateMarkdownLink:(_file,_path,subpath)=>`[[host${subpath}]]`};
  const lines=fixture.plugin.excerptLines(fixture.view.file,fixture.view.getViewData(),'export.md','2026-10-23');
  assert.equal(lines.some(line=>line.includes('#章节')),false);
});

test('ordinary Escape after a menu was implicitly closed keeps the recoverable draft', () => {
  const fixture = pluginFixture(), doc = fixture.node.ownerDocument;
  fixture.openMenu();
  const menu = fixture.plugin.toolbars.get(doc);
  menu.inkstoneGetDraft = () => ({note:'留待恢复',quote:'宿主原文'});
  menu.inkstoneDiscardDraft = () => {};
  fixture.plugin.hideToolbars();
  const events = {};
  fixture.plugin.documents.delete(doc);
  fixture.plugin.registerDomEvent = (_doc,name,callback) => {events[name]=callback;};
  fixture.plugin.bindDocument(doc);
  events.keydown({key:'Escape',target:{closest:()=>null}});
  assert.equal(fixture.plugin.sessionDrafts.get('host.md').note,'留待恢复');
});

test('excerpt heading checks accept current ATX and Setext titles and reject moved HTML or property headings', () => {
  for (const [snapshot, heading, level, accepted] of [
    ['# 标题\n\n<u class="inkstone-underline">正文</u>', '标题', 1, true],
    ['标题\n===\n\n<u class="inkstone-underline">正文</u>', '标题', 1, true],
    ['标题\n---\n\n<u class="inkstone-underline">正文</u>', '标题', 2, true],
    ['<div>\n# 标题\n</div>\n\n<u class="inkstone-underline">正文</u>', '标题', 1, false],
    ['<!--\n# 标题\n-->\n\n<u class="inkstone-underline">正文</u>', '标题', 1, false],
    ['---\n# 标题\n---\n\n<u class="inkstone-underline">正文</u>', '标题', 1, false],
    ['$$\n# 标题\n$$\n\n<u class="inkstone-underline">正文</u>', '标题', 1, false],
    ['# **标题**\n\n<u class="inkstone-underline">正文</u>', '**标题**', 1, false],
  ]) {
    const fixture = pluginFixture(snapshot), offset = snapshot.indexOf(snapshot.includes('# ') ? '# ' : heading);
    fixture.plugin.app.metadataCache = {getFileCache:()=>({headings:[{heading,level,position:{start:{offset}}}]})};
    fixture.plugin.app.fileManager = {generateMarkdownLink:(_file,_path,subpath)=>`[[host${subpath}]]`};
    const lines = fixture.plugin.excerptLines(fixture.view.file,snapshot,'export.md','2026-10-23');
    assert.equal(lines.some(line=>line.startsWith('位置：')),accepted,snapshot);
  }
});

test('exporting 2000 current headings avoids a full-document protection scan per heading', () => {
  const chunks = [], headings = [];
  let offset = 0;
  for (let index = 0; index < 2000; index++) {
    const heading = `章节${index + 1}`;
    const chunk = `# ${heading}\n\n${'普通阅读正文。'.repeat(10)}\n\n<u class="inkstone-underline">观点${index + 1}</u>\n\n`;
    headings.push({heading,level:1,position:{start:{offset}}});
    chunks.push(chunk);
    offset += chunk.length;
  }
  const snapshot = chunks.join(''), fixture = pluginFixture(snapshot);
  fixture.plugin.app.metadataCache = {getFileCache:()=>({headings})};
  fixture.plugin.app.fileManager = {generateMarkdownLink:(_file,_path,subpath)=>`[[host${subpath}]]`};
  const started = process.hrtime.bigint();
  const lines = fixture.plugin.excerptLines(fixture.view.file,snapshot,'export.md','2026-10-23');
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(lines.filter(line=>line.startsWith('位置：')).length,2000);
  assert.ok(elapsed < 3000, `2000 headings blocked the synchronous export for ${Math.round(elapsed)} ms`);
});
