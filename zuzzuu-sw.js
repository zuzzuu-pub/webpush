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
    case 'SIMULATE_WEBSOCKET_MESSAGE':
      // Handle simulated WebSocket messages for testing
      console.log('[SW] Simulating WebSocket message:', event.data.data);
      handleWebSocketMessage({ data: JSON.stringify(event.data.data) });
      break;
    case 'SIMULATE_PUSH_MESSAGE':
      // Test simulation for Push messages
      console.log('[SW] Simulating Push message:', data);
      showBrowserNotification(data);
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
async function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('[SW] WebSocket message received:', data);

    if (data.type === 'notification') {
      // Support both { type: 'notification', ...fields } and { type: 'notification', data: {...fields} }
      const notificationData = data.data ? data.data : data;

      console.log('[SW] Processing WebSocket notification data:', notificationData);

      // Check if image_url exists but appears to be loading/null
      const hasImageField = notificationData.image_url !== undefined ||
                           notificationData.image !== undefined ||
                           (notificationData.template && (notificationData.template.image_url !== undefined || notificationData.template.image !== undefined)) ||
                           (notificationData.data && (notificationData.data.image_url !== undefined || notificationData.data.image !== undefined));
      
      // Add delay if we detect fast data arrival with potential image loading
      if (hasImageField) {
        console.log('[SW] Image field detected - adding delay to ensure image loading completes');
        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay for image loading
        console.log('[SW] Image loading delay completed');
      }

      // Forward notification to main thread
      broadcastToClients({
        type: 'NOTIFICATION_RECEIVED',
        data: notificationData
      });

      // Show browser notification with proper image handling
      await showBrowserNotificationFromWebSocket(notificationData);
      
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
async function showBrowserNotificationFromWebSocket(notificationData) {
  try {
    console.log('[SW] WebSocket notificationData:', JSON.stringify(notificationData, null, 2));
    console.log('[SW] WebSocket notificationData keys:', Object.keys(notificationData));

    // Check for logo_url in nested template if main logo_url is null/empty
    const logoUrl = notificationData.logo_url ||
                   (notificationData.template && notificationData.template.logo_url) ||
                   'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg';
    
    // Enhanced image URL handling - check multiple possible fields like the custom notification does
    console.log('[SW] Checking for image_url in these fields:');
    console.log('[SW] - notificationData.image_url:', notificationData.image_url);
    console.log('[SW] - notificationData.image:', notificationData.image);
    console.log('[SW] - notificationData.template?.image_url:', notificationData.template && notificationData.template.image_url);
    console.log('[SW] - notificationData.template?.image:', notificationData.template && notificationData.template.image);
    console.log('[SW] - notificationData.data?.image_url:', notificationData.data && notificationData.data.image_url);
    console.log('[SW] - notificationData.data?.image:', notificationData.data && notificationData.data.image);
    
    const imageUrl = notificationData.image_url ||
                     notificationData.image ||
                     (notificationData.template && notificationData.template.image_url) ||
                     (notificationData.template && notificationData.template.image) ||
                     (notificationData.data && notificationData.data.image_url) ||
                     (notificationData.data && notificationData.data.image) ||
                     undefined;

    console.log('[SW] WebSocket imageUrl resolved to:', imageUrl);
    console.log('[SW] WebSocket notification will include image:', imageUrl ? 'YES' : 'NO');
    
    // Validate and preload image if present
    let validatedImageUrl = undefined;
    if (imageUrl) {
      console.log('[SW] Image URL validation:');
      console.log('[SW] - Is valid URL format:', /^https?:\/\//.test(imageUrl));
      console.log('[SW] - Is Cloudinary URL:', imageUrl.includes('cloudinary.com'));
      console.log('[SW] - URL length:', imageUrl.length);
      
      // Preload and validate image
      validatedImageUrl = await preloadAndValidateImage(imageUrl);
      console.log('[SW] Image validation result:', validatedImageUrl ? 'SUCCESS' : 'FAILED');
    }

    const title = notificationData.title || 'New Notification from Zuzzuu';
    const options = {
      body: notificationData.message || '',
      icon: logoUrl,
      badge: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      image: validatedImageUrl, // Use validated image URL
      tag: notificationData.id || 'zuzzuu-websocket-notification-' + Date.now(),
      data: notificationData,
      requireInteraction: false,
      silent: false,
      renotify: true,
      vibrate: [200, 100, 200]
    };
    
    console.log('[SW] Showing WebSocket notification:', title);
    console.log('[SW] Final notification options:', JSON.stringify(options, null, 2));
    
    self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] WebSocket notification displayed successfully');
        if (validatedImageUrl) {
          console.log('[SW] ✅ Notification displayed WITH image');
        } else {
          console.log('[SW] ⚠️ Notification displayed WITHOUT image');
        }
      })
      .catch(error => {
        console.error('[SW] Failed to show WebSocket notification:', error);
        // Fallback: show notification without image
        return showFallbackNotificationWithoutImage(title, notificationData);
      });
      
  } catch (error) {
    console.error('[SW] Error showing WebSocket notification:', error);
    // Fallback: show basic notification
    return showFallbackNotificationWithoutImage(
      notificationData.title || 'New Notification from Zuzzuu',
      notificationData
    );
  }
}

