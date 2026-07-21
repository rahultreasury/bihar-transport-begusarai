import { useEffect, useState } from 'react';

function getInitialTheme() {
  const stored = typeof window !== 'undefined' ? localStorage.getItem('admin_theme') : null;
  if (stored === 'dark' || stored === 'light') return stored;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function useAdminTheme() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    localStorage.setItem('admin_theme', theme);
    const root = document.documentElement;
    root.classList.toggle('admin-dark', theme === 'dark');
  }, [theme]);

  return {
    theme,
    themeLabel: theme === 'dark' ? 'Dark' : 'Light',
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    themeClass: theme === 'dark' ? 'admin-dark' : 'admin-light'
  };
}

