import { layoutError } from './semantics.js';

export const center = n => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
export function overlaps(a, b, margin = 0) {
  return a.x < b.x + b.width + margin && a.x + a.width + margin > b.x && a.y < b.y + b.height + margin && a.y + a.height + margin > b.y;
}
export function segmentHits(a, b, box) {
  const minimum = [box.x + 0.3, box.y + 0.3], maximum = [box.x + box.width - 0.3, box.y + box.height - 0.3];
  const start = [a.x, a.y], delta = [b.x - a.x, b.y - a.y];
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    if (Math.abs(delta[axis]) < 0.0001) { if (start[axis] <= minimum[axis] || start[axis] >= maximum[axis]) return false; }
    else {
      let p = (minimum[axis] - start[axis]) / delta[axis], q = (maximum[axis] - start[axis]) / delta[axis];
      if (p > q) [p, q] = [q, p]; lo = Math.max(lo, p); hi = Math.min(hi, q);
      if (hi <= lo) return false;
    }
  }
  return hi > lo && hi > 0 && lo < 1;
}
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function compact(points) {
  const result = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1), point) < 0.01) continue;
    while (result.length > 1) {
      const a = result.at(-2), b = result.at(-1);
      if ((a.x === b.x && b.x === point.x && (b.y - a.y) * (point.y - b.y) >= 0) || (a.y === b.y && b.y === point.y && (b.x - a.x) * (point.x - b.x) >= 0)) result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
function port(node, side, offset = 0) {
  const c = center(node), bound = Math.min(30, (['N','S'].includes(side) ? node.width : node.height) / 2 - 10), delta = Math.max(-bound, Math.min(bound, offset));
  let point;
  if (side === 'N' || side === 'S') {
    const x = c.x + delta;
    let half = node.height / 2 * (node.shape === 'diamond' ? 1 - Math.abs(delta) / (node.width / 2) : 1);
    if (node.shape !== 'diamond') { const radius=Math.min(node.shape==='round'?24:9,node.width/2,node.height/2); const corner=Math.max(0,Math.abs(delta)-(node.width/2-radius)); if(corner) half-=radius-Math.sqrt(Math.max(0,radius*radius-corner*corner)); }
    point = { x, y: c.y + (side === 'N' ? -half : half) };
  } else {
    const y = c.y + delta;
    let half = node.width / 2 * (node.shape === 'diamond' ? 1 - Math.abs(delta) / (node.height / 2) : 1);
    if (node.shape !== 'diamond') { const radius=Math.min(node.shape==='round'?24:9,node.width/2,node.height/2); const corner=Math.max(0,Math.abs(delta)-(node.height/2-radius)); if(corner) half-=radius-Math.sqrt(Math.max(0,radius*radius-corner*corner)); }
    point = { x: c.x + (side === 'W' ? -half : half), y };
  }
  const out = { x: point.x + (side === 'E' ? 24 : side === 'W' ? -24 : 0), y: point.y + (side === 'S' ? 24 : side === 'N' ? -24 : 0) };
  return { point, out };
}
const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
const clear = (points, nodes, source, target) => points.slice(1).every((p, i) => nodes.every(n => {
  // Shape ports can lie inside their rectangular bounding box. The first and
  // last segment alone may traverse that endpoint's empty rounded/diamond corner.
  if (((i === 0 && n.id === source) || (i === points.length - 2 && n.id === target))) return true;
  return !segmentHits(points[i], p, n);
}));

// Small visibility grid used only when the inexpensive orthogonal candidates
// are obstructed. States are discovered lazily rather than allocating N² cells.
function gridRoute(start, end, nodes) {
  const xs = [...new Set([start.x, end.x, ...nodes.flatMap(n => [n.x - 24, n.x + n.width + 24])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...nodes.flatMap(n => [n.y - 24, n.y + n.height + 24])])].sort((a, b) => a - b);
  const endX = xs.indexOf(end.x), endY = ys.indexOf(end.y), key = (x, y) => x + ',' + y;
  const initial = { x: xs.indexOf(start.x), y: ys.indexOf(start.y), g: 0, f: distance(start, end), direction: -1, parent: null };
  const heap = [];
  const push = state => { heap.push(state); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= state.f) break; heap[i] = heap[p]; i = p; } heap[i] = state; };
  const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (2 * i + 1 < heap.length) { let j = 2 * i + 1; if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++; if (heap[j].f >= last.f) break; heap[i] = heap[j]; i = j; } heap[i] = last; } return first; };
  const best = new Map([[key(initial.x, initial.y), 0]]); push(initial);
  let iterations = 0;
  while (heap.length && iterations++ < 60000) {
    const state = pop();
    if (state.g !== best.get(key(state.x, state.y))) continue;
    if (state.x === endX && state.y === endY) {
      const points = []; for (let p = state; p; p = p.parent) points.push({ x: xs[p.x], y: ys[p.y] });
      return compact(points.reverse());
    }
    for (const [dx, dy, direction] of [[-1, 0, 0], [1, 0, 0], [0, -1, 1], [0, 1, 1]]) {
      const x = state.x + dx, y = state.y + dy;
      if (x < 0 || x >= xs.length || y < 0 || y >= ys.length) continue;
      const a = { x: xs[state.x], y: ys[state.y] }, b = { x: xs[x], y: ys[y] };
      if (nodes.some(n => segmentHits(a, b, n))) continue;
      const g = state.g + distance(a, b) + (state.direction !== direction && state.direction !== -1 ? 20 : 0);
      const k = key(x, y); if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g); push({ x, y, g, f: g + distance(b, end), direction, parent: state });
    }
  }
  return null;
}

