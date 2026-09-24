const { Queue: QueueMQ, Worker } = require('bullmq');
const { createWorkerManagerBoard } = require('@worker-manager/api');
const { BullMQAdapter } = require('@worker-manager/api/bullMQAdapter');
const { ExpressAdapter } = require('@worker-manager/express');

const sleep = (t) => new Promise((resolve) => setTimeout(resolve, t * 1000));

const redisOptions = {
  port: 6379,
  host: 'localhost',
  password: '',
  tls: false,
};

const createQueueMQ = (name) => new QueueMQ(name, { connection: redisOptions });

function setupBullMQProcessor(queueName) {
  new Worker(
    queueName,
    async (job) => {
      for (let i = 0; i <= 100; i++) {
        await sleep(Math.random());
        await job.updateProgress(i);
        await job.log(`Processing job at interval ${i}`);

        if (Math.random() * 200 < 1) throw new Error(`Random error ${i}`);
      }

      return { jobId: `This is the return value of job (${job.id})` };
    },
    { connection: redisOptions }
  );
}

module.exports = function (sails) {
  return {
    configure: function () {
      const WORKER_MANAGER_MIDDLEWARE = 'workermanager';
      sails.config.http.middleware[WORKER_MANAGER_MIDDLEWARE] = (function _testMiddleware() {
        let express = require('express');

        const exampleBullMq = createQueueMQ('BullMQ');
        setupBullMQProcessor(exampleBullMq.name);

        let workerManager = express();

        const serverAdapter = new ExpressAdapter();
        serverAdapter.setBasePath('/ui');

        createWorkerManagerBoard({
          queues: [new BullMQAdapter(exampleBullMq)],
          serverAdapter,
        })

        workerManager.use('/ui', serverAdapter.getRouter());

        workerManager.use('/add', (req, res) => {
          const opts = req.query.opts || {};

          if (opts.delay) {
            opts.delay = +opts.delay * 1000; // delay must be a number
          }

          exampleBullMq.add('Add', { title: req.query.title }, opts);

          res.json({
            ok: true,
          });
        });

        const basePath = `http://127.0.0.1:${sails.config.port||1337}/`;

        sails.log.info(`Worker Manager running on: ${basePath}`)
        sails.log.info(`For the UI, open ${basePath}ui`);
        sails.log.info('Make sure Redis is running on port 6379 by default');
        sails.log.info('To populate the queue, run:');
        sails.log.info(`  curl ${basePath}add?title=Example`);
        sails.log.info('To populate the queue with custom options (opts), run:');
        sails.log.info(`  curl ${basePath}add?title=Test&opts[delay]=9`);

        return workerManager;
      })();
      sails.config.http.middleware.order.splice(0, 0, WORKER_MANAGER_MIDDLEWARE);
    },
  };
};
