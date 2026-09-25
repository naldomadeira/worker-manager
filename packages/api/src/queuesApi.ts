import { BaseAdapter } from './queueAdapters/base';
import { WorkerManagerQueues } from './types';

/**
 * A board is read-only when every queue on it is. An empty board is not: nothing has said it
 * is read-only yet, and queues registered later decide.
 */
export function isReadOnlyBoard(queues: Iterable<BaseAdapter>): boolean {
  let seen = false;
  for (const queue of queues) {
    if (!queue.readOnlyMode) {
      return false;
    }
    seen = true;
  }
  return seen;
}

export function getQueuesApi(queues: ReadonlyArray<BaseAdapter>) {
  const workerManagerQueues: WorkerManagerQueues = new Map<string, BaseAdapter>();

  function addQueue(queue: BaseAdapter): void {
    const name = queue.getName();
    workerManagerQueues.set(name, queue);
  }

  function removeQueue(queueOrName: string | BaseAdapter) {
    const name = typeof queueOrName === 'string' ? queueOrName : queueOrName.getName();

    workerManagerQueues.delete(name);
  }

  function setQueues(newBullQueues: ReadonlyArray<BaseAdapter>): void {
    newBullQueues.forEach((queue) => {
      const name = queue.getName();

      workerManagerQueues.set(name, queue);
    });
  }

  function replaceQueues(newBullQueues: ReadonlyArray<BaseAdapter>): void {
    const queuesToPersist: string[] = newBullQueues.map((queue) => queue.getName());

    workerManagerQueues.forEach((_queue, name) => {
      if (queuesToPersist.indexOf(name) === -1) {
        workerManagerQueues.delete(name);
      }
    });

    return setQueues(newBullQueues);
  }

  setQueues(queues);

  return { workerManagerQueues, setQueues, replaceQueues, addQueue, removeQueue };
}
