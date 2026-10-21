'use strict';

const VIEW_TYPE = 'inkstone-annotations-list';
const FILTERS = [['all', '全部标注'], ['yellow', '黄色高亮'], ['green', '绿色高亮'], ['blue', '蓝色高亮'], ['rose', '粉色高亮'], ['underline', '下划线']];

function createSidebarClass(plugin) {
  const { ItemView, Notice } = require('obsidian');
  return class AnnotationSidebar extends ItemView {
    constructor(leaf) {
      super(leaf);
      this.filter = 'all';
      this.events = [];
      this.opened = false;
      this.nonMarkdownActive = false;
      this.listEl = null;
      this.renderedFilePath = null;
      this.renderedFilter = null;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return '当前笔记标注'; }
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
      this.listEl = null;
      this.renderedFilePath = null;
      this.renderedFilter = null;
    }

    async perform(action) {
      try { await action(); }
      catch (error) { new Notice(error.message || '未能操作标注，请重新打开当前笔记。'); }
    }

    render() {
      if (!this.opened) return;
      const context = this.nonMarkdownActive ? null : plugin.getAnnotationContext();
      const records = context?.records || [];
      const filtered = records.filter(record => this.filter === 'all' ||
        (this.filter === 'underline' ? record.kind === 'underline' : record.kind === 'highlight' && record.color === this.filter));
      const content = this.contentEl;
      const filePath = context?.filePath || null;
      const scrollTop = this.renderedFilePath === filePath && this.renderedFilter === this.filter ? this.listEl?.scrollTop || 0 : 0;
      content.replaceChildren();
      this.renderedFilePath = filePath;
      this.renderedFilter = this.filter;
      const add = (parent, tag, text, className) => {
        const element = content.ownerDocument.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        parent.append(element);
        return element;
      };
      const header = add(content, 'header', undefined, 'inkstone-annotation-sidebar-header');
      const heading = add(header, 'div', undefined, 'inkstone-annotation-sidebar-heading');
      add(heading, 'h2', '当前笔记标注');
      const status = add(heading, 'p', `${filtered.length} / ${records.length} 条标注`, 'inkstone-annotation-sidebar-count');
      status.setAttribute('aria-live', 'polite');
      const source = add(header, 'div', undefined, 'inkstone-annotation-sidebar-source');
      if (context) {
        const parts = context.filePath.split('/');
        const file = parts.pop();
        source.setAttribute('title', context.filePath);
        source.setAttribute('aria-label', `当前笔记：${context.filePath}`);
        add(source, 'p', file.replace(/\.md$/i, '') || file, 'inkstone-annotation-sidebar-source-name');
        add(source, 'p', parts.join(' / ') || '笔记库根目录', 'inkstone-annotation-sidebar-source-folder');
      } else {
        add(source, 'p', '选择一篇笔记', 'inkstone-annotation-sidebar-source-name');
        add(source, 'p', '打开一篇 Markdown 笔记后查看标注。', 'inkstone-annotation-sidebar-source-folder');
      }
      const toolbar = add(header, 'div', undefined, 'inkstone-annotation-sidebar-toolbar');
      const filter = add(toolbar, 'select');
      filter.setAttribute('aria-label', '筛选标注颜色');
      for (const [value, label] of FILTERS) {
        const option = add(filter, 'option', label);
        option.value = value;
      }
      filter.value = this.filter;
      filter.disabled = !context;
      filter.addEventListener('change', () => { this.filter = filter.value; this.render(); });
      const exportButton = add(toolbar, 'button', '导出摘录');
      exportButton.setAttribute('type', 'button');
      exportButton.disabled = records.length === 0;
      exportButton.addEventListener('click', () => this.perform(() => plugin.exportAnnotations()));
      const list = add(content, 'div', undefined, 'inkstone-annotation-sidebar-list');
      this.listEl = list;
      if (!context || filtered.length === 0) {
        add(list, 'p', !context ? '暂无当前笔记。' : records.length ? '没有符合筛选条件的标注。' : '当前笔记暂无标注。', 'inkstone-annotation-sidebar-empty');
        return;
      }
      for (const record of filtered) {
        const card = add(list, 'article', undefined, 'inkstone-annotation-card');
        card.setAttribute('data-kind', record.kind);
        card.setAttribute('data-color', record.color || '');
        const meta = add(card, 'div', undefined, 'inkstone-annotation-card-meta');
        const label = record.kind === 'underline' ? '下划线' : FILTERS.find(([value]) => value === record.color)?.[1] || '高亮';
        const badge = add(meta, 'span', undefined, `inkstone-annotation-card-kind inkstone-annotation-kind-${record.kind === 'underline' ? 'underline' : record.color || 'default'}`);
        badge.setAttribute('aria-label', `标注样式：${label}`);
        const swatch = add(badge, 'span', undefined, `inkstone-annotation-card-swatch inkstone-swatch-${record.kind === 'underline' ? 'underline' : record.color || 'default'}`);
        swatch.setAttribute('aria-hidden', 'true');
        add(badge, 'span', label);
        const ordinal = records.indexOf(record) + 1;
        const index = add(meta, 'span', String(ordinal).padStart(2, '0'), 'inkstone-annotation-card-index');
        index.setAttribute('aria-label', `第 ${ordinal} 条标注`);
        add(card, 'blockquote', record.text, 'inkstone-annotation-card-text');
        if (record.note) {
          const thought = add(card, 'div', undefined, 'inkstone-annotation-card-thought');
          add(thought, 'span', '想法', 'inkstone-annotation-card-note-label');
          add(thought, 'p', record.note, 'inkstone-annotation-card-note');
        }
        const actions = add(card, 'div', undefined, 'inkstone-annotation-card-actions');
        for (const [title, method] of [['定位原文', 'revealAnnotation'], ['编辑', 'showSidebarAnnotationMenu'], ['删除', 'removeAnnotation']]) {
          const action = add(actions, 'button', title);
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
