import { io } from 'socket.io-client';

function getBackendUrl(): string {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  // Vite proxies Socket.IO in development; Express serves it in production.
  return window.location.origin;
}

export const socket = io(getBackendUrl(), {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 10,
});
