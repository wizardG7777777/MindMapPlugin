import { byMeaning, components, flowStructure, layoutError } from './semantics.js';

function axes(node, orientation) {
  return orientation === 'TD' ? { depth: node.height, breadth: node.width } : { depth: node.width, breadth: node.height };
}
function place(node, breadth, depth, orientation) {
  node.x = (orientation === 'TD' ? breadth : depth) - node.width / 2;
  node.y = (orientation === 'TD' ? depth : breadth) - node.height / 2;
}
function spacing(nodes, orientation) {
  return {
    depth: Math.max(60, ...nodes.map(n => axes(n, orientation).depth)) + 104,
    breadth: Math.max(orientation === 'TD' ? 160 : 54, ...nodes.map(n => axes(n, orientation).breadth)) + 100,
  };
}
function ranked(ids, edges, equalGroups = []) {
  const parent = new Map(ids.map(id => [id, id]));
  const find = id => { let p = id; while (parent.get(p) !== p) p = parent.get(p); return p; };
  for (const group of equalGroups) for (const id of group.slice(1)) parent.set(find(id), find(group[0]));
  const sets = new Map();
  for (const id of ids) { const root = find(id); if (!sets.has(root)) sets.set(root, []); sets.get(root).push(id); }
  const incoming = new Map([...sets.keys()].map(id => [id, 0]));
  const next = new Map([...sets.keys()].map(id => [id, new Set()]));
  for (const edge of edges) {
    const a = find(edge.source), b = find(edge.target);
    if (a === b) layoutError('same-layer constraints contradict a forward edge', [edge.source, edge.target], [edge.id]);
    if (!next.get(a).has(b)) { next.get(a).add(b); incoming.set(b, incoming.get(b) + 1); }
  }
  const queue = [...sets.keys()].filter(id => incoming.get(id) === 0), values = new Map(queue.map(id => [id, 0]));
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i])) {
    values.set(id, Math.max(values.get(id) ?? 0, values.get(queue[i]) + 1));
    incoming.set(id, incoming.get(id) - 1); if (incoming.get(id) === 0) queue.push(id);
  }
  if (queue.length !== sets.size) layoutError('incompatible branch layers or cyclic forward constraints');
  return new Map(ids.map(id => [id, values.get(find(id))]));
}

