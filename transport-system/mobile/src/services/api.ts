import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { EnquiryResponse, Enquiry, QuoteResponse, ApiError } from '@/types';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';

// Web-compatible storage
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

const storage = Platform.OS === 'web' ? webStorage : SecureStore;

const SESSION_KEY = 'bt_session_key';
const TOKENS_KEY = 'bt_enquiry_tokens';

class MobileApiClient {
  private client: AxiosInstance;
  private sessionKey: string | null = null;
  private enquiryTokens: Map<string, string> = new Map();

  constructor() {
    this.client = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    this.setupInterceptors();
    this.loadSession();
  }

  private setupInterceptors() {
    this.client.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Add session key for guest tracking
        if (this.sessionKey) {
          config.headers['X-Session-Key'] = this.sessionKey;
        }

        // Add enquiry token for specific enquiry access
        const url = config.url || '';
        const enquiryMatch = url.match(/\/enquiries\/([^\/]+)/);
        if (enquiryMatch) {
          const enquiryIdOrNumber = enquiryMatch[1];
          const token = this.enquiryTokens.get(enquiryIdOrNumber);
          if (token) {
            config.headers['X-Enquiry-Token'] = token;
          }
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<ApiError>) => {
        // Handle network errors
        if (!error.response) {
          if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            error.message = 'Request timed out. Please check your connection and try again.';
          } else {
            error.message = 'Network error. Please check your connection and try again.';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async loadSession() {
    try {
      const sessionKey = await storage.getItemAsync(SESSION_KEY);
      if (sessionKey) {
        this.sessionKey = sessionKey;
      } else {
        this.sessionKey = this.generateSessionKey();
        await storage.setItemAsync(SESSION_KEY, this.sessionKey);
      }

      // Load stored enquiry tokens
      const storedTokens = await storage.getItemAsync(TOKENS_KEY);
      if (storedTokens) {
        const parsed = JSON.parse(storedTokens);
        this.enquiryTokens = new Map(Object.entries(parsed));
      }
    } catch (error) {
      console.warn('Failed to load session:', error);
      this.sessionKey = this.generateSessionKey();
    }
  }

  private generateSessionKey(): string {
    return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }

  private async saveEnquiryTokens() {
    try {
      const obj = Object.fromEntries(this.enquiryTokens);
      await storage.setItemAsync(TOKENS_KEY, JSON.stringify(obj));
    } catch (error) {
      console.warn('Failed to save enquiry tokens:', error);
    }
  }

  setEnquiryToken(enquiryNumber: string, token: string) {
    this.enquiryTokens.set(enquiryNumber, token);
    this.saveEnquiryTokens();
  }

  getEnquiryToken(enquiryNumber: string): string | undefined {
    return this.enquiryTokens.get(enquiryNumber);
  }

  clearEnquiryToken(enquiryNumber: string) {
    this.enquiryTokens.delete(enquiryNumber);
    this.saveEnquiryTokens();
  }

  // Enquiry API
  async createEnquiry(payload: Record<string, any>): Promise<EnquiryResponse> {
    const response = await this.client.post<EnquiryResponse>('/enquiries', payload);
    
    // Store the enquiry token for guest access
    const data = response.data.data;
    if (data.enquiry_token && data.enquiryNumber) {
      this.setEnquiryToken(data.enquiryNumber, data.enquiry_token);
    }
    
    return response.data;
  }

  async getEnquiry(idOrNumber: string): Promise<{ success: boolean; data: Enquiry }> {
    const response = await this.client.get<{ success: boolean; data: Enquiry }>(
      `/enquiries/${encodeURIComponent(idOrNumber)}`
    );
    return response.data;
  }

  async getQuote(idOrNumber: string): Promise<QuoteResponse> {
    const response = await this.client.get<QuoteResponse>(
      `/enquiries/${encodeURIComponent(idOrNumber)}/quote`
    );
    return response.data;
  }

  async acceptQuote(idOrNumber: string): Promise<{ success: boolean; data: { enquiry: Enquiry; booking: any } }> {
    const response = await this.client.post(
      `/enquiries/${encodeURIComponent(idOrNumber)}/accept`,
      {}
    );
    return response.data;
  }

  async rejectQuote(idOrNumber: string, reason?: string): Promise<{ success: boolean; data: any }> {
    const response = await this.client.post(
      `/enquiries/${encodeURIComponent(idOrNumber)}/reject`,
      { reason }
    );
    return response.data;
  }

  async cancelEnquiry(idOrNumber: string, reason?: string): Promise<{ success: boolean; data: any }> {
    const response = await this.client.post(
      `/enquiries/${encodeURIComponent(idOrNumber)}/cancel`,
      { reason }
    );
    return response.data;
  }

  async getCustomerCare(enquiryNumber?: string): Promise<{ success: boolean; data: any }> {
    const response = await this.client.get('/enquiries/config/customer-care', {
      params: enquiryNumber ? { enquiry_number: enquiryNumber } : {},
    });
    return response.data;
  }

  // Price calculation
  async calculatePrice(data: {
    pickup_city: string;
    drop_city: string;
    vehicle_type: string;
  }): Promise<{ success: boolean; data: { distance_km: number; estimated_price: number; rate_per_km: number } }> {
    const response = await this.client.post('/calculate-price', data);
    return response.data;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.get('/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

export const api = new MobileApiClient();
export default api;