import type { Metadata, Viewport } from "next";
import "./globals.css";
import ClientLayout from "./client-layout";
import { ThemeProvider } from "@/lib/theme-provider";
import { SidebarProvider } from "@/lib/sidebar-provider";

// Runs before hydration so the correct theme class is present on first paint -
// avoids a flash of the wrong theme when the stored preference is "dark".
const themeInitScript = `(function(){try{var t=localStorage.getItem('bulamu-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Bulamu Medical Facility OS",
  description: "Offline-first medical facility management system for Uganda",
  applicationName: "Bulamu",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Bulamu",
  },
  icons: {
    icon: "/icons/icon.svg",
    apple: "/icons/icon.svg",
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
