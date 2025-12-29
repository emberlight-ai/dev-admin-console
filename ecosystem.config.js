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
      script: 'scripts/ai-worker.ts',
      // Uses tsx to run the TypeScript file directly without separate compilation step for the script
      interpreter: 'node_modules/.bin/tsx', 
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}
