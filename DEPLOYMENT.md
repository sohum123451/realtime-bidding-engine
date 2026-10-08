# Production Hosting & Deployment Guide

This guide details how to host the **3D Live Auction Client on Vercel** and the **Real-Time Auction & WebSocket Engine on AWS**.

---

## Architecture Overview

```
 [ Browser Clients ]
         │
         ├─── Static Assets & 3D Three.js ────> [ Vercel Edge CDN ]
         │                                       (client/dist)
         │
         └─── REST API & WebSockets (/ws) ────> [ AWS Backend ]
                                                 - EC2 / ECS Fargate / App Runner
                                                 - Fastify Node 20 + ws
                                                 - PostgreSQL 16 (Raw SQL, FOR UPDATE)
```

---

## 1. Hosting the Backend on AWS

### Option A: AWS EC2 (Fastest & Simplest)

1. **Launch an EC2 Instance**:
   - AMI: Ubuntu 22.04 LTS or Amazon Linux 2023.
   - Instance Type: `t3.small` or `t3.medium`.
   - Security Group inbound rules:
     - `SSH (22)` from your IP
     - `HTTP (80)` from `0.0.0.0/0`
     - `HTTPS (443)` from `0.0.0.0/0`
     - `Custom TCP (3000)` from `0.0.0.0/0` (or proxy via port 80/443 with Nginx)

2. **Deploy with 1-Command Script**:
   SSH into your EC2 instance and run:
   ```bash
   git clone <YOUR_GIT_REPOSITORY_URL> auction-engine
   cd auction-engine
   chmod +x aws/deploy-ec2.sh
   ./aws/deploy-ec2.sh
   ```

3. **(Optional) Configure Nginx with SSL**:
   Copy the Nginx configuration:
   ```bash
   sudo cp aws/nginx-auction.conf /etc/nginx/sites-available/auction.conf
   sudo ln -s /etc/nginx/sites-available/auction.conf /etc/nginx/sites-enabled/
   sudo certbot --nginx -d your-domain.com
   sudo systemctl restart nginx
   ```

---

### Option B: AWS ECS Fargate + RDS PostgreSQL (Fully Managed)

1. **Amazon RDS for PostgreSQL**:
   - Create an RDS PostgreSQL 16 instance.
   - Set database name to `auction_db`.
   - Copy the connection endpoint: `postgres://user:password@rds-host:5432/auction_db`.

2. **Build & Push Docker Image to ECR**:
   ```bash
   aws ecr create-repository --repository-name auction-server
   docker build -t auction-server ./server
   docker tag auction-server:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/auction-server:latest
   docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/auction-server:latest
   ```

3. **Register Task Definition & Launch Service**:
   Use `aws/ecs-task-definition.json` to register the task in AWS ECS and attach an Application Load Balancer with WebSocket support enabled.

---

## 2. Hosting the Frontend on Vercel

The frontend is a Vite + Three.js application located in the `client/` workspace.

### Step 1: Connect to Vercel

1. Push your changes to GitHub / GitLab / Bitbucket.
2. Go to [vercel.com](https://vercel.com) and click **"Add New Project"**.
3. Import your repository.

### Step 2: Configure Build Settings

- **Framework Preset**: `Vite`
- **Root Directory**: `client` (or keep root with `client/dist` configured in `vercel.json`)
- **Build Command**: `npm run build`
- **Output Directory**: `dist`

### Step 3: Add Environment Variables in Vercel

In the Vercel project settings under **Environment Variables**, add:

| Key | Value (Example) | Description |
|---|---|---|
| `VITE_API_URL` | `https://api.yourdomain.com` (or `http://<EC2_IP>:3000`) | URL of your AWS backend server |
| `VITE_WS_URL` | `wss://api.yourdomain.com/ws` (or `ws://<EC2_IP>:3000/ws`) | WebSocket URL of your AWS backend |

Click **Deploy**!

---

## 3. Post-Deployment Verification

### 1. Health Check
```bash
curl https://<YOUR_AWS_HOST>/health
# Expected: {"status":"ok","timestamp":"..."}
```

### 2. Live Catalog & Admin Verification
```bash
curl https://<YOUR_AWS_HOST>/admin/items
```

### 3. Open Client in Browser
1. Visit your Vercel deployment URL (e.g. `https://auction-client.vercel.app`).
2. Verify the 3D room loads smoothly with animated bidders and mechanical odometer numerals.
3. Open the **"👤 Account"** modal:
   - Select any VIP seat (Alice, Bob, Claire, etc.) or register your own account.
4. Open the **"🏛️ Curator Deck"** modal:
   - Check the **"Up Next on Auction Block"** card.
   - Click **"🚀 Launch Lot to Auction Block Now"** to transition the room to the next item!
