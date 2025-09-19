/**
 * Zuzzuu Service Worker
 * Handles push notifications, WebSocket connections, and background sync
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
  console.log('[SW] Received message:', type, data);
  
  switch (type) {
    case 'CONNECT_SOCKETIO':
      connectSocketIO(data.subscriberId, data.socketUrl);
      break;
    case 'DISCONNECT_SOCKETIO':
      disconnectSocketIO();
      break;
    case 'CONNECT_WEBSOCKET':
      connectWebSocket(data.subscriberId, data.wsUrl);
      break;
    case 'DISCONNECT_WEBSOCKET':
      disconnectWebSocket();
      break;
    case 'UPDATE_SUBSCRIBER_STATUS':
      updateSubscriberStatus(data.status);
      break;
    case 'SET_SUBSCRIBER_ID':
      subscriberId = data.subscriberId;
      console.log('[SW] Subscriber ID set:', subscriberId);
      broadcastToClients({ 
        type: 'SUBSCRIBER_ID_SET',
        data: { subscriberId: subscriberId }
      });
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'CLAIM_CLIENTS':
      self.clients.claim().then(() => {
        console.log('[SW] Service worker claimed all clients');
        broadcastToClients({ 
          type: 'SERVICE_WORKER_READY',
          data: { ready: true }
        });
      });
      break;
    case 'GET_CONNECTION_STATUS':
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ 
          type: 'CONNECTION_STATUS', 
          connected: isConnected,
          subscriberId: subscriberId
        });
      }
      break;
    case 'GET_STATUS':
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ 
          type: 'STATUS_RESPONSE', 
          subscriberId: subscriberId,
          connected: isConnected
        });
      }
      break;
  }
});

// Socket.IO Connection Functions
function connectSocketIO(subId, socketUrl) {
  // For now, Socket.IO connection is handled by the main thread
  // This is a placeholder for future Socket.IO service worker integration
  console.log('[SW] Socket.IO connection requested (handled by main thread)');
  subscriberId = subId;
  
  broadcastToClients({
    type: 'SOCKETIO_CONNECTED',
    data: { subscriberId: subscriberId }
  });
}

function disconnectSocketIO() {
  console.log('[SW] Socket.IO disconnection requested');
  isConnected = false;
  
  broadcastToClients({
    type: 'SOCKETIO_DISCONNECTED'
  });
}

// WebSocket Connection Functions
function connectWebSocket(subId, wsUrl) {
  // Prevent duplicate connections
  if (connectionInProgress) {
    console.log('[SW] Connection already in progress, ignoring request');
    return;
  }
  
  if (isConnected && subscriberId === subId) {
    console.log('[SW] Already connected to same subscriber, ignoring request');
    broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
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
      broadcastToClients({ 
        type: 'STORE_CONNECTION_STATE',
        data: { connected: true, subscriberId: subscriberId }
      });
      
      broadcastToClients({ type: 'WEBSOCKET_CONNECTED' });
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
      broadcastToClients({ 
        type: 'STORE_CONNECTION_STATE',
        data: { connected: false, subscriberId: null }
      });
      
      broadcastToClients({ type: 'WEBSOCKET_DISCONNECTED' });
      
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
      broadcastToClients({ type: 'WEBSOCKET_ERROR', data: { error: error.message || 'WebSocket connection failed' } });
    };
    
  } catch (error) {
    console.error('[SW] Error creating WebSocket:', error);
    connectionInProgress = false;
    broadcastToClients({ type: 'WEBSOCKET_ERROR', data: { error: error.message || 'Failed to create WebSocket' } });
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
  broadcastToClients({ 
    type: 'STORE_CONNECTION_STATE',
    data: { connected: false, subscriberId: null }
  });
}

// Handle WebSocket messages and show real-time notifications
function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('[SW] WebSocket message received:', data);

    if (data.type === 'notification') {
      // Support both { type: 'notification', ...fields } and { type: 'notification', data: {...fields} }
      const notificationData = data.data ? data.data : data;

      console.log('[SW] Processing WebSocket notification data:', notificationData);

      // Forward notification to main thread
      broadcastToClients({
        type: 'NOTIFICATION_RECEIVED',
        data: notificationData
      });

      // Show browser notification immediately for real-time notifications
      showBrowserNotificationFromWebSocket(notificationData);
      
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

// Show browser notification from WebSocket data
function showBrowserNotificationFromWebSocket(notificationData) {
  try {
    // Check for image_url in nested template if main image_url is null/empty
    const logoUrl = notificationData.logo_url || 
                   (notificationData.template && notificationData.template.logo_url) || 
                   'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg';
    const imageUrl = notificationData.image_url ||
                    (notificationData.template && notificationData.template.image_url) ||
                    undefined;

    const title = notificationData.title || 'New Notification from Zuzzuu';
    const options = {
      body: notificationData.message || '',
      icon: logoUrl,
      badge: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      image: imageUrl,
      tag: notificationData.id || 'zuzzuu-websocket-notification-' + Date.now(),
      data: notificationData,
      requireInteraction: false,
      silent: false,
      renotify: true,
      vibrate: [200, 100, 200]
    };
    
    console.log('[SW] Showing WebSocket notification:', title, options);
    
    self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] WebSocket notification displayed successfully');
      })
      .catch(error => {
        console.error('[SW] Failed to show WebSocket notification:', error);
      });
      
  } catch (error) {
    console.error('[SW] Error showing WebSocket notification:', error);
  }
}

// Update subscriber status via WebSocket
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

// Enhanced broadcasting with better error handling
function broadcastToClients(message) {
  return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    .then(clients => {
      console.log(`[SW] Broadcasting message to ${clients.length} clients:`, message.type);
      
      if (clients.length === 0) {
        console.log('[SW] No clients to broadcast to - browser likely closed');
        return Promise.resolve(false);
      }

      const promises = clients.map(client => {
        return new Promise((resolve) => {
          try {
            // Sanitize the message before sending to avoid DataCloneError
            const sanitizedMessage = sanitizeForPostMessage(message);
            client.postMessage(sanitizedMessage);
            console.log('[SW] Message sent to client successfully');
            resolve(true);
          } catch (error) {
            console.error('[SW] Error sending message to client:', error);
            // Try sending a minimal error message if the original fails
            try {
              client.postMessage({
                type: 'BROADCAST_ERROR',
                data: { error: 'Failed to send original message due to serialization error' }
              });
              resolve(false);
            } catch (fallbackError) {
              console.error('[SW] Even fallback message failed:', fallbackError);
              resolve(false);
            }
          }
        });
      });

      return Promise.all(promises);
    })
    .catch(error => {
      console.error('[SW] Error getting clients for broadcast:', error);
      return Promise.resolve(false);
    });
}

// Handle push notifications - Enhanced for browser-closed scenarios (Firebase-style)
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received, event data:', event.data ? 'present' : 'empty');

  let notificationData = {};

  // Parse notification data with enhanced error handling (supports Firebase and custom formats)
  if (event.data) {
    try {
      const rawData = event.data.text();
      console.log('[SW] Raw push data:', rawData);
      
      // Try to parse as JSON first
      try {
        const parsedData = JSON.parse(rawData);
        console.log('[SW] Parsed JSON notification data:', parsedData);
        
        // Handle Firebase FCM format: { notification: {...}, data: {...} }
        if (parsedData.notification) {
          notificationData = {
            title: parsedData.notification.title || 'Zuzzuu Notification',
            message: parsedData.notification.body || 'You have a new notification',
            url: parsedData.data?.url || parsedData.data?.click_action,
            icon: parsedData.notification.icon || parsedData.data?.icon,
            image: parsedData.notification.image || parsedData.data?.image,
            tag: parsedData.data?.tag || 'zuzzuu-notification',
            ...parsedData.data // Include any additional data
          };
        } else {
          // Handle custom Zuzzuu format
          notificationData = parsedData;
        }
      } catch (jsonError) {
        console.log('[SW] Not JSON, treating as text:', rawData);
        notificationData = {
          title: 'Zuzzuu Notification',
          message: rawData || 'You have a new notification'
        };
      }
    } catch (error) {
      console.error('[SW] Error reading push notification data:', error);
      notificationData = {
        title: 'Zuzzuu Notification',
        message: 'You have a new notification'
      };
    }
  } else {
    console.log('[SW] Empty push data, using default notification');
    notificationData = {
      title: 'Zuzzuu Notification',
      message: 'You have a new notification from Zuzzuu'
    };
  }

  // Ensure we have required fields
  if (!notificationData.title && !notificationData.message) {
    notificationData = {
      title: 'Zuzzuu Notification',
      message: 'You have a new notification'
    };
  }

  console.log('[SW] Final push notification data to display:', notificationData);

  // Always show browser notification - this is critical for browser-closed scenarios
  const notificationPromise = showBrowserNotification(notificationData);

  // Check if any clients are available and forward if possible
  const clientsPromise = checkAndNotifyClients(notificationData);

  // Wait for both operations to complete
  event.waitUntil(
    Promise.all([notificationPromise, clientsPromise])
      .then(() => {
        console.log('[SW] Push notification handling completed successfully');
      })
      .catch(error => {
        console.error('[SW] Error in push notification handling:', error);
        // Even if there's an error, try to show a basic notification
        return showFallbackNotification();
      })
  );
});

// Enhanced function to check clients and notify them
async function checkAndNotifyClients(notificationData) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    console.log(`[SW] Found ${clients.length} clients to notify`);
    
    if (clients.length > 0) {
      // Browser has open tabs, forward to main thread
      clients.forEach(client => {
        try {
          client.postMessage({
            type: 'PUSH_NOTIFICATION_RECEIVED',
            data: sanitizeForPostMessage(notificationData)
          });
          console.log('[SW] Push notification forwarded to client');
        } catch (error) {
          console.error('[SW] Error forwarding push notification to client:', error);
        }
      });
      return true;
    } else {
      console.log('[SW] No clients available - browser likely closed, push notification will show via system');
      return false;
    }
  } catch (error) {
    console.error('[SW] Error checking clients:', error);
    return false;
  }
}

// Fallback notification for critical errors
function showFallbackNotification() {
  console.log('[SW] Showing fallback notification');
  return self.registration.showNotification('Zuzzuu', {
    body: 'You have a new notification',
    icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    badge: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    tag: 'zuzzuu-fallback-' + Date.now(),
    requireInteraction: false,
    silent: false
  });
}

// Enhanced browser notification display with Firebase-style options (for push notifications)
function showBrowserNotification(notificationData) {
  try {
    // Ensure we have a title
    let title = notificationData.title || notificationData.name || 'Zuzzuu Notification';
    
    // Ensure we have a message
    let body = notificationData.message || notificationData.body || notificationData.text || 'You have a new notification';
    
    // Truncate title and body if too long (browser limits)
    if (title.length > 100) title = title.substring(0, 97) + '...';
    if (body.length > 200) body = body.substring(0, 197) + '...';

    const options = {
      body: body,
      icon: notificationData.logo_url || notificationData.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      badge: notificationData.logo_url || notificationData.badge || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      image: notificationData.image_url || notificationData.image || undefined,
      tag: notificationData.tag || notificationData.id ? `zuzzuu-push-${notificationData.id}` : `zuzzuu-notification-${Date.now()}`,
      data: {
        // Store essential data only to avoid serialization issues
        id: notificationData.id,
        url: notificationData.url || notificationData.action_url || notificationData.click_action,
        timestamp: new Date().toISOString(),
        original_data: notificationData,
        source: 'push'
      },
      requireInteraction: true, // Firebase-style: notification persists until user interaction
      silent: false, // Play notification sound
      renotify: true, // Show even if a notification with same tag exists
      vibrate: [200, 100, 200], // Vibration pattern for mobile
      actions: [] // Will be populated below
    };

    // Add actions similar to Firebase (open/close pattern)
    if (notificationData.url || notificationData.action_url || notificationData.click_action) {
      options.actions = [
        {
          action: 'open',
          title: 'Open',
          icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg'
        },
        {
          action: 'close',
          title: 'Close'
        }
      ];
    } else {
      // No URL provided, just add close action
      options.actions = [
        {
          action: 'close',
          title: 'Close'
        }
      ];
    }

    console.log('[SW] Showing enhanced push notification (Firebase-style):', title, options);
    console.log('[SW] Push notification will display even when browser is closed');

    return self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] Push notification displayed successfully');
        return true;
      })
      .catch(error => {
        console.error('[SW] Failed to show push notification, trying fallback:', error);
        // Try showing a simpler notification as fallback
        return self.registration.showNotification(title, {
          body: body,
          icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
          tag: `zuzzuu-fallback-${Date.now()}`,
          requireInteraction: false,
          silent: false
        });
      });
  } catch (error) {
    console.error('[SW] Critical error showing push notification:', error);
    // Last resort fallback
    return showFallbackNotification();
  }
}

// Sanitize data to ensure it's serializable for postMessage
function sanitizeForPostMessage(obj) {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  // Handle primitive types
  if (typeof obj !== 'object') {
    return typeof obj === 'function' ? '[Function]' : obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForPostMessage(item));
  }
  
  // Handle objects
  const sanitized = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (typeof value === 'function') {
        sanitized[key] = '[Function]';
      } else if (typeof value === 'object' && value !== null) {
        // Avoid circular references and deep nesting
        try {
          sanitized[key] = sanitizeForPostMessage(value);
        } catch (error) {
          sanitized[key] = '[Object - could not serialize]';
        }
      } else {
        sanitized[key] = value;
      }
    }
  }
  
  return sanitized;
}

// Enhanced notification click handling (Firebase-style with proper action support)
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked:', event.notification.tag, 'Action:', event.action);
  console.log('[SW] Notification data:', event.notification.data);
  
  // Close the notification
  event.notification.close();
  
  // Handle close action (like Firebase)
  if (event.action === 'close') {
    console.log('[SW] User chose to close notification');
    return;
  }
  
  const data = event.notification.data || {};
  const originalData = data.original_data || data;
  
  // Determine the URL to open
  let url = data.url || originalData.url || originalData.action_url || originalData.click_action || '/';
  
  // If no specific URL, open the main application
  if (!url || url === '/') {
    url = self.location.origin;
  }

  console.log('[SW] Opening URL:', url);

  event.waitUntil(
    // First, try to focus an existing window with the same URL (Firebase pattern)
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Look for an existing window with the target URL
        for (let client of clients) {
          if (client.url === url && 'focus' in client) {
            console.log('[SW] Focusing existing window');
            return client.focus();
          }
        }
        
        // If no existing window found, open a new one
        console.log('[SW] Opening new window');
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
        return null;
      })
      .then(windowClient => {
        if (windowClient) {
          console.log('[SW] Window opened/focused successfully');
          // Send a message to the opened window about the notification click
          windowClient.postMessage({
            type: 'NOTIFICATION_CLICKED',
            data: sanitizeForPostMessage(originalData || data)
          });
        } else {
          console.error('[SW] Failed to open/focus window');
        }
      })
      .catch(error => {
        console.error('[SW] Error handling notification click:', error);
      })
  );
});

// Handle notification close events (Firebase-style)
self.addEventListener('notificationclose', function(event) {
  console.log('[SW] Notification closed:', event.notification.tag);
  console.log('[SW] Notification data:', event.notification.data);
  
  // Track notification close events (optional analytics)
  const data = event.notification.data || {};
  const originalData = data.original_data || data;
  
  // Broadcast to clients that notification was closed
  broadcastToClients({
    type: 'NOTIFICATION_CLOSED',
    data: {
      tag: event.notification.tag,
      id: data.id,
      timestamp: new Date().toISOString(),
      source: data.source || 'unknown'
    }
  });
  
  console.log('[SW] Notification close event processed');
});

// Handle background sync (for offline functionality)
self.addEventListener('sync', function(event) {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Perform background sync operations
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
