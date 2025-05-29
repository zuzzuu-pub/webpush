/**
 * Zuzzuu Service Worker
 * Handles WebSocket connections and push notifications
 */

const CACHE_NAME = 'zuzzuu-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/js/zuzzuu-subscriber.js',
  '/js/zuzzuu-notification.js',
  '/favicon.ico'
];

// WebSocket connection management
let ws = null;
let subscriberId = null;
let isConnected = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
const reconnectDelay = 5000;

// Install event - cache resources
self.addEventListener('install', event => {
  console.log('[SW] Installing service worker');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('[SW] Skip waiting');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});

// Message handling from main thread
self.addEventListener('message', event => {
  const { type, data } = event.data;
  console.log('[SW] Received message:', { type, data });

  switch (type) {
    case 'CONNECT_WEBSOCKET':
      handleConnectWebSocket(data, event.source);
      break;
    case 'DISCONNECT_WEBSOCKET':
      handleDisconnectWebSocket(event.source);
      break;
    case 'SEND_MESSAGE':
      handleSendMessage(data, event.source);
      break;
    default:
      console.log('[SW] Unknown message type:', type);
  }
});

// Handle WebSocket connection
function handleConnectWebSocket(data, source) {
  const { subscriberId: newSubscriberId, wsUrl } = data;
  
  if (isConnected && subscriberId === newSubscriberId) {
    console.log('[SW] Already connected to WebSocket for this subscriber');
    source.postMessage({
      type: 'WEBSOCKET_CONNECTED',
      data: { subscriberId }
    });
    return;
  }

  subscriberId = newSubscriberId;
  
  // Close existing connection if any
  if (ws) {
    ws.close();
  }

  try {
    const fullWsUrl = `${wsUrl}/${subscriberId}`;
    console.log('[SW] Connecting to WebSocket:', fullWsUrl);
    
    ws = new WebSocket(fullWsUrl);
    
    ws.onopen = () => {
      console.log('[SW] WebSocket connected');
      isConnected = true;
      reconnectAttempts = 0;
      
      // Store connection state
      const connectionState = { connected: true, subscriberId };
      source.postMessage({
        type: 'STORE_CONNECTION_STATE',
        data: connectionState
      });
      
      source.postMessage({
        type: 'WEBSOCKET_CONNECTED',
        data: { subscriberId }
      });
      
      // Send initial status
      ws.send(JSON.stringify({
        type: 'status_update',
        status: 'online',
        timestamp: new Date().toISOString()
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[SW] WebSocket message received:', message);
        
        if (message.type === 'notification') {
          // Handle notification
          handleNotification(message, source);
        } else if (message.type === 'heartbeat_response') {
          console.log('[SW] Heartbeat response received');
        }
      } catch (error) {
        console.error('[SW] Error parsing WebSocket message:', error);
      }
    };
    
    ws.onclose = (event) => {
      console.log('[SW] WebSocket closed:', event.code, event.reason);
      isConnected = false;
      
      // Store disconnected state
      const connectionState = { connected: false, subscriberId: null };
      source.postMessage({
        type: 'STORE_CONNECTION_STATE',
        data: connectionState
      });
      
      source.postMessage({
        type: 'WEBSOCKET_DISCONNECTED',
        data: { code: event.code, reason: event.reason }
      });
      
      // Attempt reconnection if not a clean close
      if (event.code !== 1000 && event.code !== 1001 && reconnectAttempts < maxReconnectAttempts) {
        setTimeout(() => {
          reconnectAttempts++;
          console.log(`[SW] Reconnecting attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
          handleConnectWebSocket(data, source);
        }, reconnectDelay);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[SW] WebSocket error:', error);
      source.postMessage({
        type: 'WEBSOCKET_ERROR',
        data: { error: 'WebSocket connection error' }
      });
    };
    
  } catch (error) {
    console.error('[SW] Error creating WebSocket:', error);
    source.postMessage({
      type: 'WEBSOCKET_ERROR',
      data: { error: error.message }
    });
  }
}

// Handle WebSocket disconnection
function handleDisconnectWebSocket(source) {
  console.log('[SW] Disconnecting WebSocket');
  
  if (ws) {
    ws.close(1000, 'User disconnected');
    ws = null;
  }
  
  isConnected = false;
  subscriberId = null;
  reconnectAttempts = 0;
  
  // Store disconnected state
  const connectionState = { connected: false, subscriberId: null };
  source.postMessage({
    type: 'STORE_CONNECTION_STATE',
    data: connectionState
  });
  
  source.postMessage({
    type: 'WEBSOCKET_DISCONNECTED',
    data: { code: 1000, reason: 'User disconnected' }
  });
}

// Handle sending messages through WebSocket
function handleSendMessage(data, source) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
      console.log('[SW] Message sent through WebSocket:', data);
    } catch (error) {
      console.error('[SW] Error sending message:', error);
      source.postMessage({
        type: 'WEBSOCKET_ERROR',
        data: { error: 'Failed to send message' }
      });
    }
  } else {
    console.warn('[SW] WebSocket not connected, cannot send message');
    source.postMessage({
      type: 'WEBSOCKET_ERROR',
      data: { error: 'WebSocket not connected' }
    });
  }
}

// Handle incoming notifications
function handleNotification(notification, source) {
  console.log('[SW] Handling notification:', notification);
  
  // Send notification to main thread
  source.postMessage({
    type: 'NOTIFICATION_RECEIVED',
    data: notification
  });
  
  // Show push notification if permission granted
  if (self.Notification && self.Notification.permission === 'granted') {
    const options = {
      body: notification.message,
      icon: notification.logo_url || notification.image_url || '/favicon.ico',
      badge: notification.logo_url || '/favicon.ico',
      tag: notification.id || 'zuzzuu-notification',
      data: notification,
      requireInteraction: false,
      silent: false
    };
    
    if (notification.image_url) {
      options.image = notification.image_url;
    }
    
    self.registration.showNotification(
      notification.title || 'New Notification',
      options
    );
  }
}

// Handle notification click
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event.notification);
  
  event.notification.close();
  
  const notification = event.notification.data;
  
  // Open URL if provided
  if (notification && notification.url) {
    event.waitUntil(
      clients.openWindow(notification.url)
    );
  } else {
    // Focus existing window or open new one
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then(clientList => {
        if (clientList.length > 0) {
          return clientList[0].focus();
        }
        return clients.openWindow('/');
      })
    );
  }
});

// Handle push events (for future push notification support)
self.addEventListener('push', event => {
  console.log('[SW] Push event received:', event);
  
  if (event.data) {
    try {
      const notification = event.data.json();
      handleNotification(notification, null);
    } catch (error) {
      console.error('[SW] Error parsing push data:', error);
    }
  }
});

console.log('[SW] Service Worker loaded');
