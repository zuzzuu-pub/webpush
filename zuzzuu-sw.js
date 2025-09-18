/**
 * Zuzzuu Service Worker
 * Handles push notifications and background sync
 */

let subscriberId = null;

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
    case 'GET_STATUS':
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ 
          type: 'STATUS_RESPONSE', 
          subscriberId: subscriberId
        });
      }
      break;
  }
});

// Handle push notifications
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received');

  let notificationData = {};

  if (event.data) {
    try {
      notificationData = event.data.json();
      console.log('[SW] Push notification data:', notificationData);
    } catch (error) {
      console.error('[SW] Error parsing push notification data:', error);
      notificationData = {
        title: 'New Notification',
        message: event.data.text() || 'You have a new notification'
      };
    }
  } else {
    notificationData = {
      title: 'New Notification',
      message: 'You have a new notification from Zuzzuu'
    };
  }

  // Always show browser notification regardless of client state
  const notificationPromise = showBrowserNotification(notificationData);

  // Try to forward notification to main thread if clients are available
  event.waitUntil(
    Promise.all([
      notificationPromise,
      broadcastToClients({
        type: 'PUSH_NOTIFICATION_RECEIVED',
        data: notificationData
      }).catch(error => {
        console.log('[SW] No clients available to broadcast to, but notification shown:', error.message);
        // This is expected when browser is closed, don't treat as error
      })
    ])
  );
});

function showBrowserNotification(notificationData) {
  try {
    const title = notificationData.title || 'New Notification from Zuzzuu';
    const options = {
      body: notificationData.message || notificationData.body || '',
      icon: notificationData.logo_url || notificationData.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      badge: notificationData.logo_url || notificationData.badge || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      image: notificationData.image_url || notificationData.image || '',
      tag: notificationData.id || 'zuzzuu-notification-' + Date.now(),
      data: notificationData,
      requireInteraction: false,
      silent: false
    };

    console.log('[SW] Showing browser notification:', title, options);

    return self.registration.showNotification(title, options);
  } catch (error) {
    console.error('[SW] Error showing browser notification:', error);
    return Promise.resolve();
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

function broadcastToClients(message) {
  self.clients.matchAll().then(clients => {
    console.log(`[SW] Broadcasting message to ${clients.length} clients:`, message.type);
    clients.forEach(client => {
      try {
        // Sanitize the message before sending to avoid DataCloneError
        const sanitizedMessage = sanitizeForPostMessage(message);
        client.postMessage(sanitizedMessage);
      } catch (error) {
        console.error('[SW] Error sending message to client:', error);
        // Try sending a minimal error message if the original fails
        try {
          client.postMessage({
            type: 'BROADCAST_ERROR',
            data: { error: 'Failed to send original message due to serialization error' }
          });
        } catch (fallbackError) {
          console.error('[SW] Even fallback message failed:', fallbackError);
        }
      }
    });
  }).catch(error => {
    console.error('[SW] Error getting clients for broadcast:', error);
  });
}

// Handle notification click
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked:', event.notification);
  event.notification.close();
  
  const data = event.notification.data || {};
  const url = data.url || data.action_url || '/';
  
  event.waitUntil(
    self.clients.openWindow(url)
  );
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
