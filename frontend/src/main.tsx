import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./app/globals.css";
import { App } from "./App";
import { Providers } from "@/components/Providers";
import { Toaster } from "sonner";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
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
  </StrictMode>,
);
