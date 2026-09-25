// A small min-cost max-flow solver (successive shortest paths with Dijkstra and potentials).
// The audit allocates quarter-credit units from courses to requirements with it (design §5.5),
// and the P0 feasibility check places required classes into school years with it (§5.7).
// Integer capacities in, integer flows out. Edge costs must be non-negative. Deterministic:
// ties go to the lower node index.

export class MinCostFlow {
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly cost: number[] = [];
  private readonly adj: number[][];

  constructor(readonly nodeCount: number) {
    this.adj = Array.from({ length: nodeCount }, () => []);
  }

  /** Adds an edge and its residual; returns the edge id (read its flow with `flowOn`). */
  addEdge(from: number, to: number, capacity: number, cost: number): number {
    if (cost < 0) throw new RangeError("MinCostFlow edge costs must be non-negative.");
    const id = this.to.length;
    this.to.push(to, from);
    this.cap.push(capacity, 0);
    this.cost.push(cost, -cost);
    this.adj[from].push(id);
    this.adj[to].push(id + 1);
    return id;
  }

  /** Flow sent along an edge added with `addEdge`. */
  flowOn(edge: number): number {
    return this.cap[edge + 1];
  }

  /** Sends as much flow as possible from `source` to `sink` at the least cost. */
  run(source: number, sink: number): { flow: number; cost: number } {
    const n = this.nodeCount;
    const potential = new Array<number>(n).fill(0);
    const dist = new Array<number>(n);
    const prevEdge = new Array<number>(n);
    const done = new Array<boolean>(n);
    let flow = 0;
    let total = 0;
    for (;;) {
      dist.fill(Infinity);
      prevEdge.fill(-1);
      done.fill(false);
      dist[source] = 0;
      for (;;) {
        let u = -1;
        for (let v = 0; v < n; v++) if (!done[v] && dist[v] < Infinity && (u === -1 || dist[v] < dist[u])) u = v;
        if (u === -1) break;
        done[u] = true;
        for (const e of this.adj[u]) {
          if (this.cap[e] <= 0) continue;
          const v = this.to[e];
          const nd = dist[u] + this.cost[e] + potential[u] - potential[v];
          if (nd < dist[v]) {
            dist[v] = nd;
            prevEdge[v] = e;
          }
        }
      }
      if (dist[sink] === Infinity) break;
      for (let v = 0; v < n; v++) if (dist[v] < Infinity) potential[v] += dist[v];
      let push = Infinity;
      for (let v = sink; v !== source; v = this.to[prevEdge[v] ^ 1]) push = Math.min(push, this.cap[prevEdge[v]]);
      for (let v = sink; v !== source; v = this.to[prevEdge[v] ^ 1]) {
        const e = prevEdge[v];
        this.cap[e] -= push;
        this.cap[e ^ 1] += push;
        total += push * this.cost[e];
      }
      flow += push;
    }
    return { flow, cost: total };
  }
}
