import { useState } from 'react';
import { useHistory } from 'react-router-dom';
import { pgBossLinks } from '../utils/links';
import { isErrorBody } from './query';
import { usePgBossApi } from './usePgBossApi';

/**
 * Opens a job from its id alone. The server looks it up in the visible queues; an id it cannot
 * find comes back as an error body, which the client has already toasted.
 */
export function usePgBossFindJob() {
  const api = usePgBossApi();
  const history = useHistory();
  const [pending, setPending] = useState(false);

  const open = async (id: string): Promise<boolean> => {
    setPending(true);
    try {
      const response = await api.findJob(id.trim());
      if (isErrorBody(response)) return false;
      const { queueName, id: jobId, state } = response.job;
      history.push(pgBossLinks.jobPage(queueName, jobId, state));
      return true;
    } catch {
      return false;
    } finally {
      setPending(false);
    }
  };

  return { open, pending };
}
