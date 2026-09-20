import type { ReactNode } from "react";

export const metadata = {
  title: "Cour",
  description: "Episode-level anime logging, reviews and discussion.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
