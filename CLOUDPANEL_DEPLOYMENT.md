# 🚀 CloudPanel Deployment Guide

## ❓ 1. Why Is It Asking For the Discord Token Again?
When you enter the token via the application UI, it holds onto it **in memory**. However, every time we update code or the dev server restarts behind the scenes, that in-memory token is cleared. 

To permanently store the Discord Token:
- **In the Local Environment:** Add it securely to your .env file or local environment secrets.
- **In CloudPanel (Production):** You will add it as part of your `.env` configuration file detailed below.

## 📦 2. Preparing the App as a ZIP
To prepare your app bundle for CloudPanel:
1. Export or compress your project folder into a `.zip` file containing the entire source code.

## 🌐 3. Do You Need a Domain?
**Yes, it is highly recommended.** 
CloudPanel binds web applications to domain names to properly route traffic and seamlessly generate encrypted SSL certificates (HTTPS).
1. Purchase or register an affordable/free domain name.
2. Point your domain's `A Record` in your DNS provider (e.g., Cloudflare, Route53, Namecheap) to your CloudPanel server's Public IP address.

## 🛠️ 4. Manual CloudPanel Installation Steps

### Step A: Setup the Node.js Site
1. Log into your CloudPanel dashboard.
2. Click **+ Add Site** -> **Create a Node.js Site**.
3. **Domain Name:** Enter your domain name (e.g., `schedule.yourdomain.com`).
4. **Node.js Version:** Select **Node.js 22** or **Node.js 20**.
5. **App Port:** `3000`
6. **App Entry Point:** Set this to `dist/server.cjs` or point to your start command in the CloudPanel settings.
7. Click **Create**.

### Step B: Upload Your Application
1. Once the site is created, go to the active site's **File Manager** in CloudPanel.
2. Navigate to your site's root directory: `htdocs/schedule.yourdomain.com`
3. Delete the default files if there are any.
4. **Upload** the downloaded `.zip` file into this directory and **extract** it.
5. Once extracted, ensure your `package.json`, `ecosystem.config.cjs`, and `server.ts` files reside directly in the `htdocs/schedule.yourdomain.com/` folder.

### Step C: Generate Secrets Configuration
It's time to set up the necessary environment properties securely.
1. In the `htdocs` File Manager, create a new file and name it `.env`
2. Edit the file, copy/paste these properties, and insert your specific tokens:

```env
NODE_ENV="production"
PORT="3000"
DISCORD_TOKEN="<INSERT_YOUR_DISCORD_BOT_TOKEN_HERE>"
```

### Step D: Build & Start App
1. Go to the **SSH/Terminal** for CloudPanel (or SSH into your server using PuTTY/Terminal).
2. Switch to your site user using: `su - schedule.yourdomain.com` (replace with your site SSH User).
3. Navigate to the web folder: `cd htdocs/schedule.yourdomain.com/`
4. Run `npm install` to download all production and development libraries correctly.
5. Run `npm run build` to compile the React client files and bundle the TypeScript backend server into `dist/server.cjs`.
6. Start and manage your application:
   - **Using CloudPanel's Native UI:** Returning to the Node.js Site configuration settings and hitting **Restart App** will automatically run the entry point.
   - **Using PM2 directly (Recommended via SSH):** 
     If PM2 is not installed, run `npm install -g pm2` (or see the PM2 troubleshooting section below).
     Start your application for the first time by running:
     ```bash
     nice -n -10 npx pm2 start ecosystem.config.cjs
     ```
     To restart it in the future after making updates:
     ```bash
     nice -n -10 npx pm2 restart ecosystem.config.cjs
     ```
     To make sure PM2 starts automatically on server reboot:
     ```bash
     npx pm2 save
     npx pm2 startup
     ``` 
     Then, run `pm2 start ecosystem.config.cjs` to spin up the background process, watch for crashes, and coordinate logging. To save the PM2 configuration so it starts automatically on VM reboot, run `pm2 save`.

### Step E: Enable SSL
1. Go back to your CloudPanel Site Dashboard -> **SSL / TLS**.
2. Assuming your DNS properly points to the server IP and has successfully propagated, click **Issue Certificate** (Let's Encrypt). This puts a secure padlock on your site!

---

## 🔄 5. How to Rebuild & Redeploy on Updates

When you make changes to the code (whether changing layouts, styling, times, schedules, voice options, or bot rules), you need to rebuild the assets and restart the application so that the running server operates your new code.

Here are the standard steps to apply your updates:

### Method A: Building Directly on the Server (SSH Terminal)
If you write code directly on the server or use Git:
1. **SSH** into your server and switch to the site user:
   ```bash
   su - secretary.mafia.anvorte.com
   ```
2. Navigate to your project folder:
   ```bash
   cd htdocs/secretary.mafia.anvorte.com/
   ```
3. Pull/upload your updated code files (e.g. `src/` folder updates, `server.ts` updates).
4. **Compile the fresh assets & package:**
   ```bash
   npm run build
   ```
   *(This builds all updated index files and compiles `server.ts` into `dist/server.cjs`)*.
5. **Restart the server process** to load your changes:
   - **Using PM2 (with high priority):**
     ```bash
     nice -n -10 pm2 restart ecosystem.config.cjs
     ```
     *(If pm2 commands require npx prefix, run: `nice -n -10 npx pm2 restart ecosystem.config.cjs`)*.
   - **Using CloudPanel UI:** In your Node.js site settings panel, click **Restart App**.

---

### Method B: Pre-Building Locally (Local Zip Upload)
If you prefer building and testing on your development machine before uploading files:
1. Run the build command on your local computer to bundle everything into `./dist`:
   ```bash
   npm run build
   ```
2. Compress your project folder into a `.zip` file. **Make sure your `.zip` includes the newly compiled `./dist` folder** (which contains high-performance frontend files and the unified `dist/server.cjs` backend bundle).
3. Log into CloudPanel, open the **File Manager**, and navigate to your site's root directory (`htdocs/secretary.mafia.anvorte.com/`).
4. **Upload** and **extract** the updated zip, letting it replace the older files.
5. **Restart the server process** to run the fresh bundle:
   - **Using PM2 (with high priority):**
     ```bash
     nice -n -10 pm2 restart ecosystem.config.cjs
     ```
   - **Using CloudPanel UI:** Open your Node.js Site configuration and click **Restart App**.

---

🎉 Your CloudPanel server will now be continuously operating the React Schedule Board while running the Discord background engine 24/7.
