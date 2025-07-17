/**
 * Zuzzuu Service Worker
 * Handles background WebSocket connections and notifications
 */

let socket = null;
let isConnected = false;
let subscriberId = null;
let connectionInProgress = false;
let lastConnectionAttempt = 0;
const CONNECTION_COOLDOWN = 5000; // 5 seconds between connection attempts

// Service Worker event listeners
self.addEventListener('install', function(event) {
  console.log('[SW] Installing service worker');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[SW] Activating service worker');
  event.waitUntil(
    self.clients.claim().then(() => {
      console.log('[SW] Service worker now controls all clients');
    })
  );
});

// Listen for messages from main thread
self.addEventListener('message', function(event) {
  const { type, data } = event.data;
  
  switch (type) {
    case 'CONNECT_WEBSOCKET':
      connectWebSocket(data.subscriberId, data.wsUrl);
      break;
    case 'DISCONNECT_WEBSOCKET':
      disconnectWebSocket();
      break;
    case 'UPDATE_SUBSCRIBER_STATUS':
      updateSubscriberStatus(data.status);
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CLAIM_CLIENTS':
      self.clients.claim().then(() => {
        console.log('[SW] Service worker claimed all clients');
        // Notify clients that we're now in control
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({ 
              type: 'SERVICE_WORKER_READY',
              data: { ready: true }
            });
          });
        });
      });
      break;
    case 'GET_CONNECTION_STATUS':
      event.ports[0].postMessage({ 
        type: 'CONNECTION_STATUS', 
        connected: isConnected,
        subscriberId: subscriberId
      });
      break;
  }
});

function connectWebSocket(subId, wsUrl) {
  // Prevent duplicate connections
  if (connectionInProgress) {
    console.log('[SW] Connection already in progress, ignoring request');
    return;
  }
  
  if (isConnected && subscriberId === subId) {
    console.log('[SW] Already connected to same subscriber, ignoring request');
    notifyClients({ type: 'WEBSOCKET_CONNECTED' });
    return;
  }
  
  // Implement connection cooldown
  const now = Date.now();
  if (now - lastConnectionAttempt < CONNECTION_COOLDOWN) {
    console.log('[SW] Connection cooldown active, ignoring request');
    return;
  }
  
  lastConnectionAttempt = now;
  connectionInProgress = true;
  subscriberId = subId;
  
  // Close existing connection if different subscriber
  if (socket && socket.readyState === WebSocket.OPEN && subscriberId !== subId) {
    console.log('[SW] Closing existing connection for different subscriber');
    socket.close();
  }
  
  try {
    const url = `${wsUrl}/${subscriberId}`;
    console.log('[SW] Connecting to WebSocket:', url);
    
    socket = new WebSocket(url);
    
    socket.onopen = function() {
      console.log('[SW] WebSocket connected');
      isConnected = true;
      connectionInProgress = false;
      
      // Store connection state
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ 
            type: 'STORE_CONNECTION_STATE',
            data: { connected: true, subscriberId: subscriberId }
          });
        });
      });
      
      notifyClients({ type: 'WEBSOCKET_CONNECTED' });
    };
    
    socket.onmessage = function(event) {
      console.log('[SW] WebSocket message:', event.data);
      handleWebSocketMessage(event);
    };
    
    socket.onclose = function(event) {
      console.log('[SW] WebSocket disconnected:', event.code, event.reason);
      isConnected = false;
      connectionInProgress = false;
      
      // Update stored connection state
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({ 
            type: 'STORE_CONNECTION_STATE',
            data: { connected: false, subscriberId: null }
          });
        });
      });
      
      notifyClients({ type: 'WEBSOCKET_DISCONNECTED' });
      
      // Only attempt to reconnect for unexpected disconnections
      if (event.code !== 1000 && event.code !== 1001) {
        console.log('[SW] Unexpected disconnection, will attempt reconnect after delay');
        setTimeout(() => {
          if (!isConnected && !connectionInProgress) {
            connectWebSocket(subscriberId, wsUrl.replace(`/${subscriberId}`, ''));
          }
        }, 10000); // 10 second delay for reconnection
      }
    };
    
    socket.onerror = function(error) {
      console.error('[SW] WebSocket error:', error);
      isConnected = false;
      connectionInProgress = false;
      notifyClients({ type: 'WEBSOCKET_ERROR', error: error.message });
    };
    
  } catch (error) {
    console.error('[SW] Error creating WebSocket:', error);
    connectionInProgress = false;
  }
}

