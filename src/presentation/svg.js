import { createHash } from 'node:crypto';
import { limit } from '../errors.js';
import { typography } from './fonts.js';
import { renderLimits } from './contracts.js';

const xml = value => [...String(value)].map(c => { const n=c.codePointAt(0); return n===9 || n===10 || n===13 || (n>=32 && n<=0xD7FF) || (n>=0xE000 && n<=0xFFFD) || (n>=0x10000 && n<=0x10FFFF) ? c : '[U+'+n.toString(16).toUpperCase()+']'; }).join('').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const num = value => String(Math.round(value * 1000) / 1000);
const profiles = { flowchart: '控制流程图', mindmap: '思维导图', dependency: '依赖关系图', network: '关系网络图', fishbone: '鱼骨图' };
const colors = { forward: '#385E95', branch: '#385E95', error: '#B35342', retry: '#A77236', cross: '#756C9F', cycle: '#756C9F' };

export async function renderSvg(document, scene) {
  const font = await typography();
  const prefix = 'mm' + createHash('sha256').update(`${document.metadata.id}/${document.metadata.graphVersion}/${scene.profile}/${scene.orientation}`).digest('hex').slice(0, 10);
  const glyphs = new Map();
  function text(value, x, baseline, size, color, align = 'start') {
    const run = font.run(value), scale = size / font.font.unitsPerEm;
    let cursor = x - (align === 'middle' ? run.advanceWidth * scale / 2 : 0);
    let result = `<g fill="${color}" aria-hidden="true">`;
    run.glyphs.forEach((glyph, i) => {
      const position = run.positions[i];
      if (!glyphs.has(glyph.id)) glyphs.set(glyph.id, glyph.path.toSVG());
      result += `<use href="#${prefix}g${glyph.id}" transform="translate(${num(cursor + position.xOffset * scale)} ${num(baseline - position.yOffset * scale)}) scale(${num(scale)} ${num(-scale)})"/>`;
      cursor += position.xAdvance * scale;
    });
    return result + '</g>';
  }
  const elements = [];
  const titleLines = font.wrap(font.supported(document.metadata.title).text, Math.min(1100, scene.width - 96), 24);
  titleLines.forEach((line, i) => elements.push(text(line, 48, 28 + font.ascent(24) + i * font.lineHeight(24), 24, '#182A43')));
  const subtitleY = 28 + titleLines.length * font.lineHeight(24) + 17;
  elements.push(text(`${profiles[scene.profile]} · ${scene.orientation === 'TD' ? '从上到下' : '从左到右'}`, 49, subtitleY, 12, '#67788E'));
  const legend = [...new Set(scene.edges.map(e => ['forward', 'branch'].includes(e.role) ? 'forward' : e.role))];
  const legendNames = { forward: '主关系', error: '错误分支', retry: '返回 / 重试', cross: '交叉关系', cycle: '循环关系' };
  let legendX = 48;
  for (const role of legend) {
    elements.push(`<path d="M${num(legendX)} ${num(subtitleY + 25)}h24" fill="none" stroke="${colors[role]}" stroke-width="2"${['retry', 'cross', 'cycle'].includes(role) ? ' stroke-dasharray="5 4"' : ''}/>`);
    elements.push(text(legendNames[role], legendX + 32, subtitleY + 29, 11, '#67788E'));
    legendX += font.width(legendNames[role], 11) + 66;
  }
  for (const group of scene.groups.filter(g => g.kind === 'cycle')) {
    const nodes = scene.nodes.filter(n => group.nodeIds.includes(n.id));
    const x = Math.min(...nodes.map(n => n.x)) - 18, y = Math.min(...nodes.map(n => n.y)) - 18;
    const width = Math.max(...nodes.map(n => n.x + n.width)) - x + 18, height = Math.max(...nodes.map(n => n.y + n.height)) - y + 18;
    elements.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" rx="14" fill="#F6F4FA" stroke="#CBC5DF" stroke-dasharray="5 5"><title>循环依赖组</title></rect>`);
  }
  for (const edge of scene.edges) {
    const role = edge.role, color = colors[role];
    const path = edge.points.map((p, i) => `${i ? 'L' : 'M'}${num(p.x)} ${num(p.y)}`).join(' ');
    elements.push(`<g data-edge-id="${xml(edge.id)}" data-source="${xml(edge.source)}" data-target="${xml(edge.target)}" data-role="${role}"><title>${xml(edge.kind)}</title><path d="${path}" fill="none" stroke="${color}" stroke-width="${['forward', 'branch'].includes(role) ? 1.9 : 1.3}" stroke-linejoin="round" stroke-linecap="round"${['retry', 'cross', 'cycle'].includes(role) ? ' stroke-dasharray="6 5"' : ''} marker-end="url(#${prefix}-${role})"/></g>`);
  }
  for (const edge of scene.edges) {
    const box = edge.label;
    elements.push(`<g data-label-for="${xml(edge.id)}"><rect x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" rx="4" fill="#FFFFFF" fill-opacity="0.96"/>`);
    box.lines.forEach((line, i) => elements.push(text(line, box.x + box.width / 2, box.y + 4 + font.ascent(11) + i * font.lineHeight(11), 11, colors[edge.role], 'middle')));
    elements.push('</g>');
  }
  for (const node of scene.nodes) {
    const startEnd = ['start', 'end'].includes(node.role), error = node.role === 'error';
    const fill = error ? '#FFF3EE' : startEnd ? '#E9F5EF' : node.role === 'decision' ? '#EDF3FD' : '#FFFFFF';
    const stroke = error ? '#CE8E7B' : startEnd ? '#3F896F' : '#829ABC';
    elements.push(`<g data-node-id="${xml(node.id)}" data-role="${node.role}"${node.rank !== null ? ` data-rank="${node.rank}"` : ''} role="img" aria-label="${xml(node.title)}"><title>${xml(node.title)}</title>`);
    if (node.shape === 'diamond') {
      elements.push(`<path d="M${num(node.x + node.width / 2)} ${num(node.y)}L${num(node.x + node.width)} ${num(node.y + node.height / 2)}L${num(node.x + node.width / 2)} ${num(node.y + node.height)}L${num(node.x)} ${num(node.y + node.height / 2)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    } else elements.push(`<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.width)}" height="${num(node.height)}" rx="${node.shape === 'round' ? num(Math.min(24,node.height / 2)) : '9'}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
    const height = node.lines.length * font.lineHeight(font.size);
    node.lines.forEach((line, i) => elements.push(text(line, node.x + node.width / 2, node.y + (node.height - height) / 2 + font.ascent(font.size) + i * font.lineHeight(font.size), font.size, '#243750', 'middle')));
    elements.push('</g>');
  }
  if (!scene.nodes.length) elements.push(text('空图', scene.width / 2, 180, 16, '#67788E', 'middle'));
  const markers = Object.entries(colors).map(([role, color]) => `<marker id="${prefix}-${role}" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8Z" fill="${color}"/></marker>`).join('');
  const paths = [...glyphs].map(([id, path]) => `<path id="${prefix}g${id}" d="${path}"/>`).join('');
  const metadata = { documentId: document.metadata.id, graphVersion: document.metadata.graphVersion, layoutVersion: scene.layoutVersion, profile: scene.profile, orientation: scene.orientation, nodeCount: scene.nodes.length, edgeCount: scene.edges.length, warnings: scene.warnings };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(scene.width)}" height="${num(scene.height)}" viewBox="0 0 ${num(scene.width)} ${num(scene.height)}" role="img" aria-label="${xml(document.metadata.title)}"><title>${xml(document.metadata.title)}</title><desc>Self-contained diagram. Text uses measured Noto Sans CJK SC glyph outlines; no fonts, scripts or network resources are required.</desc><metadata>${xml(JSON.stringify(metadata))}</metadata><defs>${markers}${paths}</defs><rect width="100%" height="100%" fill="#FFFFFF"/>${elements.join('')}</svg>\n`;
  limit('svgBytes', renderLimits.svgBytes, Buffer.byteLength(svg));
  return svg;
}
