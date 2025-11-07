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

// Auto-register service worker and handle initialization
if (typeof window !== 'undefined') {
  // Only run in main thread, not in service worker context
  if (!self.registration) {
    // Automatically register service worker on page load
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        console.log("[Auto-SW] Registering service worker automatically...");

        navigator.serviceWorker
          .register("zuzzuu-sw.js", {
            scope: "/", // Use root scope for broader coverage
          })
          .then(function (registration) {
            console.log("[Auto-SW] Service Worker registered successfully:", registration);

            // Notify the notification system that service worker is now registered
            if (window.ZuzzuuNotificationSystem && window.ZuzzuuNotificationSystem.state) {
              window.ZuzzuuNotificationSystem.state.serviceWorkerRegistered = true;
              window.ZuzzuuNotificationSystem.log("success", "ðŸ‘· Service Worker auto-registered successfully");
              window.ZuzzuuNotificationSystem.updateUI();
            }

            // Only request notification permission if not already granted and not already requested
            if ("Notification" in window && Notification.permission === "default") {
              console.log("[Auto-SW] Requesting notification permission...");
              Notification.requestPermission().then(function (permission) {
                console.log("[Auto-SW] Notification permission:", permission);
                if (permission === "granted") {
                  // Only show welcome notification if not shown before
                  const welcomeShown = localStorage.getItem('zuzzuu_welcome_notification_shown');
                  if (!welcomeShown) {
                    setTimeout(() => {
                      registration.showNotification("Zuzzuu Notifications Active", {
                        body: "Push notifications are now enabled! You'll receive notifications even when the browser is closed.",
                        icon: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
                        badge: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
                        tag: "zuzzuu-auto-setup-" + Date.now(),
                        requireInteraction: false,
                        silent: false,
                        data: {
                          url: window.location.href,
                          source: "auto-setup",
                        },
                      });
                      localStorage.setItem('zuzzuu_welcome_notification_shown', 'true');
                    }, 1000);
                  }

                  // Update notification system UI for notification permission
                  if (window.ZuzzuuNotificationSystem && window.ZuzzuuNotificationSystem.updateUI) {
                    setTimeout(() => {
                      window.ZuzzuuNotificationSystem.updateUI();
                    }, 100);
                  }
                }
              });
            }
          })
          .catch(function (error) {
            console.error("[Auto-SW] Service Worker registration failed:", error);

            // Notify notification system of failure
            if (window.ZuzzuuNotificationSystem && window.ZuzzuuNotificationSystem.log) {
              window.ZuzzuuNotificationSystem.log("error", `ðŸ‘· Service Worker auto-registration failed: ${error.message}`);
            }
          });
      });
    } else {
      console.warn("[Auto-SW] Service Workers not supported in this browser");

      // Update notification system to show "Not Supported"
      if (window.ZuzzuuNotificationSystem && window.ZuzzuuNotificationSystem.log) {
        window.ZuzzuuNotificationSystem.log("warning", "ðŸ‘· Service Worker not supported in this browser");
        setTimeout(() => {
          if (window.ZuzzuuNotificationSystem.updateUI) {
            window.ZuzzuuNotificationSystem.updateUI();
          }
        }, 100);
      }
    }
  }
}

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
      // Test simulation for WebSocket messages
      console.log('[SW] Simulating WebSocket message:', data);
      handleWebSocketMessage({ data: JSON.stringify(data) });
      break;
    case 'SIMULATE_PUSH_MESSAGE':
      // Test simulation for Push messages
      console.log('[SW] Simulating Push message:', data);
      showBrowserNotification(data);
      break;
    case 'SHOW_SITE_WIDE_NOTIFICATION':
      console.log('[SW] Site-wide notification requested:', data);
      showSiteWideNotification(data);
      break;
    case 'SHOW_WELCOME_NOTIFICATION':
      console.log('[SW] Welcome notification requested');
      // Only show welcome notification if not shown before
      const welcomeShown = localStorage.getItem ? localStorage.getItem('zuzzuu_welcome_notification_shown') : 'true';
      if (welcomeShown !== 'true') {
        // Show notification directly from service worker if possible
        if (event.data && event.data.data) {
          showBrowserNotification(event.data.data);
        } else {
          // Fallback to default welcome notification
          showBrowserNotification({
            title: "Zuzzuu Notifications Active",
            body: "Push notifications are now enabled! You'll receive notifications even when the browser is closed.",
            icon: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
            badge: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
            tag: "zuzzuu-welcome-" + Date.now(),
            requireInteraction: false,
            silent: false,
            data: {
              url: self.location.origin,
              source: "welcome-setup",
            },
          });
        }
        // Mark as shown
        if (localStorage) {
          localStorage.setItem('zuzzuu_welcome_notification_shown', 'true');
        }
      } else {
        console.log('[SW] Welcome notification already shown, skipping');
      }
      break;
    case 'SHOW_SYSTEM_NOTIFICATION':
      console.log('[SW] System notification requested:', data);
      // Forward to main thread for system notification display
      broadcastToClients({
        type: 'SHOW_SYSTEM_NOTIFICATION',
        data: data
      });
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
async function showBrowserNotificationFromWebSocket(notificationData) {
  console.log('[SW] WebSocket notificationData:', JSON.stringify(notificationData, null, 2));

  // Add WebSocket-specific metadata
  const enhancedData = {
    ...notificationData,
    source: 'websocket',
    requireInteraction: false,
    silent: false,
    renotify: true
  };

  // Forward to main thread for system notification display
  broadcastToClients({
    type: 'SHOW_SYSTEM_NOTIFICATION',
    data: enhancedData
  });
}