export function flowchart(model, nodes) {
  const structure = flowStructure(model);
  // Roles may have been inferred by flowStructure after measurement. Shape
  // inference only changes action terminals to equally sized rounded boxes.
  for (const n of nodes) { n.role = model.nodeMap.get(n.id).role; if (n.role === 'end') n.shape = 'round'; }
  const main = nodes.filter(n => n.role !== 'error');
  const constraints = structure.groups.map(group => ({nodeIds:group.nodeIds,reason:'alternative entries'}));
  let ranks = ranked(main.map(n => n.id), structure.primary, constraints.map(c => c.nodeIds));
  for (const group of structure.groups) if (group.mergeNodeId) {
    const branchNodes = new Set(group.branches.flat());
    const tails = [...new Set(structure.primary.filter(e => e.target === group.mergeNodeId && branchNodes.has(e.source)).map(e => e.source))];
    if (tails.length > 1) {
      const candidate = {nodeIds:tails,reason:'alternative completion before merge'};
      try {
        const aligned = ranked(main.map(n => n.id), structure.primary, [...constraints, candidate].map(c => c.nodeIds));
        constraints.push(candidate); ranks = aligned;
      } catch (error) {
        if (error.code !== 'INVALID_LAYOUT') throw error;
        // A one-step branch cannot put the same node on both the entrance and
        // completion layer. Keep the entrance aligned and extend its connector.
      }
    }
  }
  if (model.entry && ranks.get(model.entry) !== 0) layoutError('flow entry has a forward predecessor; choose its true start or describe a retry', [model.entry]);
  const size = spacing(nodes, model.orientation);
  size.breadth -= 36;
  const rankSizes = new Map();
  for (const n of main) rankSizes.set(ranks.get(n.id), Math.max(rankSizes.get(ranks.get(n.id)) ?? 0, axes(n, model.orientation).depth));
  const depths = new Map();
  for (let rank = 0; rank <= Math.max(0, ...ranks.values()); rank++) depths.set(rank, rank === 0 ? 0 : depths.get(rank - 1) + (rankSizes.get(rank - 1) ?? 54) / 2 + 80 + (rankSizes.get(rank) ?? 54) / 2);
  const lanes = new Map(main.map(n => [n.id, 0]));
  // Process outer choices before nested ones; reserve a fixed lane for each
  // branch so a missing intermediate step cannot pull its entrance downward.
  const groups = [...structure.groups].sort((a, b) => ranks.get(a.entryNodeId) - ranks.get(b.entryNodeId));
  const branchWidths = new Map();
  for (const group of [...groups].reverse()) {
    const widths = group.branches.map(branch => Math.max(1, ...groups.filter(other => other !== group && branch.includes(other.entryNodeId)).map(other => branchWidths.get(other.id)?.reduce((a, b) => a + b, 0) ?? 1)));
    branchWidths.set(group.id, widths);
  }
  for (const group of groups) {
    const center = lanes.get(group.entryNodeId), widths = branchWidths.get(group.id);
    let cursor = center - widths.reduce((a, b) => a + b, 0) / 2;
    group.branches.forEach((branch, i) => {
      const lane = cursor + widths[i] / 2; cursor += widths[i];
      for (const id of branch) if (group.branches.filter(set => set.includes(id)).length === 1) lanes.set(id, lane);
    });
    if (group.mergeNodeId) lanes.set(group.mergeNodeId, center);
  }
  const occupancy = new Map();
  // Stable semantic order is used only for otherwise unconstrained peers.
  for (const node of main) {
    const rank = ranks.get(node.id); let lane = lanes.get(node.id);
    const key = rank + ':' + lane;
    if (occupancy.has(key)) {
      let step = 1;
      while (occupancy.has(rank + ':' + (lane + step))) step++;
      lane += step;
    }
    occupancy.set(rank + ':' + lane, node.id); lanes.set(node.id, lane);
    node.rank = rank; place(node, lane * size.breadth, depths.get(rank), model.orientation);
  }
  const lowest = Math.min(0, ...lanes.values()), highest = Math.max(0, ...lanes.values());
  const errorOccupancy = new Set();
  for (const node of nodes.filter(n => n.role === 'error')) {
    const sources = model.edges.filter(e => e.target === node.id && e.role === 'error').map(e => e.source);
    const anchorRank = Math.max(0, ...sources.map(id => ranks.get(id) ?? 0));
    const anchorLane = sources.length ? sources.reduce((n, id) => n + (lanes.get(id) ?? 0), 0) / sources.length : 0;
    const left = anchorLane < 0;
    let lane = left ? lowest - 1 : highest + 1;
    if (errorOccupancy.has(anchorRank + ':' + lane)) lane = left ? highest + 1 : lowest - 1;
    while (errorOccupancy.has(anchorRank + ':' + lane)) lane += lane < 0 ? -1 : 1;
    errorOccupancy.add(anchorRank + ':' + lane);
    node.rank = anchorRank; place(node, lane * size.breadth, depths.get(anchorRank) ?? 0, model.orientation);
  }
  return {
    groups: structure.groups.map(({ branches, ...group }) => group),
    sameRank: constraints,
    primary: new Set(structure.primary.map(e => e.id)),
  };
}

