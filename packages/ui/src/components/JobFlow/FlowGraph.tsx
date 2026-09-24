import type { FlowNode } from '@worker-manager/api/typings/app';
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { Crosshair, Maximize, Minus, Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { FlowDetailsPanel } from './FlowDetailsPanel';
import { FlowJobNode } from './FlowJobNode';
import type { FlowGraphNode, FlowJobNodeData } from './flowLayout';
import { layoutFlow, nodeKey, shapeSignature } from './flowLayout';
import { stateColor } from './flowStates';
import { useFlowExpansion } from './useFlowExpansion';
import '@xyflow/react/dist/style.css';

const nodeTypes = { jobNode: FlowJobNode };

const MINIMAP_WIDTH = 140;
const MINIMAP_HEIGHT = 100;
const MINIMAP_FROM_NODES = 12;
const FIT_MIN_ZOOM = 0.15;

type Positions = Map<string, FlowGraphNode['position']>;

function usePositions(tree: FlowNode, nodes: FlowGraphNode[]): Positions {
  const signature = shapeSignature(tree);
  const cache = useRef<{ signature: string; positions: Positions } | null>(null);

  if (!cache.current || cache.current.signature !== signature) {
    cache.current = {
      signature,
      positions: new Map(nodes.map((node) => [node.id, node.position])),
    };
  }

  return cache.current.positions;
}

function findByKey(node: FlowNode, key: string): FlowNode | null {
  if (nodeKey(node) === key) {
    return node;
  }

  for (const child of node.children) {
    const found = findByKey(child, key);
    if (found) {
      return found;
    }
  }

  return null;
}

const ICON_SIZE = 15;

/** xyflow reads its colours from these custom properties; mapping them onto the theme tokens
 * keeps the canvas, controls and minimap in step with light and dark mode. */
const flowTheme = {
  '--xy-background-color': 'var(--background)',
  '--xy-background-pattern-color': 'color-mix(in oklab, var(--muted-foreground) 35%, transparent)',
  '--xy-node-background-color': 'transparent',
  '--xy-node-border': 'none',
  '--xy-node-border-radius': 'var(--radius-xl)',
  '--xy-node-boxshadow-hover': 'none',
  '--xy-node-boxshadow-selected': 'none',
  '--xy-edge-stroke': 'color-mix(in oklab, var(--muted-foreground) 45%, transparent)',
  '--xy-edge-stroke-selected': 'var(--primary)',
  '--xy-attribution-background-color': 'transparent',
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--muted)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-color-hover': 'var(--foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-minimap-background-color': 'var(--card)',
  '--xy-minimap-mask-background-color': 'color-mix(in oklab, var(--background) 55%, transparent)',
  '--xy-minimap-mask-stroke-color': 'var(--primary)',
} as CSSProperties;

const canvasClassName = [
  'relative h-[360px] min-h-80 min-w-0 overflow-hidden rounded-xl border min-[1100px]:h-full',
  '[&_.react-flow__controls]:overflow-hidden [&_.react-flow__controls]:rounded-lg [&_.react-flow__controls]:border [&_.react-flow__controls]:shadow-sm',
  '[&_.react-flow__controls-button]:size-7 [&_.react-flow__controls-button]:transition-colors',
  '[&_.react-flow__controls-button_svg]:max-h-none! [&_.react-flow__controls-button_svg]:max-w-none! [&_.react-flow__controls-button_svg]:fill-none! [&_.react-flow__controls-button_svg]:stroke-current',
  '[&_.react-flow__minimap]:overflow-hidden [&_.react-flow__minimap]:rounded-lg [&_.react-flow__minimap]:border [&_.react-flow__minimap]:shadow-sm',
  '[&_.react-flow__node]:rounded-xl [&_.react-flow__node:focus-visible]:outline-none [&_.react-flow__node:focus-visible]:ring-3 [&_.react-flow__node:focus-visible]:ring-ring/50',
  '[&_.react-flow__edge-path]:transition-[stroke]',
].join(' ');

const FlowControls = ({
  focusNodeId,
  onFocus,
}: {
  focusNodeId: string | null;
  onFocus: () => void;
}) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { t } = useTranslation();

  return (
    <Controls showZoom={false} showFitView={false} showInteractive={false}>
      <ControlButton
        title={t('JOB.FLOW.ZOOM_IN')}
        aria-label={t('JOB.FLOW.ZOOM_IN')}
        onClick={() => void zoomIn({ duration: 200 })}
      >
        <Plus size={ICON_SIZE} />
      </ControlButton>
      <ControlButton
        title={t('JOB.FLOW.ZOOM_OUT')}
        aria-label={t('JOB.FLOW.ZOOM_OUT')}
        onClick={() => void zoomOut({ duration: 200 })}
      >
        <Minus size={ICON_SIZE} />
      </ControlButton>
      <ControlButton
        title={t('JOB.FLOW.FIT_VIEW')}
        aria-label={t('JOB.FLOW.FIT_VIEW')}
        onClick={() =>
          void fitView({ padding: 0.15, maxZoom: 1, minZoom: FIT_MIN_ZOOM, duration: 300 })
        }
      >
        <Maximize size={ICON_SIZE} />
      </ControlButton>
      {!!focusNodeId && (
        <ControlButton
          title={t('JOB.FLOW.FOCUS_JOB')}
          aria-label={t('JOB.FLOW.FOCUS_JOB')}
          onClick={() => {
            onFocus();
            void fitView({
              nodes: [{ id: focusNodeId }],
              padding: 2,
              maxZoom: 1,
              duration: 300,
            });
          }}
        >
          <Crosshair size={ICON_SIZE} />
        </ControlButton>
      )}
    </Controls>
  );
};