// Enhanced preload and validate image with retry mechanism
async function preloadAndValidateImage(imageUrl, retryCount = 0, maxRetries = 3) {
  try {
    console.log('[SW] Preloading image (attempt', retryCount + 1, '/', maxRetries + 1, '):', imageUrl);
    
    // Basic URL validation
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.log('[SW] Invalid image URL: not a string');
      return null;
    }
    
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      console.log('[SW] Invalid image URL: not HTTP/HTTPS');
      return null;
    }
    
    // Add progressive delay for retries (200ms, 500ms, 1000ms)
    if (retryCount > 0) {
      const delay = Math.min(200 * Math.pow(2, retryCount - 1), 1000);
      console.log(`[SW] Waiting ${delay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Try to fetch the image to validate it exists and is accessible
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    try {
      // First try a HEAD request
      let response = await fetch(imageUrl, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'cors',
        cache: 'force-cache'
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.log('[SW] HEAD request failed:', response.status, response.statusText);
        
        // If HEAD fails, try GET request (some servers don't support HEAD)
        const getController = new AbortController();
        const getTimeoutId = setTimeout(() => getController.abort(), 15000);
        
        try {
          response = await fetch(imageUrl, {
            method: 'GET',
            signal: getController.signal,
            mode: 'cors',
            cache: 'force-cache'
          });
          
          clearTimeout(getTimeoutId);
          
          if (!response.ok) {
            console.log('[SW] GET request also failed:', response.status, response.statusText);
            
            // Retry if we haven't reached max retries
            if (retryCount < maxRetries) {
              console.log('[SW] Retrying image validation...');
              return await preloadAndValidateImage(imageUrl, retryCount + 1, maxRetries);
            }
            
            return null;
          }
        } catch (getError) {
          clearTimeout(getTimeoutId);
          console.log('[SW] GET request error:', getError.message);
          
          // Retry if we haven't reached max retries
          if (retryCount < maxRetries) {
            console.log('[SW] Retrying image validation after GET error...');
            return await preloadAndValidateImage(imageUrl, retryCount + 1, maxRetries);
          }
          
          // If all requests fail but it's a CORS issue, still try to use the image
          if (getError.name === 'TypeError' || getError.message.includes('CORS')) {
            console.log('[SW] CORS issue detected, attempting to use image anyway');
            return imageUrl;
          }
          
          return null;
        }
      }
      
      // Check if it's actually an image
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) {
        console.log('[SW] URL is not an image, content-type:', contentType);
        
        // Retry if we haven't reached max retries (content might be loading)
        if (retryCount < maxRetries) {
          console.log('[SW] Retrying - content might still be loading...');
          return await preloadAndValidateImage(imageUrl, retryCount + 1, maxRetries);
        }
        
        return null;
      }
      
      console.log('[SW] ✅ Image validation successful after', retryCount + 1, 'attempts');
      return imageUrl;
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[SW] Image fetch error:', fetchError.message);
      
      // Retry if we haven't reached max retries
      if (retryCount < maxRetries) {
        console.log('[SW] Retrying image validation after fetch error...');
        return await preloadAndValidateImage(imageUrl, retryCount + 1, maxRetries);
      }
      
      // If all retries fail but it's a CORS issue, still try to use the image
      if (fetchError.name === 'TypeError' || fetchError.message.includes('CORS')) {
        console.log('[SW] CORS issue detected after retries, attempting to use image anyway');
        return imageUrl;
      }
      
      return null;
    }
    
  } catch (error) {
    console.error('[SW] Image preload error:', error);
    
    // Retry if we haven't reached max retries
    if (retryCount < maxRetries) {
      console.log('[SW] Retrying image validation after general error...');
      return await preloadAndValidateImage(imageUrl, retryCount + 1, maxRetries);
    }
    
    return null;
  }
}

// Fallback notification without image
function showFallbackNotificationWithoutImage(title, notificationData) {
  console.log('[SW] Showing fallback notification without image');
  
  const options = {
    body: notificationData.message || 'You have a new notification',
    icon: notificationData.logo_url || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    badge: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    // No image property - fallback without image
    tag: notificationData.id || 'zuzzuu-fallback-notification-' + Date.now(),
    data: notificationData,
    requireInteraction: false,
    silent: false,
    renotify: true,
    vibrate: [200, 100, 200]
  };
  
  return self.registration.showNotification(title, options)
    .then(() => {
      console.log('[SW] Fallback notification displayed successfully (without image)');
    })
    .catch(error => {
      console.error('[SW] Even fallback notification failed:', error);
    });
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

  async function handlePushNotificationWithDelay() {
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
              image_url: parsedData.data?.image_url, // Also check for image_url in data
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

    // Check if image field exists and add delay for fast data arrival
    const hasImageField = notificationData.image_url !== undefined ||
                          notificationData.image !== undefined ||
                          (notificationData.template && (notificationData.template.image_url !== undefined || notificationData.template.image !== undefined)) ||
                          (notificationData.data && (notificationData.data.image_url !== undefined || notificationData.data.image !== undefined));
    
    if (hasImageField) {
      console.log('[SW] Push notification: Image field detected - adding delay to ensure image loading completes');
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay for image loading
      console.log('[SW] Push notification: Image loading delay completed');
    }

    console.log('[SW] Final push notification data to display:', notificationData);

    // Always show browser notification - this is critical for browser-closed scenarios
    const notificationPromise = showBrowserNotification(notificationData);

    // Check if any clients are available and forward if possible
    const clientsPromise = checkAndNotifyClients(notificationData);

    // Wait for both operations to complete
    return Promise.all([notificationPromise, clientsPromise])
      .then(() => {
        console.log('[SW] Push notification handling completed successfully');
      })
      .catch(error => {
        console.error('[SW] Error in push notification handling:', error);
        // Even if there's an error, try to show a basic notification
        return showFallbackNotification();
      });
  }

  // Wait for the async push notification handling with delay
  event.waitUntil(handlePushNotificationWithDelay());
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
async function showBrowserNotification(notificationData) {
  try {
    console.log('[SW] Push notificationData:', JSON.stringify(notificationData, null, 2));
    
    // Ensure we have a title
    let title = notificationData.title || notificationData.name || 'Zuzzuu Notification';
    
    // Ensure we have a message
    let body = notificationData.message || notificationData.body || notificationData.text || 'You have a new notification';
    
    // Truncate title and body if too long (browser limits)
    if (title.length > 100) title = title.substring(0, 97) + '...';
    if (body.length > 200) body = body.substring(0, 197) + '...';

    // Enhanced image URL handling - check multiple possible fields like the custom notification does
    const imageUrl = notificationData.image_url ||
                     notificationData.image ||
                     (notificationData.template && notificationData.template.image_url) ||
                     (notificationData.template && notificationData.template.image) ||
                     (notificationData.data && notificationData.data.image_url) ||
                     (notificationData.data && notificationData.data.image) ||
                     undefined;

    console.log('[SW] Push imageUrl resolved to:', imageUrl);
    console.log('[SW] Push notification will include image:', imageUrl ? 'YES' : 'NO');

    // Validate and preload image if present
    let validatedImageUrl = undefined;
    if (imageUrl) {
      validatedImageUrl = await preloadAndValidateImage(imageUrl);
      console.log('[SW] Push image validation result:', validatedImageUrl ? 'SUCCESS' : 'FAILED');
    }

    const options = {
      body: body,
      icon: notificationData.logo_url || notificationData.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      badge: notificationData.logo_url || notificationData.badge || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
      image: validatedImageUrl, // Use validated image URL
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

    console.log('[SW] Showing enhanced push notification (Firebase-style):', title);
    console.log('[SW] Push notification final options:', JSON.stringify(options, null, 2));
    console.log('[SW] Push notification will display even when browser is closed');

    return self.registration.showNotification(title, options)
      .then(() => {
        console.log('[SW] Push notification displayed successfully');
        if (validatedImageUrl) {
          console.log('[SW] ✅ Push notification displayed WITH image');
        } else {
          console.log('[SW] ⚠️ Push notification displayed WITHOUT image');
        }
        return true;
      })
      .catch(error => {
        console.error('[SW] Failed to show push notification, trying fallback:', error);
        // Try showing a fallback without image
        return showFallbackNotificationWithoutImage(title, notificationData);
      });
  } catch (error) {
    console.error('[SW] Critical error showing push notification:', error);
    // Last resort fallback
    return showFallbackNotificationWithoutImage(title || 'Zuzzuu Notification', notificationData || {});
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
