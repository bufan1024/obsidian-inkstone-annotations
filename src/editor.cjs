'use strict';

function visibleAnnotations(records, selections, livePreview) {
  if (!livePreview) return [];
  return records.filter(record => !selections.some(selection => {
    const end = record.referenceTo ?? record.to;
    if (selection.from === selection.to) return selection.from >= record.from && selection.from <= end;
    return selection.from < end && selection.to > record.from;
  }));
}

function createEditorExtension(plugin) {
  const { editorInfoField, editorLivePreviewField, Notice } = require('obsidian');
  const { Prec, StateField } = require('@codemirror/state');
  const { Decoration, EditorView, WidgetType } = require('@codemirror/view');
  const t = (source, params = {}) => typeof plugin.t === 'function' ? plugin.t(source, params)
    : source.replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(params, key) ? String(params[key]) : placeholder);
  const parsedDocuments = new WeakMap();

  class AnnotationWidget extends WidgetType {
    constructor(record, context) {
      super();
      this.record = record;
      this.context = context;
    }

    eq(other) {
      return this.record.from === other.record.from && this.record.raw === other.record.raw &&
        this.record.note === other.record.note && this.context.view === other.context.view &&
        this.context.filePath === other.context.filePath && this.context.snapshot === other.context.snapshot;
    }

    get lineBreaks() { return (this.record.text.match(/\n/g) || []).length; }

    toDOM(view) {
      const record = this.record;
      const element = view.dom.ownerDocument.createElement(record.kind === 'underline' ? 'u' : 'mark');
      element.className = `inkstone-live-annotation ${record.kind === 'underline' ? 'inkstone-underline' : `inkstone-highlight inkstone-${record.color}`}`;
      element.textContent = record.text;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', t('编辑标注：{text}', { text: record.text }));
      element.tabIndex = 0;
      if (record.note) element.title = record.note;
      const edit = event => {
        event.preventDefault();
        event.stopPropagation();
        Promise.resolve().then(() => plugin.showAnnotationMenu(record.from, this.context, element, event.type === 'keydown'))
          .catch(error => new Notice(t(error.message || '未能打开标注，请重新选择。')));
      };
      element.addEventListener('mousedown', event => event.preventDefault());
      element.addEventListener('click', edit);
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') edit(event);
      });
      return element;
    }

    ignoreEvent() { return true; }
  }

  const build = state => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const info = state.field(editorInfoField, false);
    if (!info?.file?.path || !info.editor) return Decoration.none;
    let parsed = parsedDocuments.get(state.doc);
    if (!parsed) {
      const snapshot = state.doc.toString();
      parsed = { snapshot, records: plugin.recordsFor(snapshot, info.file.path) };
      parsedDocuments.set(state.doc, parsed);
    }
    const { snapshot, records } = parsed;
    const leaves = plugin.app.workspace.getLeavesOfType('markdown');
    const view = leaves.find(leaf => leaf.view.editor === info.editor)?.view;
    if (!view) return Decoration.none;
    const context = { view, filePath: info.file.path, snapshot, records };
    return Decoration.set(visibleAnnotations(records, state.selection.ranges, true).map(record =>
      Decoration.replace({ widget: new AnnotationWidget(record, context) }).range(record.from, record.to)
    ), true);
  };

  // Obsidian also replaces HTML in Live Preview; our editable widget must win overlaps.
  return Prec.highest(StateField.define({
    create: build,
    update: (_decorations, transaction) => build(transaction.state),
    provide: field => EditorView.decorations.from(field),
  }));
}

module.exports = { createEditorExtension, visibleAnnotations };
