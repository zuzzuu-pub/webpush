/**
 * Zuzzuu Service Worker - Enhanced Version
 * Handles push notifications, WebSocket connections, and background sync
 * Security improvements and better state management
 */

let socket = null;
let isConnected = false;
let subscriberId = null;
let connectionInProgress = false;
let lastConnectionAttempt = 0;
const CONNECTION_COOLDOWN = 5000;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectAttempts = 0;

// Notification deduplication cache (stores notification IDs seen in last 60 seconds)
const notificationCache = new Map();
const CACHE_CLEANUP_INTERVAL = 60000; // 1 minute
const NOTIFICATION_TTL = 60000; // 60 seconds

// Security: Content Security Policy headers
const CSP_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; connect-src 'self' https://*.vibte.shop wss://*.vibte.shop https://*.cloudinary.com; img-src 'self' https: data:;"
};

// Service Worker lifecycle events
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker');
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    self.clients.claim()
      .then(() => {
        console.log('[SW] Service worker now controls all clients');
        initializeServiceWorker();
      })
  );
});

/**
 * Initialize service worker
 */
function initializeServiceWorker() {
  // Start notification cache cleanup
  setInterval(cleanupNotificationCache, CACHE_CLEANUP_INTERVAL);

  // Load persisted state
  loadPersistedState();

  console.log('[SW] Service worker initialized');
}

/**
 * Clean up old notification cache entries
 */
function cleanupNotificationCache() {
  const now = Date.now();
  for (const [key, timestamp] of notificationCache.entries()) {
    if (now - timestamp > NOTIFICATION_TTL) {
      notificationCache.delete(key);
    }
  }
}

/**
 * Load persisted state from IndexedDB or fallback storage
 */
async function loadPersistedState() {
  try {
    // Try to load subscriber ID from clients
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length > 0) {
      clients[0].postMessage({ type: 'REQUEST_SUBSCRIBER_ID' });
    }
  } catch (error) {
    console.error('[SW] Error loading persisted state:', error);
  }
}

/**
 * Listen for messages from main thread
 */
self.addEventListener('message', (event) => {
  const { type, data } = event.data;
  console.log('[SW] Received message:', type);

  switch (type) {
    case 'CONNECT_SOCKETIO':
      handleConnectSocketIO(data);
      break;
    case 'DISCONNECT_SOCKETIO':
      disconnectSocketIO();
      break;
    case 'SET_SUBSCRIBER_ID':
      setSubscriberId(data.subscriberId);
      break;
    case 'GET_STATUS':
      respondWithStatus(event);
      break;
    case 'HEARTBEAT':
      sendHeartbeat();
      break;
    default:
      console.log('[SW] Unknown message type:', type);
  }
});

/**
 * Set subscriber ID with validation
 */
function setSubscriberId(id) {
  if (!id || typeof id !== 'string') {
    console.error('[SW] Invalid subscriber ID');
    return;
  }

  subscriberId = id;
  console.log('[SW] Subscriber ID set:', subscriberId.substring(0, 8) + '...');

  broadcastToClients({
    type: 'SUBSCRIBER_ID_SET',
    data: { subscriberId: subscriberId }
  });
}

/**
 * Respond with current status
 */
function respondWithStatus(event) {
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      type: 'STATUS_RESPONSE',
      data: {
        subscriberId: subscriberId,
        connected: isConnected,
        reconnectAttempts: reconnectAttempts
      }
    });
  }
}

/**
 * Handle Socket.IO connection request
 */
function handleConnectSocketIO(data) {
  if (connectionInProgress) {
    console.log('[SW] Connection already in progress');
    return;
  }

  if (isConnected && subscriberId === data.subscriberId) {
    console.log('[SW] Already connected');
    broadcastToClients({ type: 'SOCKETIO_CONNECTED' });
    return;
  }

  // Connection cooldown
  const now = Date.now();
  if (now - lastConnectionAttempt < CONNECTION_COOLDOWN) {
    console.log('[SW] Connection cooldown active');
    return;
  }

  lastConnectionAttempt = now;
  connectionInProgress = true;
  subscriberId = data.subscriberId;

  connectWebSocket(data.subscriberId, data.socketUrl);
}

