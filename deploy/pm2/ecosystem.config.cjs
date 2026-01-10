/**
 * PM2 ecosystem for getdevteam (Next.js)
 *
 * Notes:
 * - Binds to localhost only to avoid conflicting with other services on the box.
 * - Uses a dedicated port; Nginx should reverse-proxy to it.
 * - Keep app name unique so it doesn't collide with other PM2 processes.
 */

module.exports = {
  apps: [
    {
      name: "getdevteam",
      cwd: "/home/ubuntu/dev-admin-console",
      // Run via npm so the correct local Next binary is used.
      script: "npm",
      args: "start -- -p 3015 -H 127.0.0.1",
      env: {
        NODE_ENV: "production",
      },
      // Optional: adjust based on your machine and Next.js behavior.
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      // Keeps logs isolated from other apps.
      out_file: "/var/log/pm2/getdevteam.out.log",
      error_file: "/var/log/pm2/getdevteam.err.log",
      merge_logs: true,
    },
    // Digital human automation workers (run in parallel)
    {
      name: "dh-auto-replies",
      cwd: "/home/ubuntu/dev-admin-console",
      script: "./node_modules/.bin/tsx",
      args: "scripts/digital-human-auto-replies.ts",
      env: {
        NODE_ENV: "production",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      out_file: "/var/log/pm2/dh-auto-replies.out.log",
      error_file: "/var/log/pm2/dh-auto-replies.err.log",
      merge_logs: true,
    },
    {
      name: "dh-greetings",
      cwd: "/home/ubuntu/dev-admin-console",
      script: "./node_modules/.bin/tsx",
      args: "scripts/digital-human-greetings.ts",
      env: {
        NODE_ENV: "production",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      out_file: "/var/log/pm2/dh-greetings.out.log",
      error_file: "/var/log/pm2/dh-greetings.err.log",
      merge_logs: true,
    },
    {
      name: "dh-followups",
      cwd: "/home/ubuntu/dev-admin-console",
      script: "./node_modules/.bin/tsx",
      args: "scripts/digital-human-followups.ts",
      env: {
        NODE_ENV: "production",
      },
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      out_file: "/var/log/pm2/dh-followups.out.log",
      error_file: "/var/log/pm2/dh-followups.err.log",
      merge_logs: true,
    },
  ],
};


