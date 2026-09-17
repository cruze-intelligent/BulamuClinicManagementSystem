import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bulamu.ug';

// Only the public landing + legal pages are worth indexing - everything else
// is behind login (no session, no useful content for a crawler to render,
// same reasoning the sidebar's noSidebarPages list uses for those routes).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/dashboard',
        '/patients',
        '/appointments',
        '/consultations',
        '/inventory',
        '/invoices',
        '/lab',
        '/referrals',
        '/reports',
        '/users',
        '/sync-activity',
        '/chw-visit',
        '/super-admin',
        '/billing',
        '/auth/reset-password',
        '/offline',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