function forest(model, undirected = false) {
  const next = new Map(model.nodes.map(n => [n.id, []]));
  const ordered = [...model.edges].sort((a, b) => Number(b.kind === 'contains') - Number(a.kind === 'contains') || model.edges.indexOf(a) - model.edges.indexOf(b));
  for (const e of ordered) {
    next.get(e.source).push({ node: e.target, edge: e });
    if (undirected) next.get(e.target).push({ node: e.source, edge: e });
  }
  const visited = new Set(), tree = new Map(model.nodes.map(n => [n.id, []])), roots = [], treeEdges = new Set();
  function visit(id) {
    visited.add(id);
    for (const target of next.get(id)) if (!visited.has(target.node)) {
      tree.get(id).push(target.node); treeEdges.add(target.edge.id); visit(target.node);
    }
  }
  const order = [...(model.entry ? [model.entry] : []), ...model.nodes.map(n => n.id)];
  for (const id of order) if (!visited.has(id)) { roots.push(id); visit(id); }
  return { tree, roots, treeEdges };
}
export function mindmap(model, nodes) {
  const { tree, roots, treeEdges } = forest(model);
  const map = new Map(nodes.map(n => [n.id, n])), size = spacing(nodes, model.orientation);
  let leaf = 0;
  function visit(id, depth) {
    const children = tree.get(id); let breadth;
    if (!children.length) breadth = leaf++;
    else { const places = children.map(child => visit(child, depth + 1)); breadth = (places[0] + places.at(-1)) / 2; }
    const node = map.get(id); node.rank = depth;
    place(node, breadth * size.breadth, depth * size.depth, model.orientation); return breadth;
  }
  for (const root of roots) { visit(root, 0); leaf++; }
  for (const edge of model.edges) edge.role = treeEdges.has(edge.id) ? 'forward' : 'cross';
  return { groups: [], sameRank: [], primary: treeEdges };
}

export function dependency(model, nodes) {
  const sets = components(model.nodes, model.edges, true);
  const owner = new Map(sets.flatMap((set, i) => set.map(id => [id, String(i)])));
  const links = model.edges.filter(e => owner.get(e.source) !== owner.get(e.target)).map(e => ({ ...e, source: owner.get(e.source), target: owner.get(e.target) }));
  const levels = ranked(sets.map((_, i) => String(i)), links);
  const size = spacing(nodes, model.orientation), nodeMap = new Map(nodes.map(n => [n.id, n]));
  const rows = new Map();
  sets.forEach((set, i) => { const rank = levels.get(String(i)); if (!rows.has(rank)) rows.set(rank, []); rows.get(rank).push(...set); });
  for (const [rank, row] of rows) row.forEach((id, i) => { const node = nodeMap.get(id); node.rank = rank; place(node, (i - (row.length - 1) / 2) * size.breadth, rank * size.depth, model.orientation); });
  for (const edge of model.edges) edge.role = owner.get(edge.source) === owner.get(edge.target) ? 'cycle' : 'forward';
  return { groups: sets.filter(set => set.length > 1).map(set => ({ id: 'cycle-' + set[0], kind: 'cycle', nodeIds: set, entryNodeId: null, mergeNodeId: null })), sameRank: [], primary: new Set(model.edges.filter(e => e.role === 'forward').map(e => e.id)) };
}

