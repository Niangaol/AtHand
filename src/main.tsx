import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { RecordsProvider } from './data/RecordsProvider';
import './styles.css';
import './styles/chart.css';
import './styles/campus.css';
import './styles/auth.css';

// 静态入口 login.html / register.html 直接落到对应页面，应用内跳转仍走 History。
const entry = /\/register(\.html)?$/i.test(window.location.pathname)
  ? '/register'
  : /\/login(\.html)?$/i.test(window.location.pathname)
    ? '/login'
    : '/';
if (entry !== '/' && window.location.pathname !== entry) {
  window.history.replaceState(null, '', entry);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><RecordsProvider><App /></RecordsProvider></BrowserRouter></StrictMode>,
);