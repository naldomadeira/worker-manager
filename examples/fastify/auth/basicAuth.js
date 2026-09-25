const { FastifyAdapter } = require('@worker-manager/fastify');
const { createWorkerManagerBoard } = require('@worker-manager/api');
const { BullMQAdapter } = require('@worker-manager/api/bullMQAdapter');

module.exports.basicAuth = function basicAuth(fastify, { queue }, next) {
  const authenticate = { realm: 'Worker Manager' };
  function validate(username, password, req, reply, done) {
    if (username === 'bull' && password === 'board') {
      done();
    } else {
      done(new Error('Unauthorized'));
    }
  }

  fastify.register(require('@fastify/basic-auth'), { validate, authenticate });

  fastify.after(() => {
    const serverAdapter = new FastifyAdapter();

    createWorkerManagerBoard({
      queues: [new BullMQAdapter(queue)],
      serverAdapter,
    });

    serverAdapter.setBasePath('/basic/ui');
    fastify.register(serverAdapter.registerPlugin(), { prefix: '/basic/ui' });
    fastify.route({
      method: 'GET',
      url: '/basic/login',
      handler: async (req, reply) => {
        reply.redirect('/basic/ui');
      },
    });
    fastify.addHook('onRequest', (req, reply, next) => {
      fastify.basicAuth(req, reply, function (error) {
        if (!error) {
          return next();
        }

        reply.code(error.statusCode || 500 >= 400).send({ error: error.name });
      });
    });
  });

  next();
};