// Preload and validate image for notification
async function preloadAndValidateImage(imageUrl) {
  try {
    console.log('[SW] Preloading image:', imageUrl);
    
    // Basic URL validation
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.log('[SW] Invalid image URL: not a string');
      return null;
    }
    
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      console.log('[SW] Invalid image URL: not HTTP/HTTPS');
      return null;
    }
    
    // Try to fetch the image to validate it exists and is accessible
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    try {
      const response = await fetch(imageUrl, {
        method: 'HEAD', // Only get headers, not the full image
        signal: controller.signal,
        mode: 'cors', // Allow CORS
        cache: 'force-cache' // Use cache if available
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.log('[SW] Image fetch failed:', response.status, response.statusText);
        return null;
      }
      
      // Check if it's actually an image
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        console.log('[SW] URL is not an image, content-type:', contentType);
        return null;
      }
      
      console.log('[SW] âœ… Image validation successful');
      return imageUrl;
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[SW] Image fetch error:', fetchError.message);
      
      // If CORS fails, still try to use the image - browsers might handle it differently for notifications
      if (fetchError.name === 'TypeError' || fetchError.message.includes('CORS')) {
        console.log('[SW] CORS issue detected, but attempting to use image anyway');
        return imageUrl; // Return original URL, let browser notification handle CORS
      }
      
      return null;
    }
    
  } catch (error) {
    console.error('[SW] Image preload error:', error);
    return null;
  }
}

/**
 * Enhanced image preload with timeout
 */
