import { createWorkerManagerBoard } from '@worker-manager/api';
import { BullMQAdapter } from '@worker-manager/api/bullMQAdapter';
import { ExpressAdapter } from '@worker-manager/express';
import express from 'express';
import type { NextApiRequest, NextApiResponse } from 'next';
import { queue } from '../../../lib/queue';

const basePath = '/api/queues';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(basePath);

createWorkerManagerBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
});

const app = express();
app.use(basePath, serverAdapter.getRouter());

// Let Express handle body parsing and the response.
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return (app as unknown as (req: NextApiRequest, res: NextApiResponse) => void)(req, res);
}
