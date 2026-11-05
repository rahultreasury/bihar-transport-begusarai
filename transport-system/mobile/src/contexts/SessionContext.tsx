import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { SessionData } from '@/types';

interface SessionContextType {
  sessionKey: string;
  enquiryTokens: Record<string, string>;
  setEnquiryToken: (enquiryNumber: string, token: string) => Promise<void>;
  getEnquiryToken: (enquiryNumber: string) => string | undefined;
  clearEnquiryToken: (enquiryNumber: string) => Promise<void>;
  clearAllTokens: () => Promise<void>;
  loaded: boolean;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const Provider = SessionContext.Provider;

// Web-compatible storage using localStorage
const webStorage = {
  async getItemAsync(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItemAsync(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore quota/private mode errors
    }
  },
  async deleteItemAsync(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore errors
    }
  },
};

// Unified storage interface
const storage = Platform.OS === 'web' ? webStorage : SecureStore;

const SESSION_KEY = 'bt_session_key';
const TOKENS_KEY = 'bt_enquiry_tokens';

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionKey, setSessionKey] = useState<string>('');
  const [enquiryTokens, setEnquiryTokens] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  console.log('[SessionProvider] Provider mounted, loaded:', loaded);

  useEffect(() => {
    console.log('[SessionProvider] useEffect triggered, starting loadSession');
    loadSession();
  }, []);

  const loadSession = async () => {
    console.log('[SessionProvider] loadSession started');
    try {
      const storedSessionKey = await storage.getItemAsync(SESSION_KEY);
      console.log('[SessionProvider] storedSessionKey:', storedSessionKey ? 'found' : 'not found');
      if (storedSessionKey) {
        setSessionKey(storedSessionKey);
      } else {
        const newSessionKey = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
        await storage.setItemAsync(SESSION_KEY, newSessionKey);
        setSessionKey(newSessionKey);
      }

      const storedTokens = await storage.getItemAsync(TOKENS_KEY);
      console.log('[SessionProvider] storedTokens:', storedTokens ? 'found' : 'not found');
      if (storedTokens) {
        try {
          setEnquiryTokens(JSON.parse(storedTokens));
        } catch {
          // Ignore parse errors
        }
      }
    } catch (error) {
      console.warn('Failed to load session:', error);
      const newSessionKey = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      setSessionKey(newSessionKey);
    } finally {
      console.log('[SessionProvider] loadSession complete, setting loaded=true');
      setLoaded(true);
    }
  };

  const setEnquiryToken = async (enquiryNumber: string, token: string) => {
    const newTokens = { ...enquiryTokens, [enquiryNumber]: token };
    setEnquiryTokens(newTokens);
    try {
      await storage.setItemAsync(TOKENS_KEY, JSON.stringify(newTokens));
    } catch (error) {
      console.warn('Failed to save enquiry token:', error);
    }
  };

  const getEnquiryToken = (enquiryNumber: string): string | undefined => {
    return enquiryTokens[enquiryNumber];
  };

  const clearEnquiryToken = async (enquiryNumber: string) => {
    const newTokens = { ...enquiryTokens };
    delete newTokens[enquiryNumber];
    setEnquiryTokens(newTokens);
    try {
      await storage.setItemAsync(TOKENS_KEY, JSON.stringify(newTokens));
    } catch (error) {
      console.warn('Failed to clear enquiry token:', error);
    }
  };

  const clearAllTokens = async () => {
    setEnquiryTokens({});
    try {
      await storage.deleteItemAsync(TOKENS_KEY);
    } catch (error) {
      console.warn('Failed to clear all tokens:', error);
    }
  };

  // Always provide the context - use default values during loading
  return (
    <SessionContext.Provider
      value={{
        sessionKey,
        enquiryTokens,
        setEnquiryToken,
        getEnquiryToken,
        clearEnquiryToken,
        clearAllTokens,
        loaded,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}