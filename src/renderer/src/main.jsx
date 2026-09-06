import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import DeskGate from './DeskGate.jsx';
import { installDeskApi } from './lib/desk.js';
import './styles/index.css';

// In the installed application this does nothing: the preload script has
// already put `window.api` on the window. In a browser it puts the same API
// there, over the network instead of over Electron IPC, and everything below
// this line is identical either way — which is the entire point.
installDeskApi();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <DeskGate>
        <App />
      </DeskGate>
    </HashRouter>
  </React.StrictMode>
);