/**
 * Connect to WebSocket with enhanced error handling for Socket.IO
 */
function connectWebSocket(subId, wsUrl) {
  try {
    // Use local nginx proxy for Socket.IO connections
    // Socket.IO requires specific path and query parameters
    const protocol = self.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = self.location.host;
    const timestamp = Date.now();
    
    // Socket.IO WebSocket URL format with required query parameters
    const url = `${protocol}//${host}/socket.io/?subscriber_id=${subId}&client_type=service_worker&timestamp=${timestamp}&EIO=4&transport=websocket`;
    console.log('[SW] Connecting to Socket.IO through nginx proxy:', url);

    socket = new WebSocket(url);

    socket.onopen = () => {
      console.log('[SW] WebSocket connected');
      isConnected = true;
      connectionInProgress = false;
      reconnectAttempts = 0;

      broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
    };

    socket.onmessage = (event) => {
      handleWebSocketMessage(event);
    };

    socket.onclose = (event) => {
      console.log('[SW] WebSocket closed:', event.code, event.reason);
      isConnected = false;
      connectionInProgress = false;

      broadcastToClients({ type: 'WEBSOCKET_DISCONNECTED' });

      // Attempt reconnection for unexpected disconnections
      if (event.code !== 1000 && event.code !== 1001 && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`[SW] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

        setTimeout(() => {
          if (!isConnected) {
            connectWebSocket(subId, wsUrl);
          }
        }, delay);
      }
    };

    socket.onerror = (error) => {
      console.error('[SW] WebSocket error:', error);
      isConnected = false;
      connectionInProgress = false;
      broadcastToClients({ type: 'WEBSOCKET_ERROR', data: { error: 'Connection failed' } });
    };

  } catch (error) {
    console.error('[SW] Error creating WebSocket:', error);
    connectionInProgress = false;
    broadcastToClients({ type: 'WEBSOCKET_ERROR', data: { error: error.message } });
  }
}

/**
 * Disconnect Socket.IO
 */
function disconnectSocketIO() {
  connectionInProgress = false;

  if (socket) {
    socket.close(1000, 'Service worker disconnect');
    socket = null;
  }

  isConnected = false;
  subscriberId = null;
  reconnectAttempts = 0;
}

/**
 * Handle WebSocket messages with Socket.IO/Engine.IO packet format support
 */
function handleWebSocketMessage(event) {
  try {
    const rawMessage = event.data;
    console.log('[SW] Raw WebSocket message:', rawMessage);

    // Socket.IO/Engine.IO packet format handling
    // Packet types: 0=OPEN, 1=CLOSE, 2=PING, 3=PONG, 4=MESSAGE, 40=CONNECT, 41=DISCONNECT, 42=EVENT, 43=ACK
    
    // Skip Engine.IO control packets (0-3)
    if (rawMessage === '2' || rawMessage === '3') {
      // PING/PONG heartbeat - respond if needed
      if (rawMessage === '2' && socket && socket.readyState === WebSocket.OPEN) {
        socket.send('3'); // Send PONG
      }
      return;
    }

    // Socket.IO packets start with 4
    if (rawMessage.startsWith('42')) {
      // Socket.IO EVENT packet - format: 42["event_name",{...data}]
      const jsonData = rawMessage.substring(2); // Remove '42' prefix
      const parsed = JSON.parse(jsonData);
      
      if (Array.isArray(parsed) && parsed.length >= 2) {
        const eventName = parsed[0];
        const eventData = parsed[1];
        
        console.log('[SW] Socket.IO event:', eventName);
        
        if (eventName === 'notification') {
          handleNotificationEvent(eventData);
        } else if (eventName === 'connection_established' || eventName === 'connected') {
          console.log('[SW] Connection established');
          broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
        }
      }
    } else if (rawMessage.startsWith('40')) {
      // Socket.IO CONNECT packet
      console.log('[SW] Socket.IO connected');
      broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
    } else if (rawMessage.startsWith('41')) {
      // Socket.IO DISCONNECT packet
      console.log('[SW] Socket.IO disconnected');
      isConnected = false;
    } else if (rawMessage.startsWith('0')) {
      // Engine.IO OPEN packet - connection opened
      console.log('[SW] Engine.IO connection opened');
    } else {
      // Try to parse as plain JSON (fallback for non-Socket.IO messages)
      try {
        const data = JSON.parse(rawMessage);
        console.log('[SW] Plain JSON message:', data.type);

        if (data.type === 'notification') {
          handleNotificationEvent(data.data || data);
        } else if (data.type === 'connection_established') {
          console.log('[SW] Connection established');
          broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
        }
      } catch (jsonError) {
        console.log('[SW] Unknown message format, skipping:', rawMessage.substring(0, 50));
      }
    }
  } catch (error) {
    console.error('[SW] Error handling WebSocket message:', error, 'Raw message:', event.data);
  }
}

/**
 * Handle notification event data
 */
function handleNotificationEvent(notificationData) {
  // Check for duplicate
  if (isDuplicateNotification(notificationData)) {
    console.log('[SW] Duplicate notification ignored');
    return;
  }

  // Forward to clients
  broadcastToClients({
    type: 'NOTIFICATION_RECEIVED',
    data: notificationData
  });

  // Show browser notification
  showBrowserNotification(notificationData);
}

/**
 * Check if notification is a duplicate
 */
function isDuplicateNotification(data) {
  const notificationId = data.id || `${data.title}_${data.message}`;
  const now = Date.now();

  if (notificationCache.has(notificationId)) {
    const lastSeen = notificationCache.get(notificationId);
    if (now - lastSeen < NOTIFICATION_TTL) {
      return true;
    }
  }

  notificationCache.set(notificationId, now);
  return false;
}

/**
 * Handle push notifications (for browser-closed scenarios)
 */
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');

  let notificationData = {};

  if (event.data) {
    try {
      const rawData = event.data.text();
      const parsedData = JSON.parse(rawData);

      // Handle Firebase FCM format
      if (parsedData.notification) {
        notificationData = {
          title: parsedData.notification.title || 'Notification',
          message: parsedData.notification.body || 'You have a new notification',
          url: parsedData.data?.url || parsedData.data?.click_action,
          icon: parsedData.notification.icon || parsedData.data?.icon,
          image: parsedData.notification.image || parsedData.data?.image,
          tag: parsedData.data?.tag || 'zuzzuu-notification',
          ...parsedData.data
        };
      } else {
        notificationData = parsedData;
      }
    } catch (error) {
      console.error('[SW] Error parsing push data:', error);
      notificationData = {
        title: 'Notification',
        message: 'You have a new notification'
      };
    }
  } else {
    notificationData = {
      title: 'Notification',
      message: 'You have a new notification'
    };
  }

  // Skip setup notifications
  if (notificationData.source === 'setup' || notificationData.source === 'welcome') {
    console.log('[SW] Skipping setup notification');
    return;
  }

  // Check for duplicates
  if (isDuplicateNotification(notificationData)) {
    console.log('[SW] Duplicate push notification ignored');
    return;
  }

  const notificationPromise = showBrowserNotification(notificationData);
  const clientsPromise = checkAndNotifyClients(notificationData);

  event.waitUntil(
    Promise.all([notificationPromise, clientsPromise])
      .catch((error) => {
        console.error('[SW] Error in push notification handling:', error);
        return showFallbackNotification();
      })
  );
});

/**
 * Check for open clients and notify them
 */
async function checkAndNotifyClients(notificationData) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });

    if (clients.length > 0) {
      const sanitizedData = sanitizeForPostMessage(notificationData);
      clients.forEach(client => {
        try {
          client.postMessage({
            type: 'PUSH_NOTIFICATION_RECEIVED',
            data: sanitizedData
          });
        } catch (error) {
          console.error('[SW] Error forwarding to client:', error);
        }
      });
      return true;
    }

    console.log('[SW] No clients available');
    return false;
  } catch (error) {
    console.error('[SW] Error checking clients:', error);
    return false;
  }
}

/**
 * Show browser notification with security validation
 * This handles showing system notifications even when browser is closed
 */
async function showBrowserNotification(notificationData) {
  try {
    // Validate and sanitize notification data
    const sanitized = sanitizeNotificationData(notificationData);

    const options = {
      body: sanitized.message || sanitized.body || 'You have a new notification',
      icon: sanitized.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      badge: sanitized.badge || sanitized.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      tag: sanitized.tag || 'zuzzuu-' + Date.now(),
      requireInteraction: false,
      silent: false,
      renotify: true,
      vibrate: [200, 100, 200], // Vibration pattern for mobile
      data: {
        url: sanitized.url || self.location.origin,
        timestamp: new Date().toISOString(),
        id: sanitized.id
      }
    };

    if (sanitized.image) {
      options.image = sanitized.image;
    }

    // Show notification using service worker registration
    // This will display as a system notification (Windows/macOS notification center)
    return await self.registration.showNotification(sanitized.title || 'Notification', options);
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
    return showFallbackNotification();
  }
}

/**
 * Sanitize notification data for security
 */
function sanitizeNotificationData(data) {
  const sanitized = {};

  // Only allow specific fields
  const allowedFields = ['title', 'message', 'body', 'icon', 'badge', 'image', 'url', 'tag', 'id'];

  for (const field of allowedFields) {
    if (data[field] && typeof data[field] === 'string') {
      // Basic XSS prevention
      sanitized[field] = data[field].replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
  }

  // Validate URLs
  if (sanitized.url && !isValidUrl(sanitized.url)) {
    sanitized.url = self.location.origin;
  }
  if (sanitized.icon && !isValidUrl(sanitized.icon)) {
    delete sanitized.icon;
  }
  if (sanitized.image && !isValidUrl(sanitized.image)) {
    delete sanitized.image;
  }

  return sanitized;
}

/**
 * Validate URL
 */
function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Show fallback notification
 */
function showFallbackNotification() {
  return self.registration.showNotification('Zuzzuu', {
    body: 'You have a new notification',
    icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    tag: 'zuzzuu-fallback-' + Date.now()
  });
}

/**
 * Handle notification click
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});

/**
 * Handle notification close
 */
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] Notification closed:', event.notification.tag);

  broadcastToClients({
    type: 'NOTIFICATION_CLOSED',
    data: {
      tag: event.notification.tag,
      timestamp: new Date().toISOString()
    }
  });
});

/**
 * Send heartbeat
 */
function sendHeartbeat() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify({
        type: 'heartbeat',
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('[SW] Error sending heartbeat:', error);
    }
  }
}

/**
 * Broadcast to all clients
 */
function broadcastToClients(message) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(clients => {
      if (clients.length === 0) {
        return false;
      }

      clients.forEach(client => {
        try {
          client.postMessage(sanitizeForPostMessage(message));
        } catch (error) {
          console.error('[SW] Error sending to client:', error);
        }
      });

      return true;
    })
    .catch(error => {
      console.error('[SW] Error broadcasting:', error);
      return false;
    });
}

/**
 * Sanitize message for postMessage
 */
function sanitizeForPostMessage(message) {
  try {
    return JSON.parse(JSON.stringify(message));
  } catch (error) {
    console.error('[SW] Error sanitizing message:', error);
    return {
      type: message.type || 'UNKNOWN',
      data: { error: 'Serialization failed' }
    };
  }
}

/**
 * Handle background sync
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(
      Promise.resolve().then(() => {
        console.log('[SW] Background sync completed');
        broadcastToClients({
          type: 'BACKGROUND_SYNC_COMPLETE',
          data: { tag: event.tag }
        });
      })
    );
  }
});
