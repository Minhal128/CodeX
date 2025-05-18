import { io } from 'socket.io-client';

let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

export const initializeSocket = (projectId) => {
  if (!projectId) {
    console.error("Cannot initialize socket: Missing projectId");
    return null;
  }
  
  // Close existing socket if any
  if (socket) {
    socket.disconnect();
  }
  
  // Create new socket connection with error handling
  const socketUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const token = localStorage.getItem('token'); // Get authentication token
  
  socket = io(socketUrl, {
    query: { projectId },
    auth: { token }, // Add token to auth object
    reconnection: true,
    reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
    reconnectionDelay: 2000, // Increased delay for better retry handling
    timeout: 30000, // Increased timeout
    transports: ['polling', 'websocket'] // Try polling first for compatibility
  });
  
  // Error handling with better logging
  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error);
    reconnectAttempts++;
    
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached. Please refresh the page.');
    }
  });
  
  socket.on('connect', () => {
    console.log('Socket connected successfully');
    reconnectAttempts = 0;
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', reason);
  });
  
  return socket;
};

export const sendMessage = (event, data) => {
  if (!socket || !socket.connected) {
    console.error("Cannot send message: Socket not connected");
    return false;
  }
  
  socket.emit(event, data);
  return true;
};

export const receiveMessage = (event, callback) => {
  if (!socket) {
    console.error("Cannot receive messages: Socket not initialized");
    return false;
  }
  
  socket.on(event, callback);
  return true;
};

export const disconnect = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};