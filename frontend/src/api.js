import axios from 'axios';

export const TOKEN_KEY = 'quiz_tanhoa.token';

export const api = axios.create({
  baseURL: __API_BASE_URL__,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function isUnauthorized(error) {
  return axios.isAxiosError(error) && error.response?.status === 401;
}

export function isSessionRejected(error) {
  return axios.isAxiosError(error)
    && (error.response?.status === 401 || error.response?.status === 403);
}

export function isConnectionError(error) {
  return axios.isAxiosError(error)
    && (!error.response || [502, 503, 504].includes(error.response.status));
}
