import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import { SerwistProvider } from "./serwist-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLIWeb Workspace",
  description: "Persistent browser workspace for projects and terminals",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CLIWeb",
  },
  icons: {
    icon: {
      url: "/branding/cliweb-terminal.svg",
      type: "image/svg+xml",
    },
    apple: "/branding/cliweb-terminal-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#111113",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sent with credentials so the manifest (and so the install icon)
            loads behind an auth proxy such as Cloudflare Access. */}
        <link
          rel="manifest"
          href="/cliweb.webmanifest"
          crossOrigin="use-credentials"
        />
        {/* Theme initialization script - prevents flash of unstyled content */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  // Get theme from localStorage (where next-themes stores it)
                  const theme = localStorage.getItem('theme') || 'dark';
                  const root = document.documentElement;

                  // Handle system theme
                  let actualTheme = theme;
                  if (theme === 'system') {
                    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                    actualTheme = isDark ? 'dark' : 'light';
                  }

                  // Parse compound themes like "dark-warm" or "light-default"
                  const parts = actualTheme.split('-');
                  const mode = parts[0];
                  const variant = parts[1];

                  // Apply theme class
                  root.classList.remove('light', 'dark');
                  root.classList.add(mode === 'dark' || mode === 'light' ? mode : 'dark');

                  // Apply variant as data attribute
                  // "deep" and "default" are base themes - no data attribute needed
                  root.removeAttribute('data-theme-variant');
                  if (variant && variant !== 'default' && variant !== 'deep') {
                    root.setAttribute('data-theme-variant', variant);
                  }
                } catch (e) {
                  // Fallback to dark mode if anything fails
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased">
        <SerwistProvider swUrl="/serwist/sw.js">
          <Providers>{children}</Providers>
        </SerwistProvider>
        {/* Toasts use the same raised surface and small radius as dialogs. */}
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            className:
              "!glass-thick !glass-float !text-foreground !rounded-sm !text-[0.8125rem] !gap-3 !px-4 !py-3",
            classNames: {
              description: "!text-muted-foreground !text-[0.75rem]",
              closeButton:
                "!bg-[var(--fill-2)] !border-0 !text-muted-foreground hover:!text-foreground",
              actionButton:
                "!bg-primary !text-primary-foreground !rounded-sm !text-[0.75rem] !font-medium",
              cancelButton:
                "!bg-[var(--fill-2)] !text-foreground !rounded-sm !text-[0.75rem]",
            },
          }}
        />
      </body>
    </html>
  );
}
