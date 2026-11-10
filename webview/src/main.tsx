import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';
import { Sidebar } from './Sidebar';
import './styles/app.css';

const view = document.body.dataset.view;
const tab = document.body.dataset.tab ?? 'overview';
const root = createRoot(document.getElementById('root')!);
root.render(<StrictMode>{view === 'sidebar' ? <Sidebar /> : <Dashboard initialTab={tab} />}</StrictMode>);
