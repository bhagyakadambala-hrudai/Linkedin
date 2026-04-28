
'use client';

import dynamic from 'next/dynamic';
import React from 'react';

// Dynamically import the SPA App component with SSR disabled
// This is necessary because the SPA uses HashRouter and window objects
const App = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return <App />;
}
