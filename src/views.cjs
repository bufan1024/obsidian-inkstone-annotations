'use strict';

const VIEW_TYPE = 'inkstone-annotations-list';
const FILTERS = [['all', '全部标注'], ['yellow', '黄色高亮'], ['green', '绿色高亮'], ['blue', '蓝色高亮'], ['rose', '粉色高亮'], ['underline', '下划线']];

function add(parent, tag, text, className) {
  const element = parent.ownerDocument.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createSidebarClass(plugin) {
  const { ItemView, Notice } = require('obsidian');
  const t = (source, params = {}) => typeof plugin.t === 'function'
    ? plugin.t(source, params)
    : source.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
  const annotationLabel = record => typeof plugin.annotationLabel === 'function' ? plugin.annotationLabel(record)
    : t(record.kind === 'underline' ? '下划线' : FILTERS.find(([value]) => value === record.color)?.[1] || '高亮');
  return class AnnotationSidebar extends ItemView {
    constructor(leaf) {
      super(leaf);
      this.filter = 'all';
      this.query = '';
      this.thoughtsOnly = false;
      this.events = [];
      this.opened = false;
      this.nonMarkdownActive = false;
      this.controls = null;
      this.listEl = null;
      this.renderedContext = null;
      this.renderedFilePath = null;
      this.renderedFilter = null;
      this.renderedLabels = null;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return t('当前笔记标注'); }
    getIcon() { return 'highlighter'; }

    async onOpen() {
      this.detachEvents();
      this.opened = true;
      const activeType = this.app.workspace.activeLeaf?.view?.getViewType?.();
      this.nonMarkdownActive = Boolean(activeType && activeType !== 'markdown' && activeType !== VIEW_TYPE);
      this.contentEl.classList.add('inkstone-annotation-sidebar');
      this.listen(this.app.workspace, 'active-leaf-change', leaf => {
        const type = leaf?.view?.getViewType?.();
        if (type === VIEW_TYPE) return;
        if (type) this.nonMarkdownActive = type !== 'markdown';
        if (leaf === null) this.nonMarkdownActive = true;
        this.render();
      });
      this.listen(this.app.workspace, 'editor-change', () => this.render());
      this.listen(this.app.vault, 'modify', file => {
        if (plugin.getAnnotationContext()?.filePath === file.path) this.render();
      });
      this.render();
    }

    listen(emitter, event, callback) {
      this.events.push({ emitter, ref: emitter.on(event, callback) });
    }

    detachEvents() {
      for (const { emitter, ref } of this.events) emitter.offref(ref);
      this.events = [];
    }

    async onClose() {
      this.opened = false;
      this.detachEvents();
      this.contentEl.replaceChildren();
      this.contentEl.classList.remove('inkstone-annotation-sidebar');
      this.controls = null;
      this.listEl = null;
      this.renderedContext = null;
      this.renderedFilePath = null;
      this.renderedFilter = null;
      this.renderedLabels = null;
      this.resetFilters();
    }

    async perform(action) {
      try { await action(); }
      catch (error) { new Notice(t(error.message || '未能操作标注，请重新打开当前笔记。')); }
    }

    resetFilters() {
      this.filter = 'all';
      this.query = '';
      this.thoughtsOnly = false;
    }

    labels() {
      return {
        title: t('当前笔记标注'),
        search: t('搜索摘录和想法'),
        searchPlaceholder: t('搜索摘录或想法'),
        color: t('筛选标注颜色'),
        thoughts: t('仅有想法'),
        clear: t('清空筛选'),
        exportAll: t('导出全部'),
        thought: t('想法'),
        actions: ['定位原文', '编辑', '删除'].map(title => t(title)),
        styles: FILTERS.map(([value, label]) => value === 'all' ? t(label) : annotationLabel({ kind: value === 'underline' ? 'underline' : 'highlight', color: value === 'underline' ? null : value })),
      };
    }

    createLayout() {
      const content = this.contentEl;
      content.replaceChildren();
      const header = add(content, 'header', undefined, 'inkstone-annotation-sidebar-header');
      const heading = add(header, 'div', undefined, 'inkstone-annotation-sidebar-heading');
      const title = add(heading, 'h2');
      const status = add(heading, 'p', undefined, 'inkstone-annotation-sidebar-count');
      status.setAttribute('aria-live', 'polite');
      const source = add(header, 'div', undefined, 'inkstone-annotation-sidebar-source');
      const sourceName = add(source, 'p', undefined, 'inkstone-annotation-sidebar-source-name');
      const sourceFolder = add(source, 'p', undefined, 'inkstone-annotation-sidebar-source-folder');
      const toolbar = add(header, 'div', undefined, 'inkstone-annotation-sidebar-toolbar');
      const search = add(toolbar, 'input', undefined, 'inkstone-annotation-sidebar-search');
      search.type = 'search';
      search.addEventListener('input', () => { this.query = search.value; this.render(); });
      const filter = add(toolbar, 'select');
      for (const [value] of FILTERS) {
        const option = add(filter, 'option');
        option.value = value;
      }
      filter.addEventListener('change', () => { this.filter = filter.value; this.render(); });
      const exportButton = add(toolbar, 'button');
      exportButton.setAttribute('type', 'button');
      exportButton.addEventListener('click', () => this.perform(() => plugin.exportAnnotations()));
      const filters = add(toolbar, 'div', undefined, 'inkstone-annotation-sidebar-filters');
      const thoughtToggle = add(filters, 'label', undefined, 'inkstone-annotation-sidebar-thoughts');
      const thoughts = add(thoughtToggle, 'input');
      thoughts.type = 'checkbox';
      const thoughtsLabel = add(thoughtToggle, 'span');
      thoughts.addEventListener('change', () => { this.thoughtsOnly = thoughts.checked; this.render(); });
      const clear = add(filters, 'button');
      clear.setAttribute('type', 'button');
      clear.addEventListener('click', () => { this.resetFilters(); this.render(); });
      this.controls = { title, status, source, sourceName, sourceFolder, search, filter, thoughts, thoughtsLabel, clear, exportButton };
      this.listEl = add(content, 'div', undefined, 'inkstone-annotation-sidebar-list');
    }

    render() {
      if (!this.opened) return;
      const context = this.nonMarkdownActive ? null : plugin.getAnnotationContext();
      const previous = this.renderedContext;
      const filePath = context?.filePath || null;
      // Search and filters describe only the current note; a new note starts unfiltered.
      if (filePath !== this.renderedFilePath) this.resetFilters();
      const filterState = JSON.stringify([this.filter, this.query, this.thoughtsOnly]);
      const labels = this.labels();
      const labelState = JSON.stringify(labels);
      // Another Markdown pane can show identical text but needs its own action captures.
      if (this.listEl && previous?.view === context?.view && previous?.filePath === context?.filePath &&
        previous?.snapshot === context?.snapshot && this.renderedFilter === filterState && this.renderedLabels === labelState) return;
      const scrollTop = this.renderedFilePath === filePath && this.renderedFilter === filterState ? this.listEl?.scrollTop || 0 : 0;
      if (!this.listEl) this.createLayout();
      const records = context?.records || [];
      const filtered = [];
      const query = this.query.trim().toLocaleLowerCase();
      for (const [index, record] of records.entries()) {
        const matchesStyle = this.filter === 'all' || (this.filter === 'underline' ? record.kind === 'underline' : record.kind === 'highlight' && record.color === this.filter);
        const matchesThought = !this.thoughtsOnly || Boolean(record.note?.trim());
        const matchesSearch = !query || [record.text, record.note].some(value => String(value || '').toLocaleLowerCase().includes(query));
        if (matchesStyle && matchesThought && matchesSearch) {
          filtered.push({ record, ordinal: index + 1 });
        }
      }
      const { title, status, source, sourceName, sourceFolder, search, filter, thoughts, thoughtsLabel, clear, exportButton } = this.controls;
      title.textContent = labels.title;
      status.textContent = t('{shown} / {total} 条标注', { shown: filtered.length, total: records.length });
      source.setAttribute('title', filePath || '');
      source.setAttribute('aria-label', context ? t('当前笔记：{filePath}', { filePath }) : t('尚未选择当前笔记'));
      if (context) {
        const parts = filePath.split('/');
        const file = parts.pop();
        sourceName.textContent = file.replace(/\.md$/i, '') || file;
        sourceFolder.textContent = parts.join(' / ') || t('笔记库根目录');
      } else {
        sourceName.textContent = t('选择一篇笔记');
        sourceFolder.textContent = t('打开一篇 Markdown 笔记后查看标注。');
      }
      search.setAttribute('aria-label', labels.search);
      search.placeholder = labels.searchPlaceholder;
      search.value = this.query;
      search.disabled = !context;
      filter.setAttribute('aria-label', labels.color);
      for (const [index, option] of Array.from(filter.children).entries()) option.textContent = labels.styles[index];
      filter.value = this.filter;
      filter.disabled = !context;
      thoughts.setAttribute('aria-label', labels.thoughts);
      thoughts.checked = this.thoughtsOnly;
      thoughts.disabled = !context;
      thoughtsLabel.textContent = labels.thoughts;
      clear.textContent = labels.clear;
      clear.disabled = !context;
      exportButton.textContent = labels.exportAll;
      exportButton.disabled = records.length === 0;
      const exportDescription = t('导出当前笔记的全部 {total} 条标注，包含当前搜索或筛选未显示的标注。', { total: records.length });
      exportButton.setAttribute('aria-description', exportDescription);
      exportButton.setAttribute('title', exportDescription);
      this.renderedContext = context;
      this.renderedFilePath = filePath;
      this.renderedFilter = filterState;
      this.renderedLabels = labelState;
      const list = this.listEl;
      list.replaceChildren();
      if (!context || filtered.length === 0) {
        add(list, 'p', !context ? t('暂无当前笔记。') : records.length ? t('没有符合搜索或筛选条件的标注。') : t('当前笔记暂无标注。'), 'inkstone-annotation-sidebar-empty');
        list.scrollTop = scrollTop;
        return;
      }
      for (const { record, ordinal } of filtered) {
        const card = add(list, 'article', undefined, 'inkstone-annotation-card');
        card.setAttribute('data-kind', record.kind);
        card.setAttribute('data-color', record.color || '');
        const meta = add(card, 'div', undefined, 'inkstone-annotation-card-meta');
        const label = annotationLabel(record);
        const badge = add(meta, 'span', undefined, `inkstone-annotation-card-kind inkstone-annotation-kind-${record.kind === 'underline' ? 'underline' : record.color || 'default'}`);
        badge.setAttribute('aria-label', t('标注样式：{label}', { label }));
        const swatch = add(badge, 'span', undefined, `inkstone-annotation-card-swatch inkstone-swatch-${record.kind === 'underline' ? 'underline' : record.color || 'default'}`);
        swatch.setAttribute('aria-hidden', 'true');
        add(badge, 'span', label);
        const index = add(meta, 'span', String(ordinal).padStart(2, '0'), 'inkstone-annotation-card-index');
        index.setAttribute('aria-label', t('第 {ordinal} 条标注', { ordinal }));
        add(card, 'blockquote', record.text, 'inkstone-annotation-card-text');
        if (record.note) {
          const thought = add(card, 'div', undefined, 'inkstone-annotation-card-thought');
          add(thought, 'span', labels.thought, 'inkstone-annotation-card-note-label');
          add(thought, 'p', record.note, 'inkstone-annotation-card-note');
        }
        const actions = add(card, 'div', undefined, 'inkstone-annotation-card-actions');
        for (const [index, method] of ['revealAnnotation', 'showSidebarAnnotationMenu', 'removeAnnotation'].entries()) {
          const action = add(actions, 'button', labels.actions[index]);
          action.setAttribute('type', 'button');
          if (method === 'removeAnnotation') action.className = 'inkstone-annotation-card-delete';
          if (method === 'showSidebarAnnotationMenu') action.setAttribute('aria-haspopup', 'dialog');
          const run = () => method === 'showSidebarAnnotationMenu'
            ? plugin.showSidebarAnnotationMenu(record.from, context, action)
            : plugin[method](record.from, context);
          action.addEventListener('click', () => this.perform(run));
        }
      }
      list.scrollTop = scrollTop;
    }
  };
}

module.exports = { VIEW_TYPE, createSidebarClass };
