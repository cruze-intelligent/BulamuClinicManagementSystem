# Deployment Guide - Bulamu Rural Health System (PWA + Cloud API)

This guide provides deployment instructions for hosting the **Bulamu Clinic Management System** across both cloud platforms and edge micro-servers (e.g. Raspberry Pi in deep-rural Health Centre II/III facilities).

---

## 1. Hosting Architecture Overview

- **Frontend (Installable PWA)**: Hosted on Vercel, Netlify, Cloudflare Pages, or custom domain web server. Endpoints download and cache app shell via Service Worker (`sw.js`) and store patient data in browser IndexedDB.
- **Backend (API & Sync Engine)**: Fastify + Prisma Node.js backend hosted on **Laravel Cloud**, **Railway**, **Render**, **Fly.io**, or **Supabase** (PostgreSQL).
- **Edge Micro-Server (Tier 2 Clinic)**: Single-board computer (Raspberry Pi 4/5) running Docker Compose locally inside solar-powered clinic intranet.

---

## 2. Cloud Deployment Instructions

### A. Deploying Backend to Laravel Cloud / Railway / Render

1. **Database Setup (PostgreSQL)**:
   - Provision a PostgreSQL instance (e.g., Supabase Free Tier, Railway Postgres, Render Postgres).
   - Obtain database connection string: `DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"`

2. **Backend Configuration**:
   - Set Environment Variables:
     ```env
     PORT=4000
     DATABASE_URL=postgresql://...
     JWT_SECRET=your_secure_secret_key
     FRONTEND_URL=https://your-custom-clinic-pwa-domain.com
     ```
   - Build & Migration Commands:
     ```bash
     cd apps/backend
     npx prisma migrate deploy
     npm run build
     npm start
     ```

3. **Endpoints**:
   - `/health` - Service health status
   - `/sync/push` - Background LWW delta mutation receiver
   - `/sync/pull` - Catch-up delta query
   - `/reports/hmis-105/:clinicId` - Ministry of Health Uganda Outpatient Monthly Report
   - `/reports/fhir/patients/:clinicId` - HL7 FHIR R4 JSON Bundle Export

---

### B. Deploying Frontend PWA to Custom Site (Vercel / Netlify / Cloudflare)

1. Set Environment Variable:
   ```env
   NEXT_PUBLIC_API_URL=https://your-backend-api-domain.com
   ```
2. Build Command:
   ```bash
   npm --prefix apps/frontend run build
   ```
3. Custom Domain & HTTPS:
   - Configure HTTPS SSL certificate (required for PWA Service Worker & Web App Manifest installation).
   - Mobile users on Android/iOS will receive the "Install App" prompt for offline usage.

---

## 3. Edge Micro-Server Deployment (Raspberry Pi / Health Centre II & III)

In deep-rural facilities lacking reliable cellular internet, deploy a local micro-server:

```bash
git clone https://github.com/your-repo/ras.git
cd ras
docker-compose up -d --build
```

- Clinic staff connect Android tablets via Wi-Fi to the local micro-server IP.
- Data writes directly to local IndexedDB and syncs to local micro-server.
- When 3G/4G cellular signal is available, micro-server automatically pushes delta updates to the central national cloud DB.