function route(edge, nodes, model, parallel, returnIndex, existing) {
  const source = nodes.find(n => n.id === edge.source), target = nodes.find(n => n.id === edge.target);
  const minX = Math.min(...nodes.map(n => n.x)), maxX = Math.max(...nodes.map(n => n.x + n.width));
  const minY = Math.min(...nodes.map(n => n.y)), maxY = Math.max(...nodes.map(n => n.y + n.height));
  if (source.id === target.id) {
    for (const gap of [72, 112, 152]) {
      const c = center(source);
      for (const [horizontal, vertical] of [['E','N'],['W','N'],['E','S'],['W','S']]) {
        const a=port(source,horizontal).point, b=port(target,vertical).point;
        const x=horizontal==='E' ? source.x+source.width+gap : source.x-gap;
        const y=vertical==='N' ? source.y-gap : source.y+source.height+gap;
        const points=[a,{x,y:a.y},{x,y},{x:b.x,y},b];
        if (clear(points,nodes,source.id,target.id)) return points;
      }
    }
  }
  const forward = ['forward', 'branch'].includes(edge.role) && model.profile !== 'fishbone';
  const pairs = forward ? (model.orientation === 'TD' ? [['S', 'N']] : [['E', 'W']]) : [['E', 'W'], ['W', 'E'], ['S', 'N'], ['N', 'S'], ['E', 'E'], ['W', 'W'], ['N', 'N'], ['S', 'S']];
  if (edge.source === edge.target) pairs.unshift(['E', 'N']);
  if (model.profile === 'fishbone' && model.fishboneRoots && (model.fishboneRoots.has(source.id) || model.fishboneRoots.has(target.id))) {
    const root = model.fishboneRoots.has(source.id) ? source : target, cause = root === source ? target : source;
    const r = center(root), c = center(cause);
    const toward = model.orientation === 'LR' ? (c.y < r.y ? 'S' : 'N') : (c.x < r.x ? 'E' : 'W');
    const a = port(cause, toward).point, b = port(root, model.orientation === 'LR' ? 'W' : 'N').point;
    const joint = model.orientation === 'LR' ? {x:c.x + 78,y:r.y} : {x:r.x,y:c.y + 78};
    const points = root === target ? [a,joint,b] : [b,joint,a];
    if (clear(points, nodes, source.id, target.id)) return points;
  }
  const candidates = [];
  const add = points => {
    points = compact(points);
    if (points.length < 2 || !clear(points, nodes, source.id, target.id)) return;
    candidates.push(points);
  };
  for (const [a, b] of pairs) {
    const s = port(source, a, parallel), t = port(target, b, parallel);
    const midX = (s.out.x + t.out.x) / 2, midY = (s.out.y + t.out.y) / 2;
    if (edge.role !== 'retry' && edge.source !== edge.target) {
      add([s.point, s.out, { x: s.out.x, y: midY }, { x: t.out.x, y: midY }, t.out, t.point]);
      add([s.point, s.out, { x: midX, y: s.out.y }, { x: midX, y: t.out.y }, t.out, t.point]);
    }
    const outside = 46 + returnIndex * 19;
    const xs = edge.role === 'retry' ? [minX - outside, maxX + outside] : [midX, minX - 38, maxX + 38, ...nodes.flatMap(n => [n.x - 24, n.x + n.width + 24])];
    const ys = edge.role === 'retry' ? [...(source.rank === target.rank ? [Math.min(source.y, target.y) - 32, Math.max(source.y + source.height, target.y + target.height) + 32] : []), minY - outside, maxY + outside] : [midY, minY - 38, maxY + 38, ...nodes.flatMap(n => [n.y - 24, n.y + n.height + 24])];
    for (const x of xs) add([s.point, s.out, { x, y: s.out.y }, { x, y: t.out.y }, t.out, t.point]);
    for (const y of ys) add([s.point, s.out, { x: s.out.x, y }, { x: t.out.x, y }, t.out, t.point]);
    if (edge.role === 'retry' || edge.source === edge.target) {
      for (const x of xs) for (const sy of [source.y - 24, source.y + source.height + 24]) for (const ty of [target.y - 24, target.y + target.height + 24]) {
        add([s.point, s.out, { x: s.out.x, y: sy }, { x, y: sy }, { x, y: ty }, { x: t.out.x, y: ty }, t.out, t.point]);
      }
    }
  }
  const score = points => {
    let crossings = 0;
    for (const other of existing) {
      if ([other.source,other.target].some(id => id === edge.source || id === edge.target)) continue;
      for (let i=1;i<points.length;i++) for (let j=1;j<other.points.length;j++) {
        const a=points[i-1],b=points[i],c=other.points[j-1],d=other.points[j];
        const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
        if (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) crossings++;
      }
    }
    return pathLength(points)+points.length*12+crossings*240;
  };
  if (candidates.length) return candidates.sort((a, b) => score(a) - score(b))[0];
  for (const [a, b] of pairs) {
    const s = port(source, a, parallel), t = port(target, b, parallel), middle = gridRoute(s.out, t.out, nodes);
    if (!middle) continue;
    const points = compact([s.point, ...middle, t.point]);
    if (clear(points, nodes, source.id, target.id)) return points;
  }
  layoutError('no unobstructed edge route within the rendering budget', [source.id, target.id], [edge.id]);
}

