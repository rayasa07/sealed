"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      theme="dark"
      toastOptions={{
        style: {
          background: "rgb(24 24 27)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgb(244 244 245)",
        },
      }}
    />
  );
}