export function network(model, nodes) {
  const groups = components(model.nodes, model.edges);
  const map = new Map(nodes.map(n => [n.id, n]));
  let offset = 0;
  for (const group of groups) {
    const count = group.length, radius = Math.max(160, count * 70);
    const points = new Map(group.map((id, i) => [id, { x: radius * Math.cos(2 * Math.PI * i / count), y: radius * Math.sin(2 * Math.PI * i / count) }]));
    const edges = model.edges.filter(e => points.has(e.source) && points.has(e.target));
    for (let iteration = 0; iteration < 180; iteration++) {
      const force = new Map(group.map(id => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a = points.get(group[i]), b = points.get(group[j]);
        const dx = a.x - b.x || 0.01, dy = a.y - b.y || 0.01, distance = Math.max(1, Math.hypot(dx, dy));
        const strength = 65000 / (distance * distance);
        force.get(group[i]).x += dx / distance * strength; force.get(group[i]).y += dy / distance * strength;
        force.get(group[j]).x -= dx / distance * strength; force.get(group[j]).y -= dy / distance * strength;
      }
      for (const edge of edges) {
        if (edge.source === edge.target) continue;
        const a = points.get(edge.source), b = points.get(edge.target), dx = b.x - a.x, dy = b.y - a.y;
        const distance = Math.max(1, Math.hypot(dx, dy)), strength = (distance - 310) * 0.025;
        force.get(edge.source).x += dx / distance * strength; force.get(edge.source).y += dy / distance * strength;
        force.get(edge.target).x -= dx / distance * strength; force.get(edge.target).y -= dy / distance * strength;
      }
      for (const id of group) { const f = force.get(id), p = points.get(id), cap = Math.max(0.2, 8 * (1 - iteration / 180)); p.x += Math.max(-cap, Math.min(cap, f.x)); p.y += Math.max(-cap, Math.min(cap, f.y)); }
    }
    if (model.orientation === 'TD') for (const p of points.values()) { const x=p.x; p.x=-p.y; p.y=x; }
    // Hard rectangle separation follows force placement; text measurements,
    // rather than point particles, determine the actual exclusion distance.
    for (let pass = 0; pass < 120; pass++) {
      let changed = false;
      for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
        const a = points.get(group[i]), b = points.get(group[j]), na = map.get(group[i]), nb = map.get(group[j]);
        const gapX = (na.width + nb.width) / 2 + 74 - Math.abs(a.x - b.x), gapY = (na.height + nb.height) / 2 + 74 - Math.abs(a.y - b.y);
        if (gapX <= 0 || gapY <= 0) continue;
        changed = true;
        if (gapX < gapY) { const shift = (gapX + 1) / 2 * (a.x <= b.x ? -1 : 1); a.x += shift; b.x -= shift; }
        else { const shift = (gapY + 1) / 2 * (a.y <= b.y ? -1 : 1); a.y += shift; b.y -= shift; }
      }
      if (!changed) break;
    }
    const horizontal=model.orientation==='LR';
    const minimum = Math.min(...group.map(id => horizontal ? points.get(id).x - map.get(id).width / 2 : points.get(id).y - map.get(id).height / 2));
    const maximum = Math.max(...group.map(id => horizontal ? points.get(id).x + map.get(id).width / 2 : points.get(id).y + map.get(id).height / 2));
    for (const id of group) { const node = map.get(id), p = points.get(id); node.x = p.x - node.width / 2 + (horizontal ? -minimum + offset : 0); node.y = p.y - node.height / 2 + (horizontal ? 0 : -minimum + offset); }
    offset += maximum - minimum + 160;
  }
  for (const edge of model.edges) edge.role = edge.source === edge.target ? 'cycle' : 'cross';
  return { groups: [], sameRank: [], primary: new Set() };
}

export function fishbone(model, nodes) {
  const { tree, roots, treeEdges } = forest(model, true);
  const map = new Map(nodes.map(n => [n.id, n])), size = spacing(nodes, model.orientation);
  let offset = 0;
  function breadth(id) { return Math.max(1, tree.get(id).reduce((sum, child) => sum + breadth(child), 0)); }
  for (const root of roots) {
    const branches = tree.get(root), total = branches.reduce((sum, id) => sum + breadth(id), 0);
    const end = (total + 1) * size.depth;
    place(map.get(root), offset, end, model.orientation); map.get(root).rank = 0;
    let column = 0;
    function placeBranch(id, depth, center, side) {
      const node = map.get(id); node.rank = depth;
      place(node, offset + side * depth * size.breadth, center - depth * 45, model.orientation);
      let childColumn = center - (breadth(id) - 1) * size.depth / 2;
      for (const child of tree.get(id)) { placeBranch(child, depth + 1, childColumn + (breadth(child) - 1) * size.depth / 2, side); childColumn += breadth(child) * size.depth; }
    }
    branches.forEach((id, i) => { const span = breadth(id); placeBranch(id, 1, (column + (span + 1) / 2) * size.depth, i % 2 ? 1 : -1); column += span; });
    offset += (Math.max(1, ...nodes.map(n => n.rank ?? 0)) * 2 + 2) * size.breadth;
  }
  for (const edge of model.edges) edge.role = treeEdges.has(edge.id) ? 'forward' : 'cross';
  return { groups: [], sameRank: [], primary: treeEdges, fishboneRoots: new Set(roots) };
}

export const strategies = { flowchart, mindmap, dependency, network, fishbone };
