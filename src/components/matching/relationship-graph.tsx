'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type ReactFlowInstance,
  type Node,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type NodeTypes,
  type NodeProps,
  getStraightPath,
} from '@xyflow/react';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import { ExternalLink, Maximize2 } from 'lucide-react';

import { UserCombobox, type PickUser } from '@/components/matching/user-combobox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type GraphNodeRow = {
  userid: string;
  username: string;
  avatar: string | null;
  is_digital_human: boolean;
};

type GraphEdgeOut =
  | { id: string; kind: 'match'; a: string; b: string; created_at?: string }
  | { id: string; kind: 'pending'; from: string; to: string; created_at?: string }
  | { id: string; kind: 'block'; from: string; to: string; created_at?: string };

type GraphResponse = { nodes: GraphNodeRow[]; edges: GraphEdgeOut[] };

type UserNodeData = { user: GraphNodeRow };
type UserGraphNode = Node<UserNodeData>;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}

function UserNode({ data }: NodeProps<UserGraphNode>) {
  const u = data.user;
  const [open, setOpen] = React.useState(false);
  const detailHref = u.is_digital_human
    ? `/admin/digital-humans/${encodeURIComponent(u.userid)}`
    : `/admin/users/${encodeURIComponent(u.userid)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'rounded-full border bg-background p-1 shadow-sm',
            'cursor-pointer select-none'
          )}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {/* Hidden handles placed at the exact center so edges draw center-to-center */}
          <Handle
            type="target"
            position={Position.Left}
            style={{
              opacity: 0,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />
          <Handle
            type="source"
            position={Position.Right}
            style={{
              opacity: 0,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          />

          <Avatar className="h-12 w-12">
            <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
            <AvatarFallback>{initials(u.username)}</AvatarFallback>
          </Avatar>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-64 p-3"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Avatar className="h-9 w-9">
              <AvatarImage src={u.avatar ?? undefined} alt={u.username} />
              <AvatarFallback>{initials(u.username)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-semibold">{u.username}</div>
              <div className="mt-1 flex items-center gap-2">
                {u.is_digital_human ? (
                  <Badge variant="secondary">Digital Human</Badge>
                ) : (
                  <Badge variant="outline">Real User</Badge>
                )}
              </div>
              <div className="mt-2 truncate text-xs text-muted-foreground">{u.userid}</div>
            </div>
          </div>

          <Button
            asChild
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Open user details"
          >
            <Link href={detailHref}>
              <ExternalLink className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const nodeTypes: NodeTypes = { user: UserNode };

function InvitingEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, style } = props;
  const [edgePath, midX, midY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const angle = (Math.atan2(targetY - sourceY, targetX - sourceX) * 180) / Math.PI;
  const stroke = typeof style?.stroke === 'string' ? style.stroke : '#9ca3af';

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      <path
        d="M -6 -4 L 6 0 L -6 4 Z"
        fill={stroke}
        transform={`translate(${midX}, ${midY}) rotate(${angle})`}
      />
    </>
  );
}

const edgeTypes: EdgeTypes = { inviting: InvitingEdge };

type SimNode = SimulationNodeDatum & { id: string; x?: number; y?: number };
type SimLink = SimulationLinkDatum<SimNode> & { source: string | SimNode; target: string | SimNode };

// Deterministic hash function for stable initial positions
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function layoutWithForce(nodes: UserGraphNode[], edges: Edge[], width: number, height: number) {
  const simNodes: SimNode[] = nodes.map((n) => {
    // Use deterministic positioning based on node id hash
    const hash = simpleHash(n.id);
    const angle = (hash % 360) * (Math.PI / 180);
    const radius = 150 + ((hash % 100) / 100) * 100;
    return {
      id: n.id,
      x: n.position.x || width / 2 + Math.cos(angle) * radius,
      y: n.position.y || height / 2 + Math.sin(angle) * radius,
    };
  });

  const linkData: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target }));

  const sim = forceSimulation<SimNode>(simNodes)
    .force('charge', forceManyBody().strength(-520))
    .force('center', forceCenter(width / 2, height / 2))
    .force('collide', forceCollide(46))
    .force(
      'link',
      forceLink<SimNode, SimLink>(linkData)
        .id((d) => d.id)
        .distance(160)
        .strength(0.9)
    )
    .stop();

  for (let i = 0; i < 220; i++) sim.tick();

  const pos = new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
  return nodes.map((n) => ({ ...n, position: { x: pos.get(n.id)?.x ?? 0, y: pos.get(n.id)?.y ?? 0 } }));
}

export function RelationshipGraph({
  initialRootUserId,
  showPicker = true,
  heightClassName = 'h-[520px]',
}: {
  initialRootUserId?: string;
  showPicker?: boolean;
  heightClassName?: string;
}) {
  const [root, setRoot] = React.useState<PickUser | null>(
    initialRootUserId ? ({ userid: initialRootUserId, username: initialRootUserId } as PickUser) : null
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [nodes, setNodes] = React.useState<Node<UserNodeData>[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);

  const rfRef = React.useRef<ReactFlowInstance<Node<UserNodeData>, Edge> | null>(null);
  const [rfReady, setRfReady] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dataVersionRef = React.useRef(0);
  
  // Fixed size for layout calculation to prevent recalculation
  const FIXED_WIDTH = 1100;
  const FIXED_HEIGHT = 720;

  // If embedded with a fixed root id, keep it in sync if prop changes.
  React.useEffect(() => {
    if (!initialRootUserId) return;
    setRoot({ userid: initialRootUserId, username: initialRootUserId } as PickUser);
  }, [initialRootUserId]);

  const load = React.useCallback(async () => {
    if (!root?.userid) return;
    setLoading(true);
    setError(null);
    dataVersionRef.current += 1;
    const currentVersion = dataVersionRef.current;
    
    try {
      const url = new URL('/api/admin/matching/graph', window.location.origin);
      url.searchParams.set('rootUserId', root.userid);
      url.searchParams.set('depth', '1');
      url.searchParams.set('limit', '300');
      const res = await fetch(url.toString());
      const json = (await res.json()) as GraphResponse & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to load graph');

      // Only process if this is still the latest request
      if (currentVersion !== dataVersionRef.current) return;

      const baseNodes: UserGraphNode[] = (json.nodes ?? []).map((u) => ({
        id: u.userid,
        type: 'user',
        data: { user: u },
        position: { x: 0, y: 0 },
      }));

      const baseEdges: Edge[] = (json.edges ?? []).map((e) => {
        if (e.kind === 'match') {
          return {
            id: e.id,
            source: e.a,
            target: e.b,
            type: 'straight',
            style: { stroke: '#ec4899', strokeWidth: 2.5 },
          };
        }
        if (e.kind === 'block') {
          return {
            id: e.id,
            source: e.from,
            target: e.to,
            type: 'straight',
            style: { stroke: '#b91c1c', strokeWidth: 2.5 },
          };
        }
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          type: 'inviting',
          style: { stroke: '#9ca3af', strokeWidth: 2 },
        };
      });

      // Calculate layout once with fixed size
      const laidOutNodes = layoutWithForce(baseNodes, baseEdges, FIXED_WIDTH, FIXED_HEIGHT);
      
      // Set nodes and edges together to prevent intermediate renders
      setNodes(laidOutNodes);
      setEdges(baseEdges);
      
      // Fit view once after layout
      queueMicrotask(() => {
        if (currentVersion === dataVersionRef.current && rfRef.current) {
          rfRef.current.fitView({ padding: 0.2, duration: 400 });
        }
      });
    } catch (err) {
      if (currentVersion !== dataVersionRef.current) return;
      console.error(err);
      setNodes([]);
      setEdges([]);
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    } finally {
      if (currentVersion === dataVersionRef.current) {
        setLoading(false);
      }
    }
  }, [root?.userid]);

  React.useEffect(() => {
    if (!root?.userid) return;
    load();
  }, [root?.userid, load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showPicker ? (
          <div className="min-w-[320px] flex-1">
            <div className="text-sm font-medium">Select root user</div>
            <div className="mt-2">
              <UserCombobox value={root} onChange={setRoot} placeholder="Search users…" />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Relationship graph</div>
        )}

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => rfRef.current?.fitView({ padding: 0.2, duration: 400 })}
            disabled={!rfReady}
          >
            <Maximize2 className="mr-2 h-4 w-4" />
            Fit
          </Button>
          {loading ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
        </div>
      </div>

      {showPicker ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-7 rounded-full bg-[#ec4899]" />
            <span className="font-semibold text-[#ec4899]">matched</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-7 rounded-full bg-[#9ca3af]" />
            <span className="font-semibold text-[#9ca3af]">inviting</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-7 rounded-full bg-[#b91c1c]" />
            <span className="font-semibold text-[#b91c1c]">block</span>
          </span>
        </div>
      ) : null}

      {error ? (
        <Card className="p-3">
          <div className="text-sm text-destructive">{error}</div>
        </Card>
      ) : null}

      <div ref={containerRef} className={cn('overflow-hidden rounded-lg border bg-background', heightClassName)}>
        {root?.userid ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(inst) => {
              rfRef.current = inst;
              setRfReady(true);
            }}
            proOptions={{ hideAttribution: true }}
            className="matching-flow"
            defaultEdgeOptions={{ type: 'straight' }}
          >
            <Controls />
            <Background gap={18} size={1} />
          </ReactFlow>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-sm text-muted-foreground">Select a user to render the graph.</div>
          </div>
        )}
      </div>
    </div>
  );
}


