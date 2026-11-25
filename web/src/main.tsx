import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/newsreader/wght.css';
import '@fontsource-variable/newsreader/wght-italic.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('No #root element; index.html is out of sync with main.tsx.');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
