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

// Handle push notifications - Enhanced for browser-closed scenarios
self.addEventListener('push', function(event) {
  console.log('[SW] Push notification received, event data:', event.data ? 'present' : 'empty');

  let notificationData = {};

  // Parse notification data with enhanced error handling
  if (event.data) {
    try {
      const rawData = event.data.text();
      console.log('[SW] Raw push data:', rawData);
      
      // Try to parse as JSON first
      try {
        notificationData = JSON.parse(rawData);
        console.log('[SW] Parsed JSON notification data:', notificationData);
      } catch (jsonError) {
        console.log('[SW] Not JSON, treating as text:', rawData);
        notificationData = {
          title: 'New Notification',
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

  console.log('[SW] Final notification data to display:', notificationData);

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
          console.log('[SW] Notification forwarded to client');
        } catch (error) {
          console.error('[SW] Error forwarding notification to client:', error);
        }
      });
      return true;
    } else {
      console.log('[SW] No clients available - browser likely closed, notification will show via system');
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

// Enhanced browser notification display with better options
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
      tag: notificationData.id ? `zuzzuu-${notificationData.id}` : `zuzzuu-notification-${Date.now()}`,
      data: {
        // Store essential data only to avoid serialization issues
        id: notificationData.id,
        url: notificationData.url || notificationData.action_url,
        timestamp: new Date().toISOString(),
        original_data: notificationData
      },
      requireInteraction: false, // Don't require user interaction
      silent: false, // Play notification sound
      renotify: true, // Show even if a notification with same tag exists
      vibrate: [200, 100, 200], // Vibration pattern for mobile
      actions: [] // Keep empty for now to avoid compatibility issues
    };

    // Add actions if URL is provided
    if (notificationData.url || notificationData.action_url) {
      options.actions = [
        {
          action: 'open',
          title: 'Open',
          icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg'
        }
      ];
    }

    console.log('[SW] Showing enhanced browser notification:', title, options);
    console.log('[SW] Notification will display even when browser is closed');

    return self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] Browser notification displayed successfully');
        return true;
      })
      .catch(error => {
        console.error('[SW] Failed to show notification, trying fallback:', error);
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
    console.error('[SW] Critical error showing browser notification:', error);
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

// Enhanced notification click handling
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Notification clicked:', event.notification.tag);
  console.log('[SW] Notification data:', event.notification.data);
  
  // Close the notification
  event.notification.close();
  
  const data = event.notification.data || {};
  const originalData = data.original_data || {};
  
  // Determine the URL to open
  let url = data.url || originalData.url || originalData.action_url || '/';
  
  // If no specific URL, open the main application
  if (!url || url === '/') {
    url = self.location.origin;
  }

  console.log('[SW] Opening URL:', url);

  event.waitUntil(
    // First, try to focus an existing window with the same URL
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
            data: sanitizeForPostMessage(originalData)
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
