import { useState, useEffect, useCallback } from 'preact/hooks';
import type { ThemeMode } from '../types.js';
import { api } from '../api.js';

type ResolvedTheme = 'light' | 'dark';

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme): void {
  const html = document.documentElement;
  if (resolved === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const [loading, setLoading] = useState(true);

  const resolveTheme = useCallback((mode: ThemeMode): ResolvedTheme => {
    if (mode === 'system') {
      return getSystemTheme();
    }
    return mode;
  }, []);

  useEffect(() => {
    api.getSettings()
      .then((settings) => {
        const savedTheme = settings.theme ?? 'system';
        setTheme(savedTheme);
        const resolved = resolveTheme(savedTheme);
        setResolvedTheme(resolved);
        applyTheme(resolved);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [resolveTheme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      const newResolved = e.matches ? 'dark' : 'light';
      setResolvedTheme(newResolved);
      applyTheme(newResolved);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  const setThemeMode = useCallback(async (newTheme: ThemeMode) => {
    setTheme(newTheme);
    const resolved = resolveTheme(newTheme);
    setResolvedTheme(resolved);
    applyTheme(resolved);

    try {
      await api.updateSettings({ theme: newTheme });
    } catch (err) {
      console.error('Failed to save theme setting', err);
    }
  }, [resolveTheme]);

  return {
    theme,
    resolvedTheme,
    setTheme: setThemeMode,
    loading,
  };
}

export function initTheme(): void {
  const savedTheme = localStorage.getItem('symphony-theme') as ThemeMode | null;
  let resolved: ResolvedTheme;
  
  if (savedTheme === 'light' || savedTheme === 'dark') {
    resolved = savedTheme;
  } else {
    resolved = getSystemTheme();
  }
  
  applyTheme(resolved);
}
