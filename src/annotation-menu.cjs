const COLORS = [
  ['yellow', '黄色'],
  ['green', '绿色'],
  ['blue', '蓝色'],
  ['rose', '粉色'],
];

function createAnnotationMenu({ doc, record, onStyle, onSaveNote, onDelete, onClose, onCancel, onResize, bindSaveHotkey, startComposer = false, t = source => source, labelForRecord }) {
  const element = doc.createElement('div');
  element.className = 'inkstone-selection-toolbar inkstone-annotation-menu';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', t('标注操作'));
  const actions = doc.createElement('div');
  actions.className = 'inkstone-annotation-menu-content';
  const error = doc.createElement('p');
  error.className = 'inkstone-annotation-menu-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  element.append(actions, error);

  let discarded = false;
  let draft = record.note || '';
  let draftStyle = { kind: record.kind, color: record.color };
  let busy = false;
  let disposed = false;
  let composing = false;
  let focusFrame = null;
  let unbindSaveHotkey = null;
  const window = doc.defaultView;

  function clearSaveHotkey() {
    const cleanup = unbindSaveHotkey;
    unbindSaveHotkey = null;
    cleanup?.();
  }

  function cancelFocus() {
    if (focusFrame === null) return;
    window.cancelAnimationFrame(focusFrame);
    focusFrame = null;
  }

  function focusAfterMount(input) {
    cancelFocus();
    focusFrame = window.requestAnimationFrame(() => {
      focusFrame = null;
      if (!disposed && element.isConnected && input.isConnected) input.focus();
    });
  }

  function button(label, callback, className = '', literal = false) {
    const result = doc.createElement('button');
    result.type = 'button';
    result.className = `inkstone-toolbar-action ${className}`.trim();
    const caption = literal ? label : t(label);
    if (className.includes('inkstone-toolbar-style')) {
      const text = doc.createElement('span'); text.className = 'inkstone-style-label'; text.textContent = caption; result.append(text);
      result.title = caption;
    } else result.textContent = caption;
    result.setAttribute('aria-label', literal ? label : t(label));
    result.addEventListener('click', event => {
      event.stopPropagation();
      if (!busy && !disposed) callback();
    });
    return result;
  }

  function clearError() {
    error.textContent = '';
    error.hidden = true;
  }

  async function perform(callback) {
    if (busy || disposed) return;
    busy = true;
    clearError();
    element.setAttribute('aria-busy', 'true');
    element.querySelectorAll('button, textarea').forEach(control => { control.disabled = true; });
    try {
      await callback();
    } catch (failure) {
      if (!disposed) {
        error.textContent = t(failure?.message || '保存失败，请重试。');
        error.hidden = false;
        onResize?.();
      }
    } finally {
      busy = false;
      if (!disposed) {
        element.removeAttribute('aria-busy');
        element.querySelectorAll('button, textarea').forEach(control => { control.disabled = false; });
      }
    }
  }

  function styleChoices(currentStyle, choose) {
    const styles = doc.createElement('div');
    styles.className = 'inkstone-annotation-menu-styles';
    styles.setAttribute('role', 'group');
    styles.setAttribute('aria-label', t('标注样式'));
    const choices = [];
    for (const [color, label] of COLORS) {
      const option = { kind: 'highlight', color };
      const style = button(labelForRecord ? labelForRecord(option) : t(label), () => choose(option), 'inkstone-toolbar-style', true);
      const dot = doc.createElement('span');
      dot.className = `inkstone-toolbar-dot inkstone-swatch-${color}`;
      dot.setAttribute('aria-hidden', 'true');
      style.prepend(dot);
      styles.append(style);
      choices.push({ button: style, option });
    }
    const underlineOption = { kind: 'underline' };
    const underline = button('下划线', () => choose(underlineOption), 'inkstone-toolbar-style inkstone-toolbar-underline');
    styles.append(underline);
    choices.push({ button: underline, option: underlineOption });
    function update(nextStyle) {
      for (const choice of choices) {
        const selected = choice.option.kind === nextStyle.kind
          && (nextStyle.kind === 'underline' || choice.option.color === nextStyle.color);
        choice.button.setAttribute('aria-pressed', String(selected));
      }
    }
    update(currentStyle);
    return { element: styles, update };
  }

  function showActions() {
    composing = false;
    cancelFocus();
    clearSaveHotkey();
    actions.replaceChildren();
    clearError();
    const styles = styleChoices(record, option => perform(() => onStyle(option)));
    actions.append(styles.element);

    if (record.note) {
      const preview = doc.createElement('p');
      preview.className = 'inkstone-annotation-menu-note';
      preview.textContent = record.note;
      actions.append(preview);
    }
    const controls = doc.createElement('div');
    controls.className = 'inkstone-annotation-menu-actions';
    controls.append(
      button(record.note ? '编辑想法' : '写想法', showComposer),
      button('删除标注', () => perform(onDelete), 'inkstone-annotation-menu-delete'),
    );
    actions.append(controls);
  }

  function showComposer() {
    composing = true; discarded = false;
    clearSaveHotkey();
    actions.replaceChildren();
    clearError();
    const quote = doc.createElement('p');
    quote.className = 'inkstone-annotation-menu-quote';
    quote.textContent = record.text || '';
    const styles = styleChoices(draftStyle, option => {
      draftStyle = { kind: option.kind, color: option.color ?? null };
      styles.update(draftStyle);
    });
    const input = doc.createElement('textarea');
    input.className = 'inkstone-annotation-menu-input';
    input.setAttribute('aria-label', t('想法内容'));
    input.placeholder = t('写下你的想法…');
    input.value = draft;
    input.addEventListener('input', () => { draft = input.value; });
    const save = () => perform(() => onSaveNote(input.value, { ...draftStyle }));
    input.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.isComposing && !event.defaultPrevented) {
        event.preventDefault();
        save();
      }
    });
    const controls = doc.createElement('div');
    controls.className = 'inkstone-annotation-menu-actions inkstone-annotation-menu-composer-actions';
    controls.append(
      button('取消', () => {
        discarded = true; draft = input.value;
        if (startComposer) {
          cancelFocus();
          clearSaveHotkey();
          (onCancel || onClose)?.();
        } else {
          showActions();
          onResize?.();
        }
      }),
      button('保存想法', save),
    );
    actions.append(quote, styles.element, input, controls);
    const cleanup = bindSaveHotkey?.(save);
    if (typeof cleanup === 'function') unbindSaveHotkey = cleanup;
    onResize?.();
    focusAfterMount(input);
  }

  element.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      onClose?.();
    }
  });
  element.inkstoneDiscardDraft = () => { discarded = true; };
  element.inkstoneGetDraft = () => !discarded && element.inkstoneHasDraft() ? { note: draft, quote: record.text || '', ...draftStyle } : null;
  element.inkstoneDispose = () => {
    disposed = true;
    cancelFocus();
    clearSaveHotkey();
  };
  element.inkstoneHasDraft = () => !disposed && !discarded && composing && (busy
    || draft !== (record.note || '')
    || draftStyle.kind !== record.kind
    || (draftStyle.color ?? null) !== (record.color ?? null));
  if (startComposer) showComposer();
  else showActions();
  return element;
}

module.exports = { createAnnotationMenu };
