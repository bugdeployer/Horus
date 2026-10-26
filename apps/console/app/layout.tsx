import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Horus · Runtime console",
  description:
    "Local runtime capture, block inspection, and execution tracing. No LLM required.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{document.documentElement.dataset.theme=localStorage.getItem("horus.theme")==="light"?"light":"dark"}catch{}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
