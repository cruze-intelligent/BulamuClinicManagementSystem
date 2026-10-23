import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import ClientLayout from "./client-layout";
import { ThemeProvider } from "@/lib/theme-provider";
import { SidebarProvider } from "@/lib/sidebar-provider";

// Bundled at build time and served from bulamu.site itself - no request to
// Google when a page loads, and it keeps working offline once cached.
const brandFont = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-brand" });

// Runs before hydration so the correct theme class is present on first paint -
// avoids a flash of the wrong theme when the stored preference is "dark".
const themeInitScript = `(function(){try{var t=localStorage.getItem('bulamu-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

// The API sleeps after a quiet spell and takes up to a minute to wake. Every
// page wakes it the moment it starts loading - before the app itself has even
// downloaded - at most once every few minutes per tab, so by the time someone
// signs in or a page asks for data it is usually up. /health/connection also
// wakes the database (which sleeps too) with a single "SELECT 1".
const API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const wakeApiScript = API_URL
  ? `(function(){try{var k="bulamu-api-woken",t=+(sessionStorage.getItem(k)||0);if(Date.now()-t<240000)return;sessionStorage.setItem(k,String(Date.now()));fetch(${JSON.stringify(API_URL)}+"/health/connection",{cache:"no-store"}).catch(function(){});}catch(e){}})();`
  : "";

// Public GA measurement ID - not a secret (Google Analytics tags are always
// visible in page source), but kept out of local dev traffic below so
// day-to-day testing doesn't pollute real analytics.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-3BR26WNYPE";

// Set NEXT_PUBLIC_SITE_URL to the live Hostinger domain once it's assigned -
// needed for absolute OG/canonical URLs. Falls back to a placeholder so local
// builds don't break before that domain exists.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bulamu.site";
const SITE_TITLE = "Bulamu - clinic management for Uganda";
const SITE_DESCRIPTION =
  "Clinic management for Ugandan health facilities - clinics, Health Centre II/III/IV, hospitals, laboratories, pharmacies and outreach teams. Patient records, appointments, prescriptions, lab results, stock, billing and HMIS 105 reporting, in one system that keeps working without internet.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | Bulamu",
  },
  description: SITE_DESCRIPTION,
  applicationName: "Bulamu",
  keywords: [
    "clinic management system Uganda",
    "offline-first EMR",
    "health centre software Uganda",
    "HMIS 105 reporting",
    "FHIR Uganda",
    "rural health facility software",
    "Uganda hospital management system",
  ],
  authors: [{ name: "Cruze Intelligent Systems (U) Ltd" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bulamu",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: "website",
    locale: "en_UG",
    url: SITE_URL,
    siteName: "Bulamu",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: "/icons/icon.svg", width: 512, height: 512, alt: "Bulamu" }],
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/icons/icon.svg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Open the connection to the API early: saves the DNS, TCP and TLS set-up (half a second or more on mobile) on the first request. */}
        {API_URL && <link rel="preconnect" href={API_URL} crossOrigin="anonymous" />}
        {API_URL && <link rel="dns-prefetch" href={API_URL} />}
        {wakeApiScript && <script dangerouslySetInnerHTML={{ __html: wakeApiScript }} />}
        {/* Google's own snippet, in <head> of the page itself: Search Console
            verifies the site by finding it there (a tag added later by
            JavaScript is invisible to it). async - it downloads alongside the
            page and never holds up showing it. */}
        {process.env.NODE_ENV === "production" && (
          <>
            <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`} />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_MEASUREMENT_ID}');`,
              }}
            />
          </>
        )}
      </head>
      <body className={`${brandFont.variable} antialiased`}>
        <ThemeProvider>
          <SidebarProvider>
            <ClientLayout>
              {children}
            </ClientLayout>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