export interface FlowGraphProps {
  root: FlowNode;
  activeJob: Pick<FlowNode, 'id' | 'queueName'> | null;
}

const FlowGraph = ({ root, activeJob }: FlowGraphProps) => {
  const { t } = useTranslation();
  const activeKey = activeJob ? nodeKey(activeJob) : null;
  const { tree, expand, isExpanding, isExpanded } = useFlowExpansion(root);
  const [selectedKey, setSelectedKey] = useState<string | null>(activeKey);

  const describe = (node: FlowNode) =>
    t('JOB.FLOW.NODE_LABEL', {
      name: node.name ?? node.id,
      state: node.state,
      queue: node.queueName,
      id: node.id,
    });

  const laidOut = layoutFlow(tree, selectedKey, describe);
  const positions = usePositions(tree, laidOut.nodes);

  const nodes = laidOut.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
    data: {
      ...node.data,
      isExpanding: isExpanding(node.id),
      isExpanded: isExpanded(node.id),
      onExpand: expand,
    },
  }));

  const selected = selectedKey ? findByKey(tree, selectedKey) : null;
  const focusable = nodes.some((node) => node.id === activeKey) ? activeKey : null;

  const ariaLabelConfig = {
    'node.a11yDescription.default': t('JOB.FLOW.A11Y_NODE'),
    'node.a11yDescription.keyboardDisabled': t('JOB.FLOW.A11Y_NODE'),
    'edge.a11yDescription.default': t('JOB.FLOW.A11Y_EDGE'),
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 min-[1100px]:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="order-2 flex min-h-0 min-w-0 min-[1100px]:order-none min-[1100px]:col-start-2 min-[1100px]:row-start-1">
        {selected ? (
          <FlowDetailsPanel key={nodeKey(selected)} node={selected} />
        ) : (
          <aside className="flex flex-1 items-center justify-center rounded-xl border border-dashed bg-muted/30 p-6 text-center text-[0.8125rem] text-muted-foreground">
            <p>{t('JOB.FLOW.NO_SELECTION')}</p>
          </aside>
        )}
      </div>
      <div className="min-w-0 min-[1100px]:col-start-1 min-[1100px]:row-start-1">
        <div className={canvasClassName}>
          <ReactFlow
            style={flowTheme}
            nodes={nodes}
            edges={laidOut.edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_event, node) => setSelectedKey(node.id)}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable
            elementsSelectable
            ariaLabelConfig={ariaLabelConfig}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: FIT_MIN_ZOOM }}
            minZoom={0.02}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return;
              }
              const target = (event.target as HTMLElement).closest('.react-flow__node');
              const id = target?.getAttribute('data-id');
              if (id) {
                event.preventDefault();
                setSelectedKey(id);
              }
            }}
          >
            <Background gap={18} size={1.2} />
            <FlowControls
              focusNodeId={focusable}
              onFocus={() => focusable && setSelectedKey(focusable)}
            />
            {nodes.length >= MINIMAP_FROM_NODES && (
              <MiniMap
                className="m-3!"
                style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
                pannable
                zoomable
                nodeStrokeWidth={12}
                nodeColor={(node) =>
                  stateColor((node.data as unknown as FlowJobNodeData).node.state)
                }
                nodeStrokeColor="transparent"
              />
            )}
          </ReactFlow>
        </div>
      </div>
    </div>
  );
};

export default FlowGraph;
