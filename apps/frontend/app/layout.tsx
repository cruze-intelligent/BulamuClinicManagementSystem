import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import ClientLayout from "./client-layout";
import { ThemeProvider } from "@/lib/theme-provider";
import { SidebarProvider } from "@/lib/sidebar-provider";

// Runs before hydration so the correct theme class is present on first paint -
// avoids a flash of the wrong theme when the stored preference is "dark".
const themeInitScript = `(function(){try{var t=localStorage.getItem('bulamu-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

// Public GA measurement ID - not a secret (Google Analytics tags are always
// visible in page source), but kept out of local dev traffic below so
// day-to-day testing doesn't pollute real analytics.
const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "G-3BR26WNYPE";

// Set NEXT_PUBLIC_SITE_URL to the live Hostinger domain once it's assigned -
// needed for absolute OG/canonical URLs. Falls back to a placeholder so local
// builds don't break before that domain exists.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://bulamu.site";
const SITE_TITLE = "Bulamu Medical Facility OS";
const SITE_DESCRIPTION =
  "Offline-first clinic management system for Ugandan medical facilities - clinics, Health Centre II/III/IV, hospitals, laboratories, pharmacies, mobile units, and community outreach teams. Patient records, appointments, prescriptions, billing, and HMIS 105 / FHIR reporting that keeps working without internet.";

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
      </head>
      <body className="antialiased">
        {process.env.NODE_ENV === "production" && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');`}
            </Script>
          </>
        )}
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
