// PixiJS's WebGL renderer uses new Function() internally, which the server's
// strict CSP (script-src 'self') forbids. This official module swaps in a
// CSP-safe implementation; it must load before any Pixi renderer is created.
import 'pixi.js/unsafe-eval';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthGate } from './ui/AuthGate.js';

createRoot(document.getElementById('root')!).render(<AuthGate><App /></AuthGate>);
