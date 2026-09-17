import dotenv from 'dotenv';
import path from 'path';

// Must run before any test file imports the app/prisma client, so the
// embedded-postgres connection string from global-setup is what Prisma sees.
dotenv.config({ path: path.join(__dirname, '.env.test.local'), override: true });

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'bulamu_test_jwt_secret';
process.env.FRONTEND_URL = 'http://localhost:3000';

// Prisma auto-loads apps/backend/.env, which in local dev holds real SMTP
// credentials - without this, tests would send real email through the real
// provider (and once did: a test run tripped Hostinger's outbound rate
// limit, which made sendMail() throw and took down unrelated routes that
// happened to send a notification email). Force mailer.ts's
// getTransporter() down the "not configured" path in every test run.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASSWORD;
