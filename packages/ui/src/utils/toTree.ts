import type { AppQueue } from '@worker-manager/api/typings/app';

/** What the tree needs from a queue: a name, and what to split it on. */
export interface TreeQueue {
  name: string;
  delimiter?: string;
}

export interface QueueTreeNode<Q extends TreeQueue> {
  name: string;
  queue?: Q;
  children: QueueTreeNode<Q>[];
}

export type AppQueueTreeNode = QueueTreeNode<AppQueue>;

export function toTree<Q extends TreeQueue = AppQueue>(
  queues: Q[],
  sort = false
): QueueTreeNode<Q> {
  const root: QueueTreeNode<Q> = {
    name: 'root',
    children: [],
  };

  queues.forEach((queue) => {
    if (!queue.delimiter) {
      // If no delimiter, add as direct child to root
      root.children.push({
        name: queue.name,
        queue,
        children: [],
      });
      return;
    }

    const nameToSplit =
      queue.name.startsWith('{') && queue.name.endsWith('}') ? queue.name.slice(1, -1) : queue.name;
    const parts = nameToSplit.split(queue.delimiter);
    let currentLevel = root.children;

    parts.forEach((part, index) => {
      let node = currentLevel.find((n) => n.name === part);

      if (!node) {
        const isLeafNode = index === parts.length - 1;
        node = {
          name: part,
          children: [],
          // Only set queue data if we're at the leaf node
          ...(isLeafNode ? { queue } : {}),
        };
        currentLevel.push(node);
      }

      currentLevel = node.children;
    });
  });

  if (sort) {
    sortTree(root);
  }

  return root;
}

export function collectGroupPaths(node: QueueTreeNode<TreeQueue>, parentPath = ''): string[] {
  const paths: string[] = [];
  for (const child of node.children) {
    if (child.children.length > 0) {
      const path = parentPath ? `${parentPath}/${child.name}` : child.name;
      paths.push(path);
      paths.push(...collectGroupPaths(child, path));
    }
  }
  return paths;
}

function sortTree(node: QueueTreeNode<TreeQueue>): void {
  node.children.sort((a, b) => {
    const aIsGroup = a.children.length > 0;
    const bIsGroup = b.children.length > 0;

    // Groups first, then leaf queues
    if (aIsGroup !== bIsGroup) {
      return aIsGroup ? -1 : 1;
    }

    // Alphabetical within the same type
    return a.name.localeCompare(b.name);
  });

  node.children.forEach(sortTree);
}
