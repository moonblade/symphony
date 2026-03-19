import { render } from 'preact';
import { App } from './App.js';
import { initTheme } from './hooks/useTheme.js';

// Apply theme immediately to prevent flash of wrong theme
initTheme();

const root = document.getElementById('app');
if (root) {
  render(<App />, root);
}
