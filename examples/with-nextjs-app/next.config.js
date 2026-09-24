/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@worker-manager/api', '@worker-manager/ui', '@worker-manager/hono', 'bullmq'],

  // The tracer can't follow @worker-manager/api's eval(require.resolve), so ship the UI manually (#444).
  outputFileTracingIncludes: {
    '/api/queues/*': ['./node_modules/@worker-manager/ui/dist/**/*'],
  },

  // Monorepo: set the tracing root to the workspace root.
  // outputFileTracingRoot: require('path').join(__dirname, '../../'),
};

module.exports = nextConfig;
