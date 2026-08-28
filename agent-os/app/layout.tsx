import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { Providers } from "@/components/Providers";
import { SerwistProvider } from "./serwist-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentOS Workspace",
  description: "Persistent browser workspace for projects and terminals",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AgentOS",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
        {/*
          The refraction field for Liquid Glass. Defined once, referenced by
          .glass-refract on the one or two hero surfaces per screen — the
          background *bends* at their edges rather than only blurring. It is
          Chromium-only as a backdrop input, so everything else degrades to
          clean glass via the @supports guard in liquid-glass.css.
        */}
        <svg
          aria-hidden="true"
          focusable="false"
          width="0"
          height="0"
          style={{ position: "absolute" }}
        >
          <filter
            id="lg-refraction"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.012"
              numOctaves="2"
              seed="4"
              result="noise"
            />
            <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="soft"
              scale="14"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </svg>

        <SerwistProvider swUrl="/serwist/sw.js">
          <Providers>{children}</Providers>
        </SerwistProvider>
        {/* Toasts are floating chrome: thick glass, capsule-adjacent corners,
            and set in the system face rather than shouted in mono. */}
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{
            className:
              "!glass-thick !glass-float !border-0 !text-foreground !rounded-2xl !text-[0.8125rem] !gap-3 !px-4 !py-3",
            classNames: {
              description: "!text-muted-foreground !text-[0.75rem]",
              closeButton:
                "!bg-[var(--fill-2)] !border-0 !text-muted-foreground hover:!text-foreground",
              actionButton:
                "!bg-primary !text-primary-foreground !rounded-lg !text-[0.75rem] !font-medium",
              cancelButton:
                "!bg-[var(--fill-2)] !text-foreground !rounded-lg !text-[0.75rem]",
            },
          }}
        />
      </body>
    </html>
  );
}
