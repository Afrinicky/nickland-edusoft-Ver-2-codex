// Nickland Edusoft — one screen failing is not the office failing.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every screen in this application renders inside this. Without it, a single
// unhandled error anywhere in a screen unmounts React's whole tree, and what
// the school sees is a WHITE PAGE — no sidebar, no menu, no way back, and
// nothing said. That is what a bursar met when the canteen dashboard was
// handed an error instead of its figures: the office appeared to be gone.
//
// A screen can still fail. What it can no longer do is take the building with
// it: the sidebar, the topbar and every other screen keep working, this one
// says what happened, and "Try again" re-renders it — which is enough when the
// cause was a query that failed once.
//
// The message is shown, not swallowed. A school telephoning for help can read
// it out, and that sentence is usually the whole diagnosis.

import React from 'react';

export default class ScreenBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, attempt: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // The host's log is where a screen's failure belongs as well, so that
    // somebody reading the server later sees it without being told.
    try { console.error('[screen]', error, info && info.componentStack); } catch (_) {}
  }

  retry = () => this.setState((s) => ({ error: null, info: null, attempt: s.attempt + 1 }));

  render() {
    if (!this.state.error) return <div key={this.state.attempt}>{this.props.children}</div>;

    const message = (this.state.error && this.state.error.message) || String(this.state.error);

    return (
      <div style={{ padding: 32, maxWidth: 720 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>This screen could not be shown</h2>
        <p style={{ margin: '0 0 16px', opacity: 0.8 }}>
          The rest of the office is still working — use the menu to carry on, or try this
          screen again. Nothing has been lost.
        </p>

        <pre style={{
          background: 'rgba(127,127,127,0.12)', padding: 12, borderRadius: 8,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, margin: '0 0 16px',
        }}>{message}</pre>

        <button className="btn btn-primary" onClick={this.retry}>Try again</button>

        {this.state.info && this.state.info.componentStack && (
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', opacity: 0.7 }}>Details for support</summary>
            <pre style={{
              background: 'rgba(127,127,127,0.12)', padding: 12, borderRadius: 8,
              whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8, maxHeight: 260, overflow: 'auto',
            }}>{this.state.info.componentStack}</pre>
          </details>
        )}
      </div>
    );
  }
}
