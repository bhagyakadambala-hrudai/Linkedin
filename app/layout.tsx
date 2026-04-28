
import React from 'react';

export const metadata = {
  title: 'AutoLink AI - LinkedIn Automation',
  description: 'An AI-Agent driven SaaS for automating LinkedIn content creation and scheduling.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{__html: `
          body { font-family: 'Inter', sans-serif; }
          .animate-fade-in { animation: fadeIn 0.3s ease-in-out; }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
