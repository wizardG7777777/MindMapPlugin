import { fail, limit } from '../errors.js';
import { compare } from '../validation.js';
import { profiles, renderLimits, nodeRoles } from './contracts.js';

export function layoutError(reason, nodeIds = [], edgeIds = []) {
  fail('INVALID_LAYOUT', `Cannot lay out this graph: ${reason}.`, { reason, nodeIds, edgeIds });
}
export const byMeaning = (a, b) => compare(a.title, b.title) || compare(a.id, b.id);
export function chooseProfile(type, requested = 'auto') {
  if (requested !== 'auto') return requested;
  const value = type.toLowerCase();
  if (value === 'flowchart' || value === 'control-flow' || value.endsWith('-flowchart')) return 'flowchart';
  if (['mindmap', 'mind-map'].includes(value)) return 'mindmap';
  if (['dependency', 'dependency-graph'].includes(value)) return 'dependency';
  if (['fishbone', 'cause-effect'].includes(value)) return 'fishbone';
  return 'network';
}
export function prepare(document, args = {}) {
  const graph = document.graph;
  const profile = chooseProfile(graph.semanticType, args.layout);
  if (!profiles.includes(profile)) layoutError('unknown profile');
  const nodes = Object.values(graph.nodes).map(n => ({ ...n }));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edges = Object.values(graph.edges).map(e => ({ ...e }));
  limit('renderNodes', renderLimits.nodes, nodes.length);
  limit('renderEdges', renderLimits.edges, edges.length);
  const warnings = [];
  for (const node of nodes) {
    limit('renderTitleCodePoints', renderLimits.titleCodePoints, [...node.title].length, { nodeId: node.id });
    const flow = node.meta?.flow;
    if (profile === 'flowchart' && flow !== undefined) {
      if (!flow || typeof flow !== 'object' || Array.isArray(flow) || !nodeRoles.includes(flow.role) || Object.keys(flow).some(k => !['role', 'mergeNodeId'].includes(k))) layoutError('invalid node meta.flow', [node.id]);
      if (flow.mergeNodeId !== undefined && (flow.role !== 'decision' || !nodeMap.has(flow.mergeNodeId))) layoutError('invalid decision mergeNodeId', [node.id]);
    }
    node.role = profile === 'flowchart' && flow ? flow.role : 'action';
  }
  for (const edge of edges) {
    limit('renderEdgeLabelCodePoints', renderLimits.titleCodePoints, [...edge.kind].length, { edgeId: edge.id });
    const flow = edge.meta?.flow;
    if (profile === 'flowchart' && flow !== undefined && (!flow || typeof flow !== 'object' || Array.isArray(flow) || !['forward', 'branch', 'error', 'retry'].includes(flow.role) || Object.keys(flow).some(k => k !== 'role'))) layoutError('invalid edge meta.flow', [], [edge.id]);
    edge.role = profile === 'flowchart' ? flow?.role ?? null : null;
    if (profile === 'flowchart' && edge.role === 'error' && nodeMap.get(edge.target).role === 'action') nodeMap.get(edge.target).role = 'error';
  }
  nodes.sort(byMeaning);
  edges.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || compare(a.kind, b.kind) || byMeaning(nodeMap.get(a.target), nodeMap.get(b.target)) || compare(a.id, b.id));
  let entry = args.root ?? graph.entryNodeId;
  if (entry !== null && entry !== undefined && !nodeMap.has(entry)) fail('NOT_FOUND', 'Layout root is absent.', { kind: 'node', id: entry });
  if (!entry) entry = nodes.find(n => n.role === 'start')?.id ?? nodes.find(n => !edges.some(e => e.target === n.id && !['retry', 'error'].includes(e.role)))?.id ?? nodes[0]?.id ?? null;
  const orientation = args.orientation ?? (['flowchart', 'dependency'].includes(profile) ? 'TD' : 'LR');
  if (entry && nodeMap.get(entry).role === 'action') nodeMap.get(entry).role = 'start';
  return { document, nodes, nodeMap, edges, profile, orientation, entry, warnings };
}

export function reachable(start, outgoing, stop = null) {
  const result = new Set(), queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (result.has(id) || id === stop) continue;
    result.add(id);
    for (const edge of outgoing.get(id) ?? []) queue.push(edge.target);
  }
  return result;
}
export function adjacency(nodes, edges) {
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  for (const edge of edges) outgoing.get(edge.source).push(edge);
  return outgoing;
}

