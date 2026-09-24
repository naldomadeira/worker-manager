import { createBullBoard } from '@worker-manager/api';
import type {
  BullBoardRequest,
  ControllerHandlerReturnType,
} from '@worker-manager/api/typings/app';
import { seedFixtures } from './fixtures';
import { MockAdapter } from './MockAdapter';
import { MockMetricsHistoryProvider } from './MockMetricsHistoryProvider';
import { MSWServerAdapter } from './MSWServerAdapter';
import { findJob, state } from './state';
import type { DemoJob } from './state';

seedFixtures(state);

// ---- local mock for the flow endpoint (avoids pulling in bullmq) ----

// Mirrors how BullMQ files a child that failed: `ignoreDependencyOnFailure` moves it to the
// parent's ignored set (with its reason), `failParentOnFailure: false` leaves it unfinished, and
// anything else lands in the failed set.
function isIgnored(child: DemoJob) {
  return child.state === 'failed' && !!child.opts?.ignoreDependencyOnFailure;
}

function isUnfinished(child: DemoJob) {
  if (child.state === 'failed') return child.opts?.failParentOnFailure === false;
  return child.state !== 'completed';
}

function countDependencies(children: DemoJob[]) {
  const dependencies = {
    processed: children.filter((c) => c.state === 'completed').length,
    unprocessed: children.filter(isUnfinished).length,
    ignored: children.filter(isIgnored).length,
    failed: children.filter((c) => c.state === 'failed' && !isIgnored(c) && !isUnfinished(c))
      .length,
  };

  const ignoredChildFailureReasons = Object.fromEntries(
    children.filter(isIgnored).map((c) => [`bull:${c.queueName}:${c.id}`, c.failedReason])
  );

  return Object.values(dependencies).some(Boolean)
    ? {
        dependencies,
        ...(dependencies.ignored > 0 ? { ignoredChildFailureReasons } : {}),
      }
    : {};
}

function buildFlowNode(job: DemoJob): any {
  const childJobs: DemoJob[] = [];
  if (job.childRefs) {
    for (const ref of job.childRefs) {
      const childJob = findJob(ref.queueName, ref.jobId);
      if (childJob) childJobs.push(childJob);
    }
  }

  return {
    id: job.id,
    name: job.name,
    progress: job.progress,
    state: job.state,
    queueName: job.queueName,
    children: childJobs.map(buildFlowNode),
    ...countDependencies(childJobs),
  };
}

function findFlowRoot(job: DemoJob): DemoJob {
  let current = job;
  const guard = new Set<string>();
  while (current.parentKey && !guard.has(String(current.id))) {
    guard.add(String(current.id));
    const m = current.parentKey.match(/^bull:(.+):(\d+)$/);
    if (!m) break;
    const [, queueName, parentId] = m;
    const parent = findJob(queueName, parentId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

async function mockJobFlowHandler(req: BullBoardRequest): Promise<ControllerHandlerReturnType> {
  const { queueName, jobId } = req.params;
  const job = findJob(queueName, jobId);
  if (!job) return { status: 404, body: { error: 'Job not found' } };

  const root = findFlowRoot(job);
  const rootHasChildren = !!root.childRefs && root.childRefs.length > 0;
  if (!rootHasChildren && !job.parentKey) {
    return {
      status: 200,
      body: { nodeId: job.id, isFlowNode: false, flowRoot: null },
    };
  }
  return {
    status: 200,
    body: {
      nodeId: job.id,
      isFlowNode: rootHasChildren,
      flowRoot: buildFlowNode(root),
    },
  };
}

// ---- wire it up via the real createBullBoard ----

const mockAdapters = state.queues.map((q) => {
  const adapter = new MockAdapter(q);
  if (q.name === 'billing:invoices') {
    adapter.setFormatter('data', (data: unknown) => {
      if (!data || typeof data !== 'object') return data;
      const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
      for (const key of Object.keys(out)) {
        if (/apikey|secret|token|password/i.test(key)) {
          out[key] = '***';
        }
      }
      return out;
    });
  }
  return adapter;
});

const serverAdapter = new MSWServerAdapter();
serverAdapter.setBasePath('/worker-manager/demo');

createBullBoard({
  queues: mockAdapters,
  serverAdapter,
  options: {
    uiBasePath: '/worker-manager/demo',
    // Stands in for @worker-manager/metrics, which needs Redis and a running recorder. It
    // turns on the Metrics history page and the longer ranges on each queue's chart.
    historyProvider: new MockMetricsHistoryProvider(),
    uiConfig: {
      boardTitle: 'Worker Manager Demo',
      boardLogo: { path: '/worker-manager/demo/logo.svg', width: 32, height: 32 },
      environment: { label: 'demo', color: '#f59f00', textColor: '#000' },
      showMetrics: true,
      pollingInterval: { showSetting: true },
      sortQueues: true,
      miscLinks: [],
      hideDocsLink: false,
    },
  },
});

// Replace the flow handler with the mock (real one needs bullmq which isn't browser-safe)
serverAdapter.mapApiRoutes((route) =>
  route.route === '/api/queues/:queueName/:jobId/flow'
    ? { ...route, handler: mockJobFlowHandler }
    : route
);

export const handlers = serverAdapter.getHandlers();
