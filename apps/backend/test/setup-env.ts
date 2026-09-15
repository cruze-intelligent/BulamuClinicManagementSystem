import dotenv from 'dotenv';
import path from 'path';

// Must run before any test file imports the app/prisma client, so the
// embedded-postgres connection string from global-setup is what Prisma sees.
dotenv.config({ path: path.join(__dirname, '.env.test.local'), override: true });

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'bulamu_test_jwt_secret';
process.env.FRONTEND_URL = 'http://localhost:3000';
