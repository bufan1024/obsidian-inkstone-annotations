'use strict';

const { Plugin, Modal, Setting, Notice, Menu, MarkdownView, PluginSettingTab, Scope, setIcon } = require('obsidian');
const { buildAnnotationPlan, buildEditAnnotationPlan, buildRemoveAnnotationPlan, parseAnnotations, projectReadingParagraph, validateSelection, applyChanges } = annotationCore;
const PALETTE = [['yellow', '黄色'], ['green', '绿色'], ['blue', '蓝色'], ['rose', '粉色']];
const READING_PROPERTIES = ['--inkstone-line-height', '--inkstone-line-width'];

class AnnotationModal extends Modal {
  constructor(plugin, capture, requestedKind) {
    super(plugin.app);
    this.plugin = plugin;
    this.capture = capture;
    this.kind = capture.annotation?.kind || requestedKind || plugin.settings.lastKind;
    this.focusNote = requestedKind === 'note';
    this.color = capture.annotation ? capture.annotation.color : plugin.settings.lastColor;
    this.note = capture.annotation?.note || '';
    this.busy = false;
    this.focusFrame = null;
  }
  onOpen() {
    this.plugin.modals.add(this);
    this.modalEl.addClass('inkstone-annotation-modal');
    this.contentEl.createEl('h2', { text: this.capture.annotation ? '编辑标注' : '标注与备注' });
    this.contentEl.createEl('p', { cls: 'inkstone-dialog-description', text: '选择一种标记，可附加备注。点击标记旁的脚注编号即可查看备注。' });
    const selected = this.capture.annotation?.text || this.capture.snapshot.slice(this.capture.from, this.capture.to);
    this.contentEl.createEl('blockquote', { cls: 'inkstone-selection-preview', text: Array.from(selected).slice(0, 200).join('') + (Array.from(selected).length > 200 ? '…' : '') });
    const choices = this.contentEl.createDiv({ cls: 'inkstone-annotation-choices', attr: { 'aria-label': '标注样式', role: 'group' } });
    this.choiceButtons = [];
    const addChoice = (kind, color, label) => {
      const button = choices.createEl('button', { cls: 'inkstone-annotation-choice', attr: { type: 'button', 'aria-label': label } });
      button.createSpan({ cls: kind === 'highlight' ? `inkstone-annotation-swatch inkstone-swatch-${color}` : 'inkstone-annotation-underline-swatch', text: kind === 'highlight' ? '' : 'Aa' });
      button.createSpan({ text: label });
      this.choiceButtons.push({ button, kind, color });
      button.addEventListener('click', () => { this.kind = kind; this.color = color; this.refreshChoices(); });
    };
    addChoice('underline', 'yellow', '下划线');
    for (const [color, label] of PALETTE) addChoice('highlight', color, label);
    this.refreshChoices();
    new Setting(this.contentEl).setName('备注').setDesc('可选，备注保存在当前笔记的文末。')
      .addTextArea(input => {
        input.setValue(this.note).setPlaceholder('写下你的想法…').onChange(value => { this.note = value; });
        input.inputEl.setAttribute('aria-label', '备注内容');
        this.noteInput = input.inputEl;
      });
    new Setting(this.contentEl).setName('墨水屏显示').setDesc('使用灰底和不同线型区分颜色。')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.monochrome).onChange(value => this.plugin.setMonochrome(value)));
    this.errorEl = this.contentEl.createDiv({ cls: 'inkstone-annotation-error', attr: { role: 'alert' } });
    const actions = this.contentEl.createDiv({ cls: 'inkstone-annotation-actions' });
    if (this.capture.annotation) {
      const remove = actions.createEl('button', { text: '移除标注', cls: 'inkstone-remove-annotation', attr: { type: 'button' } });
      remove.addEventListener('click', () => this.perform(() => this.plugin.removeAnnotation(this.capture.annotation.from, this.capture)));
    }
    actions.createEl('button', { text: '取消', attr: { type: 'button' } }).addEventListener('click', () => this.close());
    this.saveButton = actions.createEl('button', { text: '保存标注', cls: 'mod-cta', attr: { type: 'button' } });
    this.saveButton.addEventListener('click', () => this.submit());
    this.contentEl.createEl('p', { cls: 'inkstone-dialog-hint', text: '可在命令面板中使用「墨读：撤销上次标注」。编辑视图也可使用系统撤销。' });
    this.scope.register(['Mod'], 'Enter', event => { event.preventDefault(); void this.submit(); return false; });
    if (this.focusNote) {
      this.focusFrame = this.contentEl.ownerDocument.defaultView.requestAnimationFrame(() => {
        this.focusFrame = null;
        if (this.plugin.modals.has(this) && this.noteInput.isConnected) this.noteInput.focus();
      });
    }
  }
  refreshChoices() {
    for (const choice of this.choiceButtons) {
      const selected = choice.kind === (this.kind === 'note' ? 'underline' : this.kind) && (choice.kind === 'underline' || choice.color === this.color);
      choice.button.classList.toggle('is-selected', selected);
      choice.button.setAttribute('aria-pressed', String(selected));
    }
  }
  async perform(work) {
    if (this.busy) return;
    this.busy = true;
    this.saveButton.disabled = true;
    this.errorEl.setText('');
    try { await work(); this.close(); }
    catch (error) { this.errorEl.setText(error.message || '未能保存标注，请重新选择文字。'); }
    finally { this.busy = false; this.saveButton.disabled = false; }
  }
  submit() { return this.perform(() => this.plugin.commit(this.capture, { kind: this.kind, color: this.color, note: this.note })); }
  onClose() {
    if (this.focusFrame !== null) this.contentEl.ownerDocument.defaultView.cancelAnimationFrame(this.focusFrame);
    this.plugin.modals.delete(this); this.contentEl.empty();
  }
}

class AnnotationSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const plugin = this.plugin;
    this.containerEl.empty();
    new Setting(this.containerEl).setName('墨读阅读与标注').setHeading();
    new Setting(this.containerEl).setName('墨水屏显示').setDesc('使用灰底及实线、双线、点线、虚线。')
      .addToggle(toggle => toggle.setValue(plugin.settings.monochrome).onChange(value => plugin.setMonochrome(value)));
    new Setting(this.containerEl).setName('快捷标注条').setDesc('选中文字后显示颜色、划线和备注操作，支持触控。')
      .addToggle(toggle => toggle.setValue(plugin.settings.toolbar).onChange(async value => {
        plugin.settings.toolbar = value; plugin.hideToolbars(); await plugin.saveData(plugin.settings);
      }));
    new Setting(this.containerEl).setName('阅读排版').setHeading();
    this.containerEl.createEl('p', { cls: 'inkstone-dialog-description', text: '字号与字体使用「设置 → 外观」中的原生控制。下列预设用于 Inkstone 主题。' });
    new Setting(this.containerEl).setName('阅读行高').addDropdown(dropdown => dropdown
      .addOptions({ '': '跟随主题 / CSS', '1.5': '紧凑 · 1.5', '1.75': '舒适 · 1.75', '2': '宽松 · 2.0' })
      .setValue(plugin.settings.readingLineHeight || '').onChange(value => plugin.setReadingPreference('readingLineHeight', value)));
    new Setting(this.containerEl).setName('阅读行宽').addDropdown(dropdown => dropdown
      .addOptions({ '': '跟随主题 / CSS', '32em': '窄 · 32em', '40em': '标准 · 40em', '48em': '宽 · 48em' })
      .setValue(plugin.settings.readingLineWidth || '').onChange(value => plugin.setReadingPreference('readingLineWidth', value)));
    new Setting(this.containerEl).setName('恢复阅读预设').setDesc('恢复主题或 CSS 设置，保留原生字号与字体。')
      .addButton(button => button.setButtonText('恢复默认').onClick(async () => {
        plugin.settings.readingLineHeight = ''; plugin.settings.readingLineWidth = '';
        plugin.applyReadingPreferences(); await plugin.saveData(plugin.settings); this.display();
      }));
  }
}