function labelFor(edge, points, nodes, existing, font, warnings) {
  const label = font.supported(edge.kind + (edge.order === undefined ? '' : ` · ${edge.order}`));
  if (label.missing.length) warnings.push({ code: 'MISSING_GLYPH', message: 'An edge label contains unsupported glyphs: ' + label.missing.join(', '), nodeIds: [], edgeIds: [edge.id] });
  const lines = font.wrap(label.text, 160, 11), width = Math.max(...lines.map(l => font.width(l, 11)), 15) + 12, height = lines.length * font.lineHeight(11) + 8;
  const candidates = [];
  const segments = Array.from({length:points.length - 1}, (_, i) => i + 1);
  if (edge.role === 'branch') segments.reverse();
  for (const i of segments) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    if (length < 24) continue;
    for (const fraction of edge.role === 'branch' ? [0.75, 0.5, 0.25] : [0.5, 0.25, 0.75]) {
      const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
      if (a.y === b.y) for (const side of [-1, 1]) candidates.push({ x: x - width / 2, y: y + (side < 0 ? -height - 5 : 5), width, height, lines });
      else for (const side of [1, -1]) candidates.push({ x: x + (side < 0 ? -width - 7 : 7), y: y - height / 2, width, height, lines });
    }
  }
  const available = candidates.find(box => nodes.every(n => !overlaps(box, n, 6)) && existing.every(other => !overlaps(box, other, 4)));
  if (available) return available;
  // Search along the actual route in smaller steps, still never covering nodes
  // or another label. Dense graphs fail visibly instead of hiding their labels.
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b);
    for (let step = 12; step < length - 12; step += 16) for (const offset of [12, -12, 32, -32, 64, -64]) {
      const x = a.x + (b.x - a.x) * step / length, y = a.y + (b.y - a.y) * step / length;
      const box = a.y === b.y ? { x: x - width / 2, y: y + offset - height / 2, width, height, lines } : { x: x + offset - width / 2, y: y - height / 2, width, height, lines };
      if (nodes.every(n => !overlaps(box, n, 6)) && existing.every(other => !overlaps(box, other, 4))) return box;
    }
  }
  layoutError('edge labels cannot be placed without overlap', [], [edge.id]);
}

export function routeEdges(model, nodes, font) {
  const result = [], labels = [], pairs = new Map();
  const order = [...model.edges].sort((a, b) => Number(['error', 'retry', 'cross', 'cycle'].includes(a.role)) - Number(['error', 'retry', 'cross', 'cycle'].includes(b.role)) || (nodes.find(n => n.id === a.source).rank ?? 0) - (nodes.find(n => n.id === b.source).rank ?? 0) || model.edges.indexOf(a) - model.edges.indexOf(b));
  let returns = 0;
  for (const edge of order) {
    const key = edge.source + '\0' + edge.target;
    const siblings = model.edges.filter(e => e.source === edge.source && e.target === edge.target).length;
    const index = pairs.get(key) ?? 0; pairs.set(key, index + 1);
    const groupObstacles = (model.groups ?? []).filter(g => g.kind === 'cycle' && !g.nodeIds.includes(edge.source) && !g.nodeIds.includes(edge.target)).map(g => {
      const members = nodes.filter(n => g.nodeIds.includes(n.id));
      const x=Math.min(...members.map(n => n.x))-24,y=Math.min(...members.map(n => n.y))-24;
      return {id:'@'+g.id,shape:'rect',x,y,width:Math.max(...members.map(n => n.x+n.width))-x+24,height:Math.max(...members.map(n => n.y+n.height))-y+24};
    });
    const obstacles=[...nodes,...groupObstacles];
    const points = route(edge, obstacles, model, (index - (siblings - 1) / 2) * 12, edge.role === 'retry' ? returns++ : 0, result);
    const label = labelFor(edge, points, obstacles, labels, font, model.warnings); labels.push(label);
    result.push({ id: edge.id, source: edge.source, target: edge.target, kind: edge.kind, role: edge.role ?? 'cross', points, label });
  }
  return result;
}
