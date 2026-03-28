import React from 'react';
import ReactDOM from 'react-dom/client';
import RiskScanner from './RiskScanner.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RiskScanner />
    </ErrorBoundary>
  </React.StrictMode>
);
