'use strict';

function escapeLiteral(value) {
  return String(value).replace(/[\\`*_{}\[\]()#+.!<>|~=$&-]/g, character => '\\' + character);
}

function inlineLiteral(value) {
  return escapeLiteral(value).replace(/\r\n|\r|\n/g, ' ');
}

function headingSections(headings) {
  const stack = [];
  return [...headings].sort((left, right) => left.position.start.offset - right.position.start.offset).map(heading => {
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    stack.push(heading);
    return { heading, from: heading.position.start.offset, path: stack.map(item => inlineLiteral(item.heading)).join(' › ') };
  });
}

function sectionAt(sections, offset) {
  let low = 0;
  let high = sections.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sections[middle].from <= offset) low = middle + 1;
    else high = middle;
  }
  return low ? sections[low - 1] : null;
}

function buildExcerptLines({ sourceName, records, sourceLink, generatedAt, headings = [], linkForHeading, labelForRecord, t }) {
  const translate = (source, params = {}) => {
    const message = typeof t === 'function' ? t(source) : source;
    return String(message ?? source).replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(params, key) ? params[key] : placeholder);
  };
  const source = translate('来源：{link}', { link: sourceLink });
  const lines = [`# ${inlineLiteral(sourceName)} · ${translate('墨读摘录')}`, '', source, translate('快照生成时间：{generatedAt}', { generatedAt }), ''];
  const sections = headingSections(headings);
  const colorLabels = { yellow: '黄色', green: '绿色', blue: '蓝色', rose: '粉色' };
  for (const [index, record] of records.entries()) {
    const defaultLabel = record.kind === 'underline' ? '下划线' : colorLabels[record.color] || '高亮';
    const label = labelForRecord ? labelForRecord(record) : translate(defaultLabel);
    const section = sectionAt(sections, record.from);
    const headingLink = section && linkForHeading ? linkForHeading(section.heading) : '';
    const location = section ? translate('位置：{path}{link}', { path: section.path, link: headingLink ? `（${headingLink}）` : '' }) : source;
    lines.push(`## ${index + 1}. ${inlineLiteral(label)}`, '', location, '', ...escapeLiteral(record.text).split(/\r\n|\r|\n/).map(line => `> ${line}`), '');
    if (record.note) lines.push(translate('备注：'), '', record.note, '');
  }
  return lines;
}

module.exports = { buildExcerptLines };
