import { projectMermaid } from './presentation/mermaid.js';
export { projectMermaid } from './presentation/mermaid.js';
import { fail, limit, argument } from './errors.js';
import { sorted, compare } from './validation.js';
import { queryDefaults } from './definitions.js';

function required(records,kind,id) {
  if (!Object.hasOwn(records,id)) fail('NOT_FOUND',`Unknown ${kind}: ${id}`,{kind,id});
  return records[id];
}
const fieldOrder = (a,b) => compare(a.nodeId,b.nodeId) || compare(a.field,b.field);
export function selectNode(node, content = 'card', maxTextBytes = 4096) {
  const result = { id: node.id }, fields = [];
  for (const field of ['title','cardContent','notes','meta']) {
    const value = node[field];
    const bytes = Buffer.byteLength(field === 'meta' ? JSON.stringify(value) : value);
    const selected = field === 'title' || content === 'all' || (content === 'card' && field === 'cardContent');
    if (!selected) { fields.push({ nodeId: node.id, field, reason:'not_requested', omittedBytes: bytes }); continue; }
    if (field === 'meta' || maxTextBytes === 0 || bytes <= maxTextBytes) result[field] = value;
    else {
      // Back up from the first excluded continuation byte to avoid half a code point.
      const buffer = Buffer.from(value);
      let end = maxTextBytes;
      while (end > 0 && (buffer[end] & 0xc0) === 0x80) end--;
      result[field] = buffer.subarray(0,end).toString('utf8');
      fields.push({ nodeId:node.id, field, reason:'text_limit', omittedBytes:bytes - end });
    }
  }
  return { node: result, omissions: { fields: fields.sort(fieldOrder) } };
}
export function readNode(document,args) { return selectNode(required(document.graph.nodes,'node',args.id),args.content,args.maxTextBytes); }
export function context(document,args,neighbors = false) {
  const graph = document.graph, mode = neighbors ? 'neighbors' : args.all ? 'all' : 'ids';
  const nodeIds = neighbors ? [args.id] : args.nodes ?? [], edgeIds = args.edges ?? [];
  const direction = mode === 'all' ? null : args.direction ?? 'outgoing', depth = mode === 'all' ? null : neighbors ? 1 : args.depth ?? 0;
  const kinds = args.kinds ?? null, allowedKinds = kinds ? new Set(kinds) : null;
  const limits = Object.fromEntries(Object.entries(queryDefaults).map(([key,value]) => [key,args[key] ?? value]));
  const seeds = new Set(nodeIds);
  for (const id of nodeIds) required(graph.nodes,'node',id);
  for (const id of edgeIds) {
    const edge = required(graph.edges,'edge',id);
    if (allowedKinds && !allowedKinds.has(edge.kind)) argument('--edges','selected edge excluded by --kinds');
    seeds.add(edge.source); seeds.add(edge.target);
  }
  limit('maxNodes',limits.maxNodes,seeds.size,{requiredMinimum:seeds.size});
  limit('maxEdges',limits.maxEdges,edgeIds.length,{requiredMinimum:edgeIds.length});
  const matching = Object.values(graph.edges).filter(e => !allowedKinds || allowedKinds.has(e.kind)).sort((a,b) => compare(a.id,b.id));
  let candidates;
  if (mode === 'all') candidates = sorted(Object.keys(graph.nodes));
  else {
    const adjacency = new Map();
    const add = (from,to) => { if (!adjacency.has(from)) adjacency.set(from,[]); adjacency.get(from).push(to); };
    for (const edge of matching) {
      if (direction !== 'incoming') add(edge.source,edge.target);
      if (direction !== 'outgoing') add(edge.target,edge.source);
    }
    let frontier = sorted(seeds); const seen = new Set(frontier); candidates = [...frontier];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next = new Set();
      for (const id of frontier) for (const target of adjacency.get(id) ?? []) if (!seen.has(target)) { seen.add(target); next.add(target); }
      frontier = sorted(next); candidates.push(...frontier);
    }
  }
  const chosenIds = new Set(candidates.slice(0,limits.maxNodes));
  const internal = [], boundaries = [];
  for (const edge of matching) {
    const source = chosenIds.has(edge.source), target = chosenIds.has(edge.target);
    if (source && target) internal.push(edge);
    else if (source || target) boundaries.push({ id:edge.id, source:edge.source, target:edge.target, kind:edge.kind });
  }
  const explicit = new Set(edgeIds);
  const chosenEdges = [...internal.filter(e => explicit.has(e.id)),...internal.filter(e => !explicit.has(e.id))].slice(0,limits.maxEdges).sort((a,b) => compare(a.id,b.id));
  const nodes = [], fields = [];
  for (const id of sorted(chosenIds)) { const selected = selectNode(graph.nodes[id],args.content,args.maxTextBytes); nodes.push(selected.node); fields.push(...selected.omissions.fields); }
  return { scope: { mode, nodeIds, edgeIds, direction, depth, kinds, limits }, nodes, edges:chosenEdges, boundaryEdges:boundaries.slice(0,limits.maxBoundaryEdges), omissions: { nodes:candidates.length - nodes.length, edges:internal.length - chosenEdges.length, boundaryEdges:Math.max(0,boundaries.length - limits.maxBoundaryEdges), fields:fields.sort(fieldOrder) }, mermaid:args.mermaid ? projectMermaid(nodes,chosenEdges,args.orientation,{entryNodeId:chosenIds.has(graph.entryNodeId) ? graph.entryNodeId : null,sourceNodes:graph.nodes}) : null };
}
