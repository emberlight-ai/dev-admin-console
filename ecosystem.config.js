module.exports = {
  apps: [
    {
      name: 'web-app',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'ai-worker',
      script: 'npx',
      args: 'tsx scripts/ai-worker.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
