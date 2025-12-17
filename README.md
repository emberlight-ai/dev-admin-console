This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Server deploy (PM2 + Nginx + HTTPS for getdevteam.com)

This repo includes ready-to-use deployment configs:

- **PM2**: `deploy/pm2/ecosystem.config.cjs` (runs Next.js on `127.0.0.1:3015`)
- **Nginx (HTTP)**: `deploy/nginx/getdevteam.com.conf` (safe to enable before certs exist)
- **Nginx (HTTPS)**: `deploy/nginx/getdevteam.com.https.conf` (redirects HTTP->HTTPS + serves HTTPS)

### PM2

```bash
cd /home/ubuntu/dev-admin-console
npm ci
npm run build

# create log dir if it doesn't exist
sudo mkdir -p /var/log/pm2
sudo chown -R "$USER":"$USER" /var/log/pm2

pm2 start /home/ubuntu/dev-admin-console/deploy/pm2/ecosystem.config.cjs
pm2 save
pm2 status

# (recommended) auto-start PM2 on boot for your user
pm2 startup
```

Then run the command PM2 prints (it will start with `sudo env ...`), and:

```bash
pm2 save
```

### Nginx (isolated vhost)

```bash
sudo cp /home/ubuntu/dev-admin-console/deploy/nginx/getdevteam.com.conf /etc/nginx/sites-available/getdevteam.com
sudo ln -s /etc/nginx/sites-available/getdevteam.com /etc/nginx/sites-enabled/getdevteam.com
sudo nginx -t && sudo systemctl reload nginx
```

### HTTPS (Let's Encrypt, webroot)

```bash
sudo mkdir -p /var/www/letsencrypt

# Install certbot if needed (Ubuntu):
sudo apt-get update
sudo apt-get install -y certbot

sudo certbot certonly --webroot -w /var/www/letsencrypt \
  -d getdevteam.com -d www.getdevteam.com

# Switch Nginx to the HTTPS config after certs exist:
sudo cp /home/ubuntu/dev-admin-console/deploy/nginx/getdevteam.com.https.conf /etc/nginx/sites-available/getdevteam.com

# Re-test and reload nginx:
sudo nginx -t && sudo systemctl reload nginx
```

### Updating the app after code changes (rebuild + restart PM2)

When you deploy new code (git pull / copy files), rebuild and restart the PM2 process:

```bash
cd /home/ubuntu/dev-admin-console

# get latest code (example)
git pull

# install deps (use npm ci for reproducible installs)
npm ci

# rebuild Next.js production bundle
npm run build

# restart the existing process
pm2 restart getdevteam
pm2 save
```

If you changed environment variables (or `.env`), use:

```bash
pm2 restart getdevteam --update-env
pm2 save
```
