module.exports = {
  apps: [
    {
      name: 'web-app',
      script: 'npm',
      args: 'start -- -p 3015 -H 127.0.0.1',
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