module.exports = class InkstoneAnnotations extends Plugin {
  async onload() {
    const saved = await this.loadData() || {};
    this.settings = {
      monochrome: Boolean(saved.monochrome), toolbar: saved.toolbar !== false,
      lastKind: saved.lastKind === 'underline' ? 'underline' : 'highlight',
      lastColor: PALETTE.some(([color]) => color === saved.lastColor) ? saved.lastColor : 'yellow',
      readingLineHeight: ['1.5', '1.75', '2'].includes(saved.readingLineHeight) ? saved.readingLineHeight : '',
      readingLineWidth: ['32em', '40em', '48em'].includes(saved.readingLineWidth) ? saved.readingLineWidth : ''
    };
    this.active = true;
    this.modals = new Set(); this.documents = new Set(); this.sections = new WeakMap();
    this.readingTargets = new WeakMap(); this.readingRefreshes = new WeakMap(); this.recordCache = new Map();
    this.toolbars = new Map(); this.toolbarStates = new WeakMap(); this.toolbarTimers = new Map(); this.readingOriginals = new Map();
    this.lastAction = null; this.lastMarkdownView = null;
    this.registerView(annotationViews.VIEW_TYPE, leaf => new (annotationViews.createSidebarClass(this))(leaf));
    this.registerEditorExtension(annotationEditor.createEditorExtension(this));
    this.registerMarkdownPostProcessor((element, context) => this.processReadingSection(element, context));
    this.app.workspace.onLayoutReady(() => {
      if (!this.active) return;
      this.rememberMarkdownView();
      this.app.workspace.iterateAllLeaves(leaf => {
        if (leaf.view instanceof MarkdownView && leaf.view.getMode() === 'preview') leaf.view.previewMode.rerender(true);
      });
    });
    this.bindDocument(document);
    this.registerEvent(this.app.workspace.on('window-open', (_window, win) => this.bindDocument(win.document)));
    this.registerEvent(this.app.workspace.on('active-leaf-change', leaf => this.handleActiveLeafChange(leaf)));
    this.registerEvent(this.app.workspace.on('editor-change', () => {
      this.hideToolbars(); this.scheduleToolbar(this.currentDocument());
    }));
    this.addSettingTab(new AnnotationSettings(this.app, this));
    this.addRibbonIcon('highlighter', '墨读：标注与备注', () => this.openAnnotation());
    this.addCommand({ id: 'annotate', name: '墨读：标注与备注', callback: () => this.openAnnotation() });
    this.addCommand({ id: 'underline', name: '墨读：添加下划线', callback: () => this.quickUnderline() });
    this.addCommand({ id: 'add-note', name: '墨读：添加备注', callback: () => this.openAnnotation(null, 'note') });
    for (const [color, label] of PALETTE) this.addCommand({ id: `highlight-${color}`, name: `墨读：${label}高亮`, callback: () => this.quickHighlight(color) });
    this.addCommand({ id: 'toggle-monochrome', name: '墨读：切换彩色／灰阶标注', callback: () => this.setMonochrome(!this.settings.monochrome) });
    this.addCommand({ id: 'show-annotations', name: '墨读：打开标注侧栏', callback: () => this.showAnnotations() });
    this.addCommand({ id: 'export-annotations', name: '墨读：导出当前笔记摘录', callback: () => this.exportAnnotations() });
    this.addCommand({ id: 'next-page', name: '墨读：下一屏', callback: () => this.turnPage(1) });
    this.addCommand({ id: 'previous-page', name: '墨读：上一屏', callback: () => this.turnPage(-1) });
    this.addCommand({ id: 'undo-annotation', name: '墨读：撤销上次标注', checkCallback: checking => {
      const available = !!this.lastAction;
      if (!checking && available) void this.undoAnnotation();
      return available;
    } });
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      let capture;
      try { capture = this.captureEditor(editor, info); } catch { return; }
      menu.addSeparator();
      menu.addItem(item => item.setTitle(capture.annotation ? '墨读：编辑标注…' : '墨读：标注与备注…').setIcon('highlighter').onClick(() => this.openAnnotation(capture)));
      menu.addItem(item => item.setTitle('墨读：添加下划线').setIcon('underline').onClick(() => this.quickUnderline(capture)));
    }));
    const status = this.addStatusBarItem();
    status.addClass('inkstone-reading-navigation');
    for (const [direction, label, text] of [[-1, '上一屏', '↑'], [1, '下一屏', '↓']]) {
      const button = status.createEl('button', { text, attr: { 'aria-label': `墨读：${label}`, title: `墨读：${label}`, type: 'button' } });
      button.addEventListener('click', () => this.turnPage(direction));
    }
  }
  onunload() {
    this.active = false;
    for (const modal of [...this.modals]) modal.close();
    this.hideToolbars();
    for (const [doc, timer] of this.toolbarTimers) doc.defaultView.clearTimeout(timer);
    for (const doc of this.documents) {
      doc.body.classList.remove('inkstone-annotations-monochrome');
      this.restoreReadingProperties(doc);
    }
    this.recordCache.clear();
    this.lastAction = null; this.lastMarkdownView = null;
  }
  rememberMarkdownView() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) this.lastMarkdownView = view;
    return view;
  }
  handleActiveLeafChange(leaf) {
    this.rememberMarkdownView();
    const content = leaf?.view?.getViewType?.() === annotationViews.VIEW_TYPE ? leaf.view.contentEl : null;
    const doc = content?.ownerDocument;
    const state = doc && this.toolbarStates.get(doc);
    if (this.app.workspace.activeLeaf === leaf && state?.anchor?.isConnected && content.contains(state.anchor) && this.toolbars.get(doc)?.isConnected) {
      // Obsidian can emit sidebar activation after its edit button has opened a menu.
      try { this.assertCurrent(state.capture); return; } catch {}
    }
    this.hideToolbars();
  }
  currentView() {
    const active = this.rememberMarkdownView();
    const sidebarActive = this.app.workspace.activeLeaf?.view?.getViewType?.() === annotationViews.VIEW_TYPE;
    const view = active || (sidebarActive ? this.lastMarkdownView : null);
    if (!view?.file || !this.app.workspace.getLeavesOfType('markdown').some(leaf => leaf.view === view)) throw new Error('请先打开一篇 Markdown 笔记。');
    return view;
  }
  currentDocument() { try { return this.currentView().containerEl.ownerDocument; } catch { return document; } }
  recordsFor(snapshot, filePath) {
    const cached = this.recordCache.get(filePath);
    if (cached?.snapshot === snapshot) return cached.records;
    const records = parseAnnotations(snapshot);
    if (this.recordCache.size >= 8 && !this.recordCache.has(filePath)) this.recordCache.delete(this.recordCache.keys().next().value);
    this.recordCache.set(filePath, { snapshot, records });
    return records;
  }
  getAnnotationContext() {
    try {
      const view = this.currentView();
      const snapshot = view.getMode() === 'preview' ? view.getViewData() : view.editor.getValue();
      return { view, filePath: view.file.path, snapshot, records: this.recordsFor(snapshot, view.file.path) };
    } catch { return null; }
  }
  async showAnnotations() {
    this.rememberMarkdownView();
    let leaf = this.app.workspace.getLeavesOfType(annotationViews.VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); if (!leaf) return; await leaf.setViewState({ type: annotationViews.VIEW_TYPE, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
  processReadingSection(element, context) {
    this.sections.set(element, { context, element });
    const info = context.getSectionInfo(element);
    if (!info) return;
    const lines = info.text.split('\n');
    const start = lines.slice(0, info.lineStart).reduce((total, line) => total + line.length + 1, 0);
    const end = lines.slice(0, info.lineEnd + 1).reduce((total, line) => total + line.length + 1, 0);
    const records = this.recordsFor(info.text, context.sourcePath).filter(record => record.from >= start && record.to <= end);
    const nodes = [...element.querySelectorAll('mark.inkstone-highlight, u.inkstone-underline')];
    if (nodes.length !== records.length) return;
    nodes.forEach((node, index) => {
      const record = records[index];
      if (node.textContent === record.text) {
        this.readingTargets.set(node, { filePath: context.sourcePath, snapshot: info.text, from: record.from, text: record.text });
        node.dataset.inkstoneFrom = String(record.from);
        node.setAttribute('tabindex', '0'); node.setAttribute('role', 'button');
        node.setAttribute('aria-label', `编辑标注：${record.text}`);
      }
    });
  }
  refreshReadingTargets(view, snapshot) {
    if (view.getMode() !== 'preview' || view.getViewData() !== snapshot) return;
    const refreshed = new Set();
    for (const node of view.contentEl.querySelectorAll('mark.inkstone-highlight, u.inkstone-underline')) {
      let element = node;
      while (element && element !== view.contentEl && !this.sections.has(element)) element = element.parentElement;
      const section = this.sections.get(element);
      if (!section || refreshed.has(element) || section.context.sourcePath !== view.file?.path) continue;
      refreshed.add(element);
      try {
        if (section.context.getSectionInfo(element)?.text === snapshot) this.processReadingSection(element, section.context);
      } catch { /* A detached section keeps its stale guard until the renderer replaces it. */ }
    }
  }
  readingAnnotationContext(node, view) {
    let rendered = this.readingTargets.get(node);
    if (!rendered || rendered.filePath !== view.file?.path) throw new Error('嵌入笔记中的标注请先打开原笔记后编辑。');
    const refresh = this.readingRefreshes.get(view);
    if (refresh?.filePath === view.file?.path && rendered.snapshot === refresh.before && view.getViewData() === refresh.after) {
      this.refreshReadingTargets(view, refresh.after);
      rendered = this.readingTargets.get(node);
    }
    if (rendered.snapshot !== view.getViewData() || node.textContent !== rendered.text) throw new Error('笔记正在更新，请重新点击标注。');
    const context = { view, filePath: rendered.filePath, snapshot: rendered.snapshot, records: this.recordsFor(rendered.snapshot, rendered.filePath) };
    this.assertCurrent(context);
    return context;
  }
  bindDocument(doc) {
    if (this.documents.has(doc)) return;
    this.documents.add(doc);
    this.readingOriginals.set(doc, READING_PROPERTIES.map(name => ({ name, value: doc.body.style.getPropertyValue(name), priority: doc.body.style.getPropertyPriority(name) })));
    doc.body.classList.toggle('inkstone-annotations-monochrome', this.settings.monochrome);
    this.applyReadingPreferences();
    this.registerDomEvent(doc, 'contextmenu', event => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.getMode() !== 'preview' || !view.contentEl.contains(event.target)) return;
      const mark = event.target.closest?.('[data-inkstone-from]');
      if (mark) {
        let context;
        try { context = this.readingAnnotationContext(mark, view); } catch (error) { new Notice(error.message); return; }
        event.preventDefault(); event.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => item.setTitle('墨读：编辑标注…').setIcon('highlighter').onClick(() => this.editAnnotation(Number(mark.dataset.inkstoneFrom), context)));
        menu.addItem(item => item.setTitle('墨读：移除标注').setIcon('eraser').onClick(() => this.removeAnnotation(Number(mark.dataset.inkstoneFrom), context)));
        menu.showAtMouseEvent(event); return;
      }
      const selected = doc.getSelection();
      if (!selected || selected.isCollapsed || !view.contentEl.contains(selected.anchorNode) || !view.contentEl.contains(selected.focusNode)) return;
      let capture;
      try { capture = this.captureReading(view); } catch (error) { new Notice(error.message); return; }
      event.preventDefault(); event.stopPropagation(); this.hideToolbars();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('墨读：标注与备注…').setIcon('highlighter').onClick(() => this.openAnnotation(capture)));
      menu.addItem(item => item.setTitle('墨读：添加下划线').setIcon('underline').onClick(() => this.quickUnderline(capture)));
      menu.showAtMouseEvent(event);
    }, true);
    this.registerDomEvent(doc, 'click', event => {
      const mark = event.target.closest?.('[data-inkstone-from]');
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (mark && view?.getMode() === 'preview' && view.contentEl.contains(mark) && doc.getSelection()?.isCollapsed !== false) {
        event.preventDefault();
        try { this.showAnnotationMenu(Number(mark.dataset.inkstoneFrom), this.readingAnnotationContext(mark, view), mark); }
        catch (error) { new Notice(error.message); }
      }
    });
    this.registerDomEvent(doc, 'keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('[data-inkstone-from]')) {
        event.preventDefault();
        try { this.showAnnotationMenu(Number(event.target.dataset.inkstoneFrom), this.readingAnnotationContext(event.target, this.currentView()), event.target, true); }
        catch (error) { new Notice(error.message); }
        return;
      }
      if (event.key === 'Escape') this.dismissToolbar(doc);
      else this.scheduleToolbar(doc);
    });
    for (const name of ['selectionchange', 'pointerup', 'keyup', 'touchend']) this.registerDomEvent(doc, name, () => this.scheduleToolbar(doc));
    this.registerDomEvent(doc, 'scroll', event => {
      if (!this.toolbars.get(doc)?.contains(event.target)) this.dismissToolbar(doc);
    }, true);
    this.registerDomEvent(doc, 'pointerdown', event => {
      if (!event.target.closest?.('.inkstone-selection-toolbar')) { this.toolbarStates.delete(doc); this.hideToolbars(); }
    });
  }
  restoreReadingProperties(doc) {
    for (const { name, value, priority } of this.readingOriginals.get(doc) || []) {
      if (value) doc.body.style.setProperty(name, value, priority); else doc.body.style.removeProperty(name);
    }
  }
  applyReadingPreferences() {
    for (const doc of this.documents) {
      this.restoreReadingProperties(doc);
      if (this.settings.readingLineHeight) doc.body.style.setProperty('--inkstone-line-height', this.settings.readingLineHeight);
      if (this.settings.readingLineWidth) doc.body.style.setProperty('--inkstone-line-width', this.settings.readingLineWidth);
    }
  }
  async setReadingPreference(key, value) { this.settings[key] = value; this.applyReadingPreferences(); await this.saveData(this.settings); }
  async setMonochrome(value) {
    this.settings.monochrome = value;
    for (const doc of this.documents) doc.body.classList.toggle('inkstone-annotations-monochrome', value);
    await this.saveData(this.settings);
  }
  scheduleToolbar(doc) {
    if (!this.active || !this.settings.toolbar || this.modals.size || doc.activeElement?.closest?.('.inkstone-selection-toolbar')) return;
    const previous = this.toolbarTimers.get(doc);
    if (previous) doc.defaultView.clearTimeout(previous);
    this.toolbarTimers.set(doc, doc.defaultView.setTimeout(() => { this.toolbarTimers.delete(doc); this.showToolbar(doc); }, 120));
  }
  hideToolbars() {
    for (const toolbar of this.toolbars.values()) { toolbar.inkstoneDispose?.(); toolbar.remove(); }
    this.toolbars.clear();
  }
  dismissToolbar(doc) {
    const state = this.toolbarStates.get(doc);
    if (state) state.dismissed = true;
    this.hideToolbars();
  }
  positionToolbar(toolbar, capture, rect) {
    const viewport = toolbar.ownerDocument.defaultView;
    const viewRect = capture.view.contentEl.getBoundingClientRect();
    const bounds = toolbar.getBoundingClientRect();
    const center = rect?.width ? rect.left + rect.width / 2 : viewRect.left + viewRect.width / 2;
    const above = rect?.height ? rect.top - bounds.height - 10 : viewRect.top + 8;
    const below = rect?.height ? rect.bottom + 10 : above;
    const y = above >= 8 ? above : below;
    toolbar.style.left = `${Math.max(8, Math.min(center - bounds.width / 2, viewport.innerWidth - bounds.width - 8))}px`;
    toolbar.style.top = `${Math.max(8, Math.min(y, viewport.innerHeight - bounds.height - 8))}px`;
  }
  async copySelection(capture, text, doc) {
    this.assertCurrent(capture);
    await doc.defaultView.navigator.clipboard.writeText(text);
    new Notice('已复制选中文字。');
  }
  showToolbar(doc) {
    if (this.toolbars.get(doc)?.classList?.contains('inkstone-annotation-menu')) return;
    if (!this.active || !this.settings.toolbar || this.modals.size || doc.querySelector('.modal-container, .menu') || doc.activeElement?.closest?.('.inkstone-selection-toolbar')) return;
    let capture;
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || view.containerEl.ownerDocument !== doc) return this.hideToolbars();
      if (view.getMode() !== 'preview' && !view.editor.somethingSelected()) { this.toolbarStates.delete(doc); return this.hideToolbars(); }
      capture = this.capture();
    } catch { this.toolbarStates.delete(doc); return this.hideToolbars(); }
    const previous = this.toolbarStates.get(doc);
    if (previous && previous.capture.view === capture.view && previous.capture.filePath === capture.filePath && previous.capture.reading === capture.reading && previous.capture.snapshot === capture.snapshot && previous.capture.from === capture.from && previous.capture.to === capture.to && (previous.dismissed || this.toolbars.get(doc)?.isConnected)) return;
    this.toolbarStates.set(doc, { capture, dismissed: false });
    this.hideToolbars();
    const selection = doc.getSelection();
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
    const copiedText = capture.reading ? selection.toString() : capture.snapshot.slice(capture.from, capture.to);
    const toolbar = doc.createElement('div'); toolbar.className = 'inkstone-selection-toolbar';
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '墨读快捷标注');
    toolbar.addEventListener('pointerdown', event => event.preventDefault());
    toolbar.addEventListener('mousedown', event => event.preventDefault());
    const row = doc.createElement('div'); row.className = 'inkstone-toolbar-actions'; toolbar.appendChild(row);
    const styles = doc.createElement('div'); styles.className = 'inkstone-toolbar-styles'; styles.hidden = true;
    styles.id = 'inkstone-toolbar-styles'; styles.setAttribute('role', 'group'); styles.setAttribute('aria-label', '划线样式');
    toolbar.appendChild(styles);
    const run = work => {
      this.dismissToolbar(doc);
      Promise.resolve().then(() => { this.assertCurrent(capture); return work(); }).catch(error => new Notice(error.message || '操作未完成，请重新选择文字。'));
    };
    const add = (parent, label, icon, text, work, keepOpen = false) => {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'inkstone-toolbar-action';
      button.setAttribute('aria-label', label); button.title = label;
      if (icon) {
        const glyph = doc.createElement('span'); glyph.className = 'inkstone-toolbar-icon'; glyph.setAttribute('aria-hidden', 'true');
        setIcon(glyph, icon); button.appendChild(glyph);
      }
      if (text) { const caption = doc.createElement('span'); caption.textContent = text; button.appendChild(caption); }
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const anchor = button.getBoundingClientRect();
        if (keepOpen) work(event, anchor); else run(() => work(event, anchor));
      });
      parent.appendChild(button); return button;
    };
    add(row, '复制', 'copy', '复制', () => this.copySelection(capture, copiedText, doc));
    const stroke = doc.createElement('div'); stroke.className = 'inkstone-toolbar-stroke'; row.appendChild(stroke);
    const kind = capture.annotation?.kind || this.settings.lastKind;
    const color = capture.annotation ? capture.annotation.color : this.settings.lastColor;
    add(stroke, '划线', kind === 'underline' ? 'underline' : 'highlighter', '划线', () => this.commit(capture, { kind, color }));
    const toggle = add(stroke, '划线样式', 'chevron-down', '', event => {
      styles.hidden = !styles.hidden;
      toggle.setAttribute('aria-expanded', String(!styles.hidden));
      this.positionToolbar(toolbar, capture, rect);
      if (!styles.hidden && event.detail === 0) styles.querySelector('button')?.focus();
    }, true);
    toggle.classList.add('inkstone-toolbar-dropdown'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', styles.id);
    for (const [nextColor, label] of PALETTE) {
      const button = add(styles, label, null, label.replace('色', ''), () => this.commit(capture, { kind: 'highlight', color: nextColor }));
      button.classList.add('inkstone-toolbar-style');
      button.setAttribute('aria-pressed', String(kind === 'highlight' && color === nextColor));
      const dot = doc.createElement('span'); dot.className = `inkstone-toolbar-dot inkstone-swatch-${nextColor}`; dot.setAttribute('aria-hidden', 'true');
      button.prepend(dot);
    }
    const underline = add(styles, '下划线', null, '下划线', () => this.commit(capture, { kind: 'underline' }));
    underline.classList.add('inkstone-toolbar-style', 'inkstone-toolbar-underline'); underline.setAttribute('aria-pressed', String(kind === 'underline'));
    add(row, '写想法', 'message-square', '写想法', () => this.showSelectionIdea(capture, rect, copiedText));
    const more = add(row, '更多', 'ellipsis', '', (_event, anchor) => {
      const menu = new Menu();
      menu.addItem(item => item.setTitle('打开标注侧栏').setIcon('list').onClick(() => this.showAnnotations()));
      menu.addItem(item => item.setTitle('导出当前笔记摘录').setIcon('file-output').onClick(() => run(() => this.exportAnnotations())));
      if (capture.annotation) menu.addItem(item => item.setTitle('移除标注').setIcon('eraser').onClick(() => {
        this.removeAnnotation(capture.annotation.from, capture).catch(() => {});
      }));
      menu.showAtPosition({ x: anchor.left, y: anchor.bottom + 4 }, doc);
    });
    more.setAttribute('aria-haspopup', 'menu');
    doc.body.appendChild(toolbar); this.toolbars.set(doc, toolbar);
    this.positionToolbar(toolbar, capture, rect);
  }
  captureEditor(editor, info) {
    const view = this.currentView();
    if (view.editor !== editor || view.file.path !== info.file?.path) throw new Error('请在当前笔记中重新选择文字。');
    if (editor.listSelections().length !== 1) throw new Error('请一次只选择一段文字。');
    const snapshot = editor.getValue();
    const from = editor.posToOffset(editor.getCursor('from')), to = editor.posToOffset(editor.getCursor('to'));
    const annotation = this.recordsFor(snapshot, view.file.path).find(record => from >= record.contentFrom && to <= record.contentTo);
    if (!annotation || from !== to) validateSelection({ document: snapshot, from, to });
    return { view, editor, filePath: view.file.path, snapshot, from, to, annotation, reading: false };
  }
  readingSection(view, paragraph) {
    let element = paragraph;
    while (element && element !== view.contentEl && !this.sections.has(element)) element = element.parentElement;
    const mapped = this.sections.get(element);
    const info = mapped?.context.getSectionInfo(mapped.element);
    if (!mapped || mapped.context.sourcePath !== view.file.path || !info || info.lineStart !== info.lineEnd || !element.classList.contains('el-p')) throw new Error('此段含有复杂格式，请切换到编辑视图标注。');
    const snapshot = view.getViewData();
    if (info.text !== snapshot) throw new Error('笔记正在更新，请重新选择文字后标注。');
    const lines = snapshot.split('\n');
    const raw = lines[info.lineStart]?.replace(/\r$/, '');
    const projection = projectReadingParagraph(raw);
    if (!projection) throw new Error('此段含有复杂格式，请切换到编辑视图标注。');
    const lineOffset = lines.slice(0, info.lineStart).reduce((offset, line) => offset + line.length + 1, 0);
    return { snapshot, projection, lineOffset };
  }
  captureReading(view) {
    const doc = view.containerEl.ownerDocument;
    const selection = doc.getSelection();
    if (!selection || selection.isCollapsed || !view.contentEl.contains(selection.anchorNode) || !view.contentEl.contains(selection.focusNode)) throw new Error('请先选中笔记中的普通文字，再添加标注。');
    const range = selection.getRangeAt(0), paragraph = range.startContainer.parentElement?.closest('p');
    if (!paragraph || !paragraph.contains(range.endContainer)) throw new Error('请只选择同一段中的普通文字。');
    const { snapshot, projection, lineOffset } = this.readingSection(view, paragraph);
    const nodes = [], walker = doc.createTreeWalker(paragraph, 4);
    let node, text = '', position = 0, from = null, to = null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('sup.footnote-ref, .footnote-ref')) continue;
      nodes.push(node);
      if (node === range.startContainer) from = position + range.startOffset;
      if (node === range.endContainer) to = position + range.endOffset;
      text += node.nodeValue; position += node.nodeValue.length;
    }
    if (text !== projection.text || from === null || to === null || from >= to) throw new Error('此选区含有复杂格式，请切换到编辑视图标注。');
    const sourceFrom = lineOffset + projection.starts[from], sourceTo = lineOffset + projection.ends[to - 1];
    validateSelection({ document: snapshot, from: sourceFrom, to: sourceTo });
    const annotation = this.recordsFor(snapshot, view.file.path).find(record => sourceFrom >= record.contentFrom && sourceTo <= record.contentTo);
    return { view, editor: view.editor, filePath: view.file.path, snapshot, from: sourceFrom, to: sourceTo, annotation, reading: true };
  }
  capture() { const view = this.currentView(); return view.getMode() === 'preview' ? this.captureReading(view) : this.captureEditor(view.editor, view); }
  openAnnotation(capture = null, kind) {
    try { this.hideToolbars(); new AnnotationModal(this, capture || this.capture(), kind).open(); }
    catch (error) { new Notice(error.message); }
  }
  showAnnotationMenu(from, context = this.getAnnotationContext(), anchor, focusFirst = false) {
    try {
      if (!context) throw new Error('请先打开一篇 Markdown 笔记。');
      this.assertCurrent(context);
      const annotation = this.recordsFor(context.snapshot, context.filePath).find(record => record.from === from);
      if (!annotation) throw new Error('标注已发生变化，请重新点击。');
      const doc = context.view.containerEl.ownerDocument;
      if (!anchor?.isConnected || anchor.ownerDocument !== doc || !context.view.contentEl.contains(anchor) || anchor.textContent !== annotation.text) throw new Error('标注正在更新，请重新点击。');
      const rect = anchor.getBoundingClientRect();
      const capture = { ...context, editor: context.view.editor, from: annotation.contentFrom, to: annotation.contentTo, annotation, reading: context.view.getMode() === 'preview' };
      this.showAnnotationPopover(capture, annotation, rect, { anchor, focusFirst });
    } catch (error) { new Notice(error.message); }
  }
  showSidebarAnnotationMenu(from, context, anchor) {
    try {
      if (!context) throw new Error('请先打开一篇 Markdown 笔记。');
      this.assertCurrent(context);
      const annotation = this.recordsFor(context.snapshot, context.filePath).find(record => record.from === from);
      if (!annotation) throw new Error('标注已发生变化，请重新点击。');
      const doc = context.view.containerEl.ownerDocument;
      if (!anchor?.isConnected || anchor.ownerDocument !== doc || !anchor.matches?.('button') ||
          !this.app.workspace.getLeavesOfType(annotationViews.VIEW_TYPE).some(leaf => leaf.view.contentEl?.ownerDocument === doc && leaf.view.contentEl.contains(anchor))) {
        throw new Error('标注列表正在更新，请重新点击「编辑」。');
      }
      const capture = { ...context, editor: context.view.editor, from: annotation.contentFrom, to: annotation.contentTo, annotation, reading: context.view.getMode() === 'preview' };
      this.showAnnotationPopover(capture, annotation, anchor.getBoundingClientRect(), { anchor, focusFirst: true });
    } catch (error) { new Notice(error.message); }
  }
  showSelectionIdea(capture, rect, text) {
    try {
      this.assertCurrent(capture);
      const record = capture.annotation || { kind: 'underline', text, note: '' };
      this.showAnnotationPopover(capture, record, rect, { startComposer: true });
    } catch (error) { new Notice(error.message); }
  }
  showAnnotationPopover(capture, record, rect, { anchor, focusFirst = false, startComposer = false } = {}) {
    const doc = capture.view.containerEl.ownerDocument;
    this.hideToolbars();
    this.toolbarStates.set(doc, { capture, dismissed: true, anchor });
    const timer = this.toolbarTimers.get(doc);
    if (timer) { doc.defaultView.clearTimeout(timer); this.toolbarTimers.delete(doc); }
    let menu;
    const perform = async work => {
      try {
        this.assertCurrent(capture);
        await work();
        this.dismissToolbar(doc);
      } catch (error) {
        if (!menu.isConnected) new Notice(error.message);
        throw error;
      }
    };
    const close = () => { this.dismissToolbar(doc); if (anchor?.isConnected) anchor.focus({ preventScroll: true }); };
    menu = annotationMenu.createAnnotationMenu({
      doc, record, startComposer,
      bindSaveHotkey: save => {
        const scope = new Scope(this.app.scope);
        scope.register(['Mod'], 'Enter', event => {
          if (menu.contains(event.target) && !event.isComposing) { save(); return false; }
        });
        this.app.keymap.pushScope(scope);
        return () => this.app.keymap.popScope(scope);
      },
      onStyle: options => perform(() => this.commit(capture, options)),
      onSaveNote: (note, style = record) => perform(() => {
        if (!capture.annotation && !note.trim()) throw new Error('请先写下想法，再保存。');
        return this.commit(capture, { kind: style.kind, color: style.color, note });
      }),
      onDelete: () => perform(() => this.removeAnnotation(capture.annotation.from, capture)),
      onClose: close,
      onCancel: startComposer ? close : undefined,
      onResize: () => { if (menu?.isConnected) this.positionToolbar(menu, capture, rect); },
    });
    menu.addEventListener('pointerdown', event => {
      if (!event.target.closest('textarea, input')) event.preventDefault();
    });
    menu.addEventListener('mousedown', event => {
      if (!event.target.closest('textarea, input')) event.preventDefault();
    });
    doc.body.appendChild(menu); this.toolbars.set(doc, menu);
    this.positionToolbar(menu, capture, rect);
    if (focusFirst) menu.querySelector('button')?.focus();
  }
  editAnnotation(from, context = this.getAnnotationContext()) {
    try {
      if (!context) throw new Error('请先打开一篇 Markdown 笔记。');
      this.assertCurrent(context);
      const annotation = this.recordsFor(context.snapshot, context.filePath).find(record => record.from === from);
      if (!annotation) throw new Error('标注已发生变化，请重新选择。');
      this.openAnnotation({ ...context, editor: context.view.editor, from: annotation.contentFrom, to: annotation.contentTo, annotation, reading: context.view.getMode() === 'preview' });
    } catch (error) { new Notice(error.message); }
  }
  async removeAnnotation(from, context = this.getAnnotationContext()) {
    try {
      if (!context) throw new Error('请先打开一篇 Markdown 笔记。');
      this.assertCurrent(context);
      const plan = buildRemoveAnnotationPlan({ document: context.snapshot, from });
      await this.applyPlan(context, plan); this.hideToolbars();
    } catch (error) { new Notice(error.message); throw error; }
  }
  async quickUnderline(capture = null) {
    try { await this.commit(capture || this.capture(), { kind: 'underline' }); }
    catch (error) { new Notice(error.message); }
  }
  async quickHighlight(color) {
    try { await this.commit(this.capture(), { kind: 'highlight', color }); }
    catch (error) { new Notice(error.message); }
  }
  assertCurrent(capture) {
    if (!this.active) throw new Error('标注插件已关闭。');
    if (this.currentView() !== capture.view || capture.view.file?.path !== capture.filePath) throw new Error('当前笔记已切换，请关闭面板后重新选择文字。');
    const text = capture.view.getMode() === 'preview' ? capture.view.getViewData() : capture.view.editor.getValue();
    if (text !== capture.snapshot) throw new Error('笔记已发生变化，请关闭面板后重新选择文字。');
  }
  async inEditor(view, work) {
    const state = view.leaf.getViewState(), reading = view.getMode() === 'preview';
    if (reading) await view.leaf.setViewState({ ...state, state: { ...state.state, mode: 'source' } });
    try { return await work(view.editor); }
    finally { if (reading && view.file?.path === state.state?.file) await view.leaf.setViewState(state); }
  }
  async applyPlan(capture, plan) {
    this.assertCurrent(capture);
    const after = applyChanges(capture.snapshot, plan.changes);
    await this.inEditor(capture.view, editor => {
      this.assertCurrent(capture);
      if (editor.getValue() !== capture.snapshot) throw new Error('笔记已发生变化，请重新选择文字。');
      const changes = plan.changes.map(change => ({ from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.text }));
      editor.transaction({ changes }, 'inkstone-annotation');
      editor.setCursor(editor.offsetToPos(plan.caretOffset));
      this.lastAction = { view: capture.view, filePath: capture.filePath, before: capture.snapshot, after };
    });
    // Footnote-only edits may reuse the rendered paragraph without rerunning its postprocessor.
    this.readingRefreshes.set(capture.view, { filePath: capture.filePath, before: capture.snapshot, after });
    this.refreshReadingTargets(capture.view, after);
  }
  async commit(capture, options) {
    this.assertCurrent(capture);
    const plan = capture.annotation
      ? buildEditAnnotationPlan({ document: capture.snapshot, from: capture.annotation.from, ...options })
      : buildAnnotationPlan({ document: capture.snapshot, from: capture.from, to: capture.to, ...options });
    await this.applyPlan(capture, plan);
    this.settings.lastKind = options.kind === 'highlight' ? 'highlight' : 'underline';
    if (options.color) this.settings.lastColor = options.color;
    this.hideToolbars(); await this.saveData(this.settings);
  }
  async undoAnnotation() {
    const action = this.lastAction;
    if (!action) return;
    try {
      if (this.currentView() !== action.view || action.view.file?.path !== action.filePath) throw new Error('请先打开刚才标注的笔记。');
      const current = action.view.getMode() === 'preview' ? action.view.getViewData() : action.view.editor.getValue();
      if (current !== action.after) throw new Error('笔记已发生其他修改，请使用编辑器的系统撤销。');
      await this.inEditor(action.view, editor => {
        this.assertCurrent({ view: action.view, filePath: action.filePath, snapshot: action.after });
        editor.undo();
        if (editor.getValue() !== action.before) throw new Error('撤销历史已变化，请在编辑视图中检查撤销结果。');
      });
      this.readingRefreshes.set(action.view, { filePath: action.filePath, before: action.after, after: action.before });
      this.refreshReadingTargets(action.view, action.before);
      this.lastAction = null;
    } catch (error) { new Notice(error.message); }
  }
  async revealAnnotation(from, context = this.getAnnotationContext()) {
    try {
      if (!context) return;
      this.assertCurrent(context);
      this.app.workspace.setActiveLeaf(context.view.leaf, { focus: true });
      if (context.view.getMode() === 'preview') {
        const node = [...context.view.contentEl.querySelectorAll(`[data-inkstone-from="${from}"]`)].find(candidate => {
          const rendered = this.readingTargets.get(candidate);
          return rendered?.filePath === context.filePath && rendered.snapshot === context.snapshot && rendered.from === from && candidate.textContent === rendered.text;
        });
        if (node) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.focus({ preventScroll: true }); return; }
      }
      await this.inEditor(context.view, editor => {
        this.assertCurrent(context);
        const pos = editor.offsetToPos(from); editor.setCursor(pos); editor.scrollIntoView({ from: pos, to: pos }, true);
      });
    } catch (error) { new Notice(error.message); }
  }
  async exportAnnotations() {
    try {
      const context = this.getAnnotationContext();
      if (!context?.records.length) throw new Error('当前笔记还没有墨读标注。');
      this.assertCurrent(context);
      const file = context.view.file;
      const folder = file.parent?.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
      const base = `${folder}${file.basename}-墨读摘录`;
      let path = `${base}.md`, sequence = 2;
      while (this.app.vault.getAbstractFileByPath(path)) path = `${base}-${sequence++}.md`;
      const link = this.app.fileManager.generateMarkdownLink(file, path, '', '原文');
      const lines = [`# ${file.basename} · 墨读摘录`, '', `来源：${link}`, ''];
      for (const [index, record] of context.records.entries()) {
        const label = record.kind === 'underline' ? '下划线' : PALETTE.find(([color]) => color === record.color)?.[1] || '高亮';
        const literal = record.text.replace(/[\\`*_{}\[\]()#+.!<>|~=$&-]/g, character => '\\' + character);
        lines.push(`## ${index + 1}. ${label}`, '', ...literal.split(/\r\n|\r|\n/).map(line => `> ${line}`), '');
        if (record.note) lines.push('备注：', '', record.note, '');
      }
      const exported = await this.app.vault.create(path, lines.join('\n'));
      await this.app.workspace.getLeaf('tab').openFile(exported);
    } catch (error) { new Notice(error.message); }
  }
  turnPage(direction) {
    try {
      const view = this.currentView();
      const scroller = view.getMode() === 'preview' ? view.contentEl.querySelector('.markdown-preview-view') : view.contentEl.querySelector('.cm-scroller');
      if (!scroller) return;
      const distance = Math.max(1, scroller.clientHeight - Math.min(80, scroller.clientHeight * 0.15));
      scroller.scrollTo({ top: Math.max(0, Math.min(scroller.scrollTop + direction * distance, scroller.scrollHeight - scroller.clientHeight)), left: scroller.scrollLeft, behavior: 'instant' });
    } catch (error) { new Notice(error.message); }
  }
};