function disconnectWebSocket() {
  connectionInProgress = false;
  
  if (socket) {
    socket.close(1000, 'Service worker disconnect');
    socket = null;
  }
  
  isConnected = false;
  subscriberId = null;
  
  // Clear stored connection state
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ 
        type: 'STORE_CONNECTION_STATE',
        data: { connected: false, subscriberId: null }
      });
    });
  });
}

// Add missing broadcastToClients function
function broadcastToClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage(message);
    });
  });
}

// Add missing updateSubscriberStatus function
function updateSubscriberStatus(status) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    console.log(`[SW] Updating subscriber status to: ${status}`);
    socket.send(JSON.stringify({
      type: 'status_update',
      status: status,
      timestamp: new Date().toISOString()
    }));
  }
}

// Handle WebSocket messages
function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('[SW] WebSocket message received:', data);
    
    if (data.type === 'notification') {
      // Extract notification data properly
      const notificationData = data.data || data;
      
      console.log('[SW] Processing notification data:', notificationData);
      
      // Forward notification to main thread with proper structure
      broadcastToClients({
        type: 'NOTIFICATION_RECEIVED',
        data: notificationData
      });
      
      // Show browser notification if permission granted
      if (self.Notification && self.Notification.permission === 'granted') {
        // Check for image_url in nested template if main image_url is null/empty
        const imageUrl = notificationData.image_url || (notificationData.template && notificationData.template.image_url) || '';
        const logoUrl = notificationData.logo_url || (notificationData.template && notificationData.template.logo_url) || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg';
        
        const notificationOptions = {
          body: notificationData.message || '',
          icon: logoUrl,
          badge: logoUrl,
          image: imageUrl,
          tag: notificationData.id || 'zuzzuu-notification',
          data: notificationData,
          requireInteraction: false,
          silent: false
        };
        
        console.log('[SW] Showing browser notification with options:', notificationOptions);
        
        self.registration.showNotification(
          notificationData.title || 'New Notification from Zuzzuu',
          notificationOptions
        );
      } else {
        console.log('[SW] Browser notification permission not granted');
      }
    } else if (data.type === 'connection_established') {
      console.log('[SW] WebSocket connection established');
      broadcastToClients({
        type: 'WEBSOCKET_CONNECTED',
        data: { subscriberId: subscriberId }
      });
    } else if (data.type === 'heartbeat_response') {
      console.log('[SW] Heartbeat response received');
    } else if (data.type === 'echo') {
      console.log('[SW] Echo response received:', data);
    }
  } catch (error) {
    console.error('[SW] Error handling WebSocket message:', error);
  }
}

function showNotification(data) {
  // Check for image_url in nested template if main image_url is null/empty
  const logoUrl = data.logo_url || (data.template && data.template.logo_url) || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg';
  const imageUrl = data.image_url || (data.template && data.template.image_url) || '';
  
  const title = data.title || 'New Notification';
  const options = {
    body: data.message || '',
    icon: logoUrl,
    badge: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    image: imageUrl,
    tag: data.id || 'zuzzuu-notification',
    data: data,
    requireInteraction: true
  };
  
  self.registration.showNotification(title, options);
}

function notifyClients(message) {
  broadcastToClients(message);
}

// Handle notification click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const data = event.notification.data;
  
  event.waitUntil(
    self.clients.openWindow(data.url || '/')
  );
});
