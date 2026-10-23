'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/core.cjs');

function fixture() {
  const settings = [];
  class Setting {
    constructor() { settings.push(this); }
    setName(name) { this.name = name; return this; }
    setDesc() { return this; }
    setHeading() { this.heading = true; return this; }
    addToggle(callback) { callback({ setValue() { return this; }, onChange() {} }); return this; }
    addDropdown(callback) { callback({ addOptions() { return this; }, setValue() { return this; }, onChange() {} }); return this; }
    addText(callback) { callback({ setValue() { return this; }, setPlaceholder() { return this; }, onChange() {} }); return this; }
    addButton(callback) { callback({ setButtonText() { return this; }, onClick() {} }); return this; }
  }
  const context = vm.createContext({
    module: { exports: {} }, annotationCore: core, annotationViews: { VIEW_TYPE: 'inkstone-annotations-list' },
    require(name) {
      assert.equal(name, 'obsidian');
      return { Plugin: class {}, Modal: class {}, PluginSettingTab: class {}, Setting };
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/plugin.cjs'), 'utf8'), context);
  return { Plugin: context.module.exports, SettingsTab: vm.runInContext('AnnotationSettings', context), settings };
}

test('settings sections use native headings with their original names and keep the reading controls', () => {
  const { SettingsTab, settings } = fixture();
  const tab = new SettingsTab({}, { settings: { monochrome: false, toolbar: true } });
  const elements = [];
  tab.containerEl = {
    empty() { elements.length = 0; },
    createEl(tag, options) { elements.push({ tag, ...options }); },
  };
  tab.display();
  assert.deepEqual(settings.filter(setting => setting.heading).map(setting => setting.name), ['墨读阅读与标注', '阅读排版']);
  assert.deepEqual(settings.filter(setting => !setting.heading).map(setting => setting.name), ['墨水屏显示', '快捷标注条', '界面语言 / Interface language', '颜色含义', '黄色', '绿色', '蓝色', '粉色', '阅读行高', '阅读行宽', '恢复阅读预设']);
  assert.equal(elements.some(element => /^h[1-6]$/.test(element.tag)), false);
  assert.match(elements.find(element => element.tag === 'p').text, /字号与字体/);
});

test('unloading does not detach workspace leaves and clears plugin-owned UI and reading overrides', () => {
  const { Plugin } = fixture();
  const plugin = new Plugin();
  const leaf = { state: { type: 'inkstone-annotations-list', group: 'user-sidebar-position' } };
  const leaves = [leaf];
  let detached = 0, closed = 0, disposed = 0, removed = 0;
  const clearedTimers = [], values = new Map([
    ['--inkstone-line-height', { value: '2', priority: '' }],
    ['--inkstone-line-width', { value: '32em', priority: '' }],
  ]);
  const classes = new Set(['inkstone-annotations-monochrome']);
  const doc = {
    defaultView: { clearTimeout: timer => clearedTimers.push(timer) },
    body: {
      classList: { remove: name => classes.delete(name) },
      style: {
        setProperty: (name, value, priority) => values.set(name, { value, priority }),
        removeProperty: name => values.delete(name),
      },
    },
  };
  Object.assign(plugin, {
    active: true,
    app: { workspace: { detachLeavesOfType() { detached++; leaves.length = 0; } } },
    modals: new Set(), documents: new Set([doc]),
    toolbars: new Map([[doc, { inkstoneDispose() { disposed++; }, remove() { removed++; } }]]),
    toolbarTimers: new Map([[doc, 42]]),
    readingOriginals: new Map([[doc, [
      { name: '--inkstone-line-height', value: '1.6', priority: 'important' },
      { name: '--inkstone-line-width', value: '', priority: '' },
    ]]]),
    recordCache: new Map([['note.md', { snapshot: 'cached note' }]]),
    lastAction: { view: leaf }, lastMarkdownView: leaf,
  });
  const modal = { close() { closed++; plugin.modals.delete(modal); } };
  plugin.modals.add(modal);

  plugin.onunload();

  assert.equal(detached, 0);
  assert.equal(leaves[0], leaf);
  assert.equal(leaves.length, 1);
  assert.equal(leaf.state.group, 'user-sidebar-position');
  assert.equal(plugin.active, false);
  assert.equal(closed, 1);
  assert.equal(plugin.modals.size, 0);
  assert.equal(disposed, 1);
  assert.equal(removed, 1);
  assert.equal(plugin.toolbars.size, 0);
  assert.deepEqual(clearedTimers, [42]);
  assert.equal(classes.has('inkstone-annotations-monochrome'), false);
  assert.deepEqual(values.get('--inkstone-line-height'), { value: '1.6', priority: 'important' });
  assert.equal(values.has('--inkstone-line-width'), false);
  assert.equal(plugin.recordCache.size, 0);
  assert.equal(plugin.lastAction, null);
  assert.equal(plugin.lastMarkdownView, null);
});
