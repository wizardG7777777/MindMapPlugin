import { fileURLToPath } from 'node:url';
import { fail } from '../errors.js';
let loaded;
const FONT_SIZE = 15;
export async function typography() {
  if (loaded) return loaded;
  try {
    const { openSync } = await import('fontkit');
    const font = openSync(fileURLToPath(new URL('../../assets/fonts/NotoSansCJKsc-Regular.otf', import.meta.url)));
    const runs = new Map();
    const run = text => {
      if (!runs.has(text)) { if (runs.size >= 2048) runs.delete(runs.keys().next().value); runs.set(text, font.layout(text)); }
      return runs.get(text);
    };
    const width = (text, size = FONT_SIZE) => run(text).advanceWidth * size / font.unitsPerEm;
    function supported(text) {
      const missing = new Set();
      const clean = [...text.replace(/[\r\n\t]/g, ' ')].map(char => {
        const point = char.codePointAt(0);
        if (font.hasGlyphForCodePoint(point)) return char;
        const code = 'U+' + point.toString(16).toUpperCase();
        missing.add(code); return '[' + code + ']';
      }).join('');
      return { text: clean, missing: [...missing] };
    }
    function wrap(text, maximum = 210, size = FONT_SIZE) {
      const lines = []; let line = '';
      for (const char of text) {
        if (line && width(line + char, size) > maximum) { lines.push(line.trimEnd()); line = ''; }
        line += char;
      }
      if (line || !lines.length) lines.push(line.trimEnd());
      return lines;
    }
    loaded = {
      font, run, width, supported, wrap, size: FONT_SIZE,
      lineHeight: size => (font.ascent - font.descent) / font.unitsPerEm * size + 2,
      ascent: size => font.ascent / font.unitsPerEm * size,
      identity: { family: 'Noto Sans CJK SC', version: '2.004', size: FONT_SIZE },
    };
    return loaded;
  } catch (error) {
    fail('IO_ERROR', 'The packaged rendering font could not be loaded: ' + error.message, { path: fileURLToPath(new URL('../../assets/fonts/NotoSansCJKsc-Regular.otf', import.meta.url)), phase: 'font', osCode: error.code ?? null });
  }
}

export function measureNodes(model, font) {
  return model.nodes.map(node => {
    const label = font.supported(node.title);
    if (label.missing.length) model.warnings.push({ code: 'MISSING_GLYPH', message: 'Unsupported characters are shown by code point: ' + label.missing.join(', '), nodeIds: [node.id], edgeIds: [] });
    const lines = font.wrap(label.text, node.role === 'decision' ? 145 : 210);
    const textWidth = Math.max(...lines.map(line => font.width(line)), 30);
    const textHeight = font.lineHeight(font.size) * lines.length;
    const shape = node.role === 'decision' ? 'diamond' : ['start', 'end'].includes(node.role) ? 'round' : 'rect';
    return {
      id: node.id, title: node.title, role: node.role, shape,
      width: shape === 'diamond' ? (textWidth + 28) * 2 : Math.max(160, textWidth + 38),
      height: shape === 'diamond' ? (textHeight + 12) * 2 : Math.max(54, textHeight + 26),
      x: 0, y: 0, rank: null, lines,
    };
  });
}
