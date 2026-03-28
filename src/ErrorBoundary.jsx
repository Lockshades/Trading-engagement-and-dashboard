import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error Boundary caught an error:', error);
    console.error('Error info:', errorInfo);
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '20px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          backgroundColor: '#f5f5f5'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '40px',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
            textAlign: 'center',
            maxWidth: '500px'
          }}>
            <h1 style={{
              color: '#d32f2f',
              margin: '0 0 16px 0',
              fontSize: '24px'
            }}>
              Something went wrong
            </h1>
            <p style={{
              color: '#666',
              margin: '0 0 24px 0',
              lineHeight: '1.5'
            }}>
              An unexpected error occurred while rendering the application.
              Please try again or contact support if the problem persists.
            </p>
            {this.state.error && (
              <pre style={{
                backgroundColor: '#f5f5f5',
                padding: '12px',
                borderRadius: '4px',
                fontSize: '12px',
                textAlign: 'left',
                overflow: 'auto',
                maxHeight: '150px',
                marginBottom: '24px',
                color: '#d32f2f'
              }}>
                {this.state.error.toString()}
              </pre>
            )}
            <button
              onClick={this.handleRetry}
              style={{
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                padding: '12px 24px',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#1565c0'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#1976d2'}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;