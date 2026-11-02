import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // When the GitHub popup finishes, refresh the session without a reload.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'uxer-auth' && e.data.ok) {
        api
          .me()
          .then(setUser)
          .catch(() => setUser(null));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const login = () => {
    const popup = window.open(
      '/api/auth/github?popup=1',
      'uxer-github-auth',
      'width=600,height=700,popup=yes'
    );
    if (!popup) {
      // Popup blocked: fall back to a full-page redirect.
      window.location.href = '/api/auth/github';
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      window.location.href = '/login';
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