async function preloadAndValidateImageWithTimeout(imageUrl, timeout = 10000) {
  try {
    console.log('[SW] Preloading image with timeout:', imageUrl);
    
    if (!imageUrl || typeof imageUrl !== 'string') {
      console.log('[SW] Invalid image URL: not a string');
      return null;
    }
    
    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      console.log('[SW] Invalid image URL: not HTTP/HTTPS');
      return null;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(imageUrl, {
        method: 'HEAD',
        signal: controller.signal,
        mode: 'cors',
        cache: 'force-cache'
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.log('[SW] Image fetch failed:', response.status, response.statusText);
        return null;
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        console.log('[SW] URL is not an image, content-type:', contentType);
        return null;
      }
      
      console.log('[SW] âœ… Image validation successful');
      return imageUrl;
      
    } catch (fetchError) {
      clearTimeout(timeoutId);
      console.log('[SW] Image fetch error:', fetchError.message);
      
      // For CORS issues, still try to use the image
      if (fetchError.name === 'TypeError' || fetchError.message.includes('CORS')) {
        console.log('[SW] CORS issue detected, attempting to use image anyway');
        return imageUrl;
      }
      
      return null;
    }
    
  } catch (error) {
    console.error('[SW] Image preload error:', error);
    return null;
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

  // Only show browser notification if there's actual notification data
  // Skip welcome/setup notifications that appear on every refresh
  let notificationPromise;
  if (notificationData.source !== 'welcome-setup' &&
      notificationData.source !== 'auto-setup' &&
      notificationData.source !== 'service-worker-setup') {
    notificationPromise = showBrowserNotification(notificationData);
  } else {
    console.log('[SW] Skipping welcome/setup notification in push handler');
    notificationPromise = Promise.resolve();
  }

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
      let successCount = 0;
      let failureCount = 0;

      for (const client of clients) {
        try {
          client.postMessage({
            type: 'PUSH_NOTIFICATION_RECEIVED',
            data: sanitizeForPostMessage(notificationData)
          });
          console.log('[SW] Push notification forwarded to client');
          successCount++;
        } catch (error) {
          console.error('[SW] Error forwarding push notification to client:', error);
          failureCount++;
        }
      }

      console.log(`[SW] Notification forwarding complete: ${successCount} success, ${failureCount} failures`);
      return successCount > 0; // Return true if at least one client received the notification
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
  console.log('[SW] Notification data to display:', JSON.stringify(notificationData, null, 2));

  // Ensure we have required fields
  if (!notificationData.title && !notificationData.body) {
    notificationData.title = 'Zuzzuu Notification';
    notificationData.body = 'You have a new notification';
  }

  // Set default options for browser notification
  const options = {
    body: notificationData.body || notificationData.message || 'You have a new notification',
    icon: notificationData.icon || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    badge: notificationData.badge || 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
    tag: notificationData.tag || 'zuzzuu-notification-' + Date.now(),
    requireInteraction: notificationData.requireInteraction !== false,
    silent: notificationData.silent === true,
    renotify: notificationData.renotify !== false,
    data: notificationData.data || {
      url: notificationData.url || self.location.origin,
      source: notificationData.source || 'service-worker',
      timestamp: new Date().toISOString()
    }
  };

  // Add image if provided
  if (notificationData.image) {
    options.image = notificationData.image;
  }

  try {
    console.log('[SW] Showing browser notification with options:', options);

    // Show the notification directly using Service Worker API
    const notification = await self.registration.showNotification(notificationData.title, options);

    console.log('[SW] Browser notification shown successfully:', notificationData.title);

    // Also forward to main thread for in-app notification display
    broadcastToClients({
      type: 'SHOW_SYSTEM_NOTIFICATION',
      data: {
        ...notificationData,
        source: 'service-worker',
        displayed: true
      }
    });

    return notification;
  } catch (error) {
    console.error('[SW] Error showing browser notification:', error);

    // Fallback: try to show a basic notification
    try {
      return await self.registration.showNotification('Zuzzuu Notification', {
        body: 'You have a new notification',
        icon: 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg',
        tag: 'zuzzuu-fallback-' + Date.now(),
        data: { source: 'fallback', timestamp: new Date().toISOString() }
      });
    } catch (fallbackError) {
      console.error('[SW] Even fallback notification failed:', fallbackError);
    }
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

/**
 * Sanitize message for postMessage to avoid DataCloneError
 */
function sanitizeForPostMessage(message) {
  try {
    // Create a clean copy of the message
    return JSON.parse(JSON.stringify(message));
  } catch (error) {
    console.error('[SW] Error sanitizing message:', error);
    // Return a minimal safe message
    return {
      type: message.type || 'UNKNOWN',
      data: { error: 'Message serialization failed' }
    };
  }
}