export function flowStructure(model) {
  const outgoing = adjacency(model.nodes, model.edges.filter(e => !['retry', 'error'].includes(e.role)));
  const visited = new Set(), active = new Set(), inferred = [];
  const visit = id => {
    if (visited.has(id)) return;
    visited.add(id); active.add(id);
    for (const edge of outgoing.get(id)) {
      if (active.has(edge.target)) {
        if (edge.role) layoutError('cyclic explicit forward flow; mark its return edge as retry', [], [edge.id]);
        edge.role = 'retry'; inferred.push(edge.id);
      } else {
        edge.role ??= 'forward'; visit(edge.target);
      }
    }
    active.delete(id);
  };
  if (model.entry) visit(model.entry);
  for (const node of model.nodes) visit(node.id);
  if (inferred.length) model.warnings.push({ code: 'INFERRED_RETRY_EDGES', message: 'Return edges were inferred from an entry-first traversal. Explicit meta.flow roles make the intended flow unambiguous.', nodeIds: [], edgeIds: inferred });
  const primary = model.edges.filter(e => ['forward', 'branch'].includes(e.role) && model.nodeMap.get(e.source).role !== 'error' && model.nodeMap.get(e.target).role !== 'error');
  const next = adjacency(model.nodes, primary);
  const groups = [];
  for (const node of model.nodes) {
    const outgoing = next.get(node.id);
    if (outgoing.length < 2 || (node.role !== 'decision' && !outgoing.every(e => e.role === 'branch'))) continue;
    const seeds = [...new Set(outgoing.map(e => e.target))];
    if (seeds.length < 2) continue;
    const sets = seeds.map(id => reachable(id, next));
    let merge = node.meta?.flow?.mergeNodeId ?? null;
    if (!merge) {
      const common = model.nodes.filter(n => sets.every(s => s.has(n.id)));
      // Select the earliest common successor, not an arbitrary ID or last sink.
      merge = common.find(n => !common.some(other => other.id !== n.id && reachable(other.id, next).has(n.id)))?.id ?? null;
    }
    if (merge && !sets.every(s => s.has(merge))) layoutError('declared merge is not reachable from every branch', [node.id, merge]);
    const branches = seeds.map(id => [...reachable(id, next, merge)]);
    // Cross-linked choice entrances cannot be forced onto one execution layer.
    if (sets.some((set, i) => seeds.some((id, j) => i !== j && set.has(id)))) layoutError('alternative entries contain an execution dependency', seeds);
    groups.push({ id: `alternatives-${node.id}`, kind: 'alternatives', nodeIds: seeds, entryNodeId: node.id, mergeNodeId: merge, branches });
  }
  for (const node of model.nodes) if (node.role === 'action' && next.get(node.id).length === 0 && !model.edges.some(e => e.source === node.id && e.role === 'retry')) node.role = 'end';
  return { primary, groups, next };
}

export function components(nodes, edges, directed = false) {
  const next = adjacency(nodes, edges);
  if (!directed) for (const e of edges) next.get(e.target).push({ target: e.source });
  if (!directed) {
    const remaining = new Set(nodes.map(n => n.id)), groups = [];
    for (const node of nodes) if (remaining.has(node.id)) {
      const group = [...reachable(node.id, next)];
      for (const id of group) remaining.delete(id);
      groups.push(group);
    }
    return groups;
  }
  let index = 0;
  const indices = new Map(), low = new Map(), stack = [], active = new Set(), groups = [];
  function visit(id) {
    indices.set(id, index); low.set(id, index++); stack.push(id); active.add(id);
    for (const e of next.get(id)) {
      if (!indices.has(e.target)) { visit(e.target); low.set(id, Math.min(low.get(id), low.get(e.target))); }
      else if (active.has(e.target)) low.set(id, Math.min(low.get(id), indices.get(e.target)));
    }
    if (low.get(id) === indices.get(id)) {
      const group = []; let current;
      do { current = stack.pop(); active.delete(current); group.push(current); } while (current !== id);
      groups.push(group.sort((a, b) => byMeaning(nodes.find(n => n.id === a), nodes.find(n => n.id === b))));
    }
  }
  for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
  return groups;
}
