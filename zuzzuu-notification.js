/**
 * Zuzzuu Notification System
 * 
 * This file handles displaying notifications from the server
 * and manages WebSocket connections for real-time updates.
 */

class ZuzzuuNotification {
  constructor(options = {}) {
    // Default Zuzzuu logo URL from environment variable or fallback
    const defaultLogoUrl = 'https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg';

    // Use production URL by default (vibte.shop)
    const apiBaseUrl = options.apiUrl || "https://vibte.shop/api/v1";
    const socketUrl = options.socketUrl || "https://vibte.shop";

    this.options = {
      apiUrl: apiBaseUrl,
      socketUrl: socketUrl,
      debug: options.debug || true,
      autoConnect: options.autoConnect !== false,
      heartbeatInterval: options.heartbeatInterval || 30000,
      onNotificationClick: options.onNotificationClick || null,
      onConnectionChange: options.onConnectionChange || null,
      logoUrl: options.logoUrl || defaultLogoUrl, // Default Zuzzuu logo URL
      vapidPublicKey: options.vapidPublicKey || null // VAPID public key for push notifications
    };

    // Create CSS styles
    this.createStyles();

    // Socket.IO connection
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.isOnline = navigator.onLine;

    // Push notification subscription
    this.pushSubscription = null;
    this.pushSupported = 'serviceWorker' in navigator && 'PushManager' in window;

    // Notification container
    this.notificationContainer = null;
    this.notifications = [];

    // Get subscriber ID
    this.subscriberId = localStorage.getItem('zuzzuu_subscriber_id');

    // Create notification container
    this.createNotificationContainer();

    // Set up network listeners
    this.setupNetworkListeners();

    // Check if service worker is available
    this.useServiceWorker = 'serviceWorker' in navigator;

    // Add connection state tracking
    this.isConnecting = false;
    this.connectionAttempted = false;

    // Check stored connection state
    const storedConnectionState = localStorage.getItem('zuzzuu_socketio_connection_state');
    let socketConnectionState = { connected: false, subscriberId: null };

    if (storedConnectionState) {
      try {
        socketConnectionState = JSON.parse(storedConnectionState);
      } catch (e) {
        this.log('Error parsing stored connection state:', e);
      }
    }

    // Don't auto-connect if already connected or if subscriber registration might be in progress
    const hasConsent = localStorage.getItem('zuzzuu_notification_consent');
    const isRejected = localStorage.getItem('zuzzuu_notification_rejected');

    // Only auto-connect if user has consented, not rejected, and not already connected
    if (this.options.autoConnect &&
        this.subscriberId &&
        hasConsent &&
        !isRejected &&
        (!socketConnectionState.connected || socketConnectionState.subscriberId !== this.subscriberId)) {
      // Add delay to avoid conflicts with registration
      setTimeout(() => {
        this.connect();
        // Also set up push notifications after connection
        this.setupPushNotifications();
      }, 3000);
    } else if (socketConnectionState.connected && socketConnectionState.subscriberId === this.subscriberId) {
      this.log('Already connected according to stored state');
      this.connected = true;
      // Still set up push notifications
      this.setupPushNotifications();
    }

    // Set up service worker message listener for notifications
    this.setupServiceWorkerListener();

    this.log('Zuzzuu Notification initialized with Socket.IO and Push support:', this.pushSupported);
  }

  /**
   * Set up service worker message listener
   */
  setupServiceWorkerListener() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, data } = event.data;
        this.log('Service worker message received:', type, data);
        
        switch (type) {
          case 'NOTIFICATION_RECEIVED':
            this.log('Ã°Å¸â€œÂ§ Notification received from service worker:', data);
            // Handle the notification data
            const notificationData = data.data || data;
            this.handleNotification(notificationData);
            break;
          case 'SOCKETIO_CONNECTED':
            this.connected = true;
            this.isConnecting = false;
            this.log(' Socket.IO connected via service worker');
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(true);
            }
            break;
          case 'SOCKETIO_DISCONNECTED':
            this.connected = false;
            this.isConnecting = false;
            this.log('Ã¢ÂÅ’ Socket.IO disconnected via service worker');
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(false);
            }
            break;
          case 'SOCKETIO_ERROR':
            this.connected = false;
            this.isConnecting = false;
            this.log('Â Socket.IO error via service worker:', data);
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(false);
            }
            break;
          case 'SHOW_SYSTEM_NOTIFICATION':
            this.log('Ã°Å¸â€œÂ§ System notification requested from service worker:', data);
            this.showBrowserNotification(data);
            break;
          case 'SHOW_WEBSOCKET_NOTIFICATION':
            this.log('Ã°Å¸â€œÂ§ WebSocket notification requested from service worker:', data);
            this.handleNotification(data);
            break;
          case 'SHOW_SITE_WIDE_NOTIFICATION':
            this.log('Ã°Å¸â€œÂ§ Site-wide notification requested from service worker:', data);
            this.showInAppNotification(data);
            break;
        }
      });
    }
  }
  
  /**
   * Create and inject CSS styles
   */
  createStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .zuzzuu-notification-container {
        position: fixed;
        top: 20px;
        right: 20px;
        width: 380px;
        max-width: 100%;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .zuzzuu-notification {
        background-color: white;
        border-radius: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        margin-bottom: 10px;
        animation: zuzzuu-slide-in 0.3s ease-out forwards;
        max-width: 100%;
        position: relative;
        cursor: pointer;
        overflow: hidden;
        transition: transform 0.2s ease;
        border: 1px solid rgba(0,0,0,0.05);
      }
      
      .zuzzuu-notification:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0,0,0,0.12);
      }
      
      .zuzzuu-notification-close {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: rgba(0,0,0,0.05);
        color: #555;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        cursor: pointer;
        transition: background-color 0.2s ease;
        z-index: 10;
      }
      
      .zuzzuu-notification-close:hover {
        background-color: rgba(0,0,0,0.1);
      }
      
      /* Image container at the top */
      .zuzzuu-notification-image-container {
        width: 100%;
        height: 140px;
        overflow: hidden;
      }
      
      .zuzzuu-notification-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      /* Preview container with icon and content */
      .zuzzuu-notification-preview {
        display: flex;
        padding: 12px;
      }
      
      /* Icon container */
      .zuzzuu-notification-icon {
        width: 32px;
        height: 32px;
        min-width: 32px;
        margin-right: 12px;
        border-radius: 4px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .zuzzuu-notification-icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      
      /* Content container */
      .zuzzuu-notification-content {
        flex: 1;
        min-width: 0;
      }
      
      .zuzzuu-notification-title {
        font-weight: 600;
        font-size: 14px;
        margin: 0 0 6px 0;
        padding-right: 20px;
        color: #333;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      .zuzzuu-notification-message {
        font-size: 13px;
        margin: 0 0 6px 0;
        color: #666;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        line-height: 1.4;
      }
      
      .zuzzuu-notification-url {
        font-size: 12px;
        color: #6366f1;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0.8;
      }
      
      @keyframes zuzzuu-slide-in {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes zuzzuu-fade-out {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
      
      .zuzzuu-notification.closing {
        animation: zuzzuu-fade-out 0.3s ease-in forwards;
      }
      
      /* Connectivity notification styles */
      .zuzzuu-connectivity-notification {
        border-left: 4px solid #6366f1;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-online {
        border-left-color: #10b981;
        background-color: #f0fdf4;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-offline {
        border-left-color: #ef4444;
        background-color: #fef2f2;
      }
      
      .zuzzuu-connectivity-notification .zuzzuu-notification-title {
        color: #1f2937;
        font-weight: 700;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-online .zuzzuu-notification-title {
        color: #065f46;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-offline .zuzzuu-notification-title {
        color: #991b1b;
      }
      
      .zuzzuu-connectivity-notification .zuzzuu-notification-message {
        color: #4b5563;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-online .zuzzuu-notification-message {
        color: #047857;
      }
      
      .zuzzuu-connectivity-notification.zuzzuu-connectivity-offline .zuzzuu-notification-message {
        color: #dc2626;
      }
      
      .zuzzuu-connectivity-icon {
        border-radius: 50% !important;
        font-size: 20px !important;
        animation: connectivity-pulse 2s infinite;
      }
      
      @keyframes connectivity-pulse {
        0%, 100% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(1.1);
          opacity: 0.8;
        }
      }
    `;
    
    document.head.appendChild(styleElement);
  }
  
  /**
   * Create notification container
   */
  createNotificationContainer() {
    this.notificationContainer = document.createElement('div');
    this.notificationContainer.className = 'zuzzuu-notification-container';
    document.body.appendChild(this.notificationContainer);
  }
  
  /**
   * Connect to Socket.IO (updated to work with service worker)
   */
  connect() {
    if (this.isConnecting) {
      this.log('Connection already in progress');
      return;
    }

    // Check stored connection state
    const storedConnectionState = localStorage.getItem('zuzzuu_socketio_connection_state');
    if (storedConnectionState) {
      try {
        const socketState = JSON.parse(storedConnectionState);
        if (socketState.connected && socketState.subscriberId === this.subscriberId) {
          this.log('Already connected according to stored state');
          this.connected = true;
          return;
        }
      } catch (e) {
        this.log('Error parsing stored connection state:', e);
      }
    }

    // Check if subscriber ID exists
    const currentSubscriberId = localStorage.getItem('zuzzuu_subscriber_id');
    if (!currentSubscriberId) {
      this.log('No subscriber ID found, cannot connect');
      return;
    }

    this.subscriberId = currentSubscriberId;
    this.isConnecting = true;

    if (this.useServiceWorker && navigator.serviceWorker.controller) {
      // Use service worker for Socket.IO connection
      navigator.serviceWorker.controller.postMessage({
        type: 'CONNECT_SOCKETIO',
        data: {
          subscriberId: this.subscriberId,
          socketUrl: this.options.socketUrl
        }
      });

      // Set up timeout for connection attempt
      setTimeout(() => {
        if (this.isConnecting && !this.connected) {
          this.log('Connection attempt timed out');
          this.isConnecting = false;
          // Don't treat timeout as an error if we're using service worker
          // The service worker might still be establishing the connection
        }
      }, 15000); // Increased timeout to 15 seconds

      return;
    }

    // Direct Socket.IO connection if service worker not available
    this.log('Service worker not available, using direct Socket.IO connection');
    this.connectDirectSocketIO();
  }
  
  /**
   * Connect directly to Socket.IO (fallback when service worker not available)
   */
  connectDirectSocketIO() {
    try {
      const socketUrl = this.options.socketUrl;
      this.log('Connecting directly to Socket.IO:', socketUrl);

      // Use Socket.IO if available
      if (typeof io !== 'undefined') {
        this.socket = io(socketUrl, {
          query: {
            subscriber_id: this.subscriberId,
            client_type: 'direct_connection',
            timestamp: Date.now()
          },
          transports: ['websocket', 'polling'],
          timeout: 20000,
          forceNew: true,
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          maxReconnectionAttempts: 5
        });

        // Socket.IO event handlers
        this.socket.on('connect', () => {
          this.connected = true;
          this.isConnecting = false;
          this.log(' Connected to Socket.IO directly');
          if (this.options.onConnectionChange) {
            this.options.onConnectionChange(true);
          }
        });

        this.socket.on('disconnect', (reason) => {
          this.connected = false;
          this.isConnecting = false;
          this.log('Ã¢ÂÅ’ Disconnected from Socket.IO:', reason);
          if (this.options.onConnectionChange) {
            this.options.onConnectionChange(false);
          }
        });

        this.socket.on('connect_error', (error) => {
          this.connected = false;
          this.isConnecting = false;
          this.log('Â Socket.IO connection error:', error.message);
          if (this.options.onConnectionChange) {
            this.options.onConnectionChange(false);
          }
        });

        this.socket.on('notification', (data) => {
          this.log('Ã°Å¸â€œÂ§ Notification received via direct Socket.IO:', data);
          this.handleNotification(data);
        });

        // Set connection timeout
        setTimeout(() => {
          if (this.isConnecting && !this.connected) {
            this.log('Ã¢ÂÂ±Ã¯Â¸Â Direct Socket.IO connection timeout');
            this.isConnecting = false;
          }
        }, 20000);
      } else {
        this.log('Ã¢ÂÅ’ Socket.IO library not available for direct connection');
        this.isConnecting = false;
      }
    } catch (error) {
      this.log('Ã¢ÂÅ’ Direct Socket.IO connection failed:', error);
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from Socket.IO (updated to work with service worker)
   */
  disconnect() {
    this.isConnecting = false;
    this.connectionAttempted = false;

    if (this.useServiceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'DISCONNECT_SOCKETIO'
      });
      return;
    }

    // Disconnect direct Socket.IO connection
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.connected = false;

    if (this.options.onConnectionChange) {
      this.options.onConnectionChange(false);
    }
  }
  
  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.socket && this.connected) {
        this.log('Sending heartbeat');
        this.socket.emit('heartbeat', {
          timestamp: new Date().toISOString()
        });
      }
    }, this.options.heartbeatInterval);
  }
  
  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  /**
   * Attempt to reconnect
   */
  attemptReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    
    this.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts}) in ${this.options.reconnectInterval / 1000}s`);
    
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isOnline && !this.connected) {
        this.connect();
      }
    }, this.options.reconnectInterval);
  }
  
  /**
   * Set up network listeners
   */
  setupNetworkListeners() {
    // Handle online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.log('Browser is online');
      
      // Show online notification
      this.showConnectivityNotification({
        title: 'Connection Restored',
        message: 'Your internet connection has been restored. You will now receive notifications again.',
        type: 'online',
        icon: 'Â'
      });
      
      if (!this.connected) {
        this.connect();
      }
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.log('Browser is offline');
      
      // Show offline notification
      this.showConnectivityNotification({
        title: 'Connection Lost',
        message: 'No internet connection detected. You may not receive new notifications until connection is restored.',
        type: 'offline',
        icon: 'Ã°Å¸â€œÂ¡'
      });
      
      if (this.connected) {
        this.sendStatusUpdate('offline');
      }
    });
    
    // Handle visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.log('Document is visible');
        if (this.connected) {
          this.sendStatusUpdate('online');
        } else if (this.isOnline) {
          this.connect();
        }
      } else {
        this.log('Document is hidden');
        if (this.connected) {
          this.sendStatusUpdate('away');
        }
      }
    });
  }
  
  /**
   * Send status update
   */
  sendStatusUpdate(status) {
    if (this.connected && this.socket) {
      this.log(`Sending status update: ${status}`);
      this.socket.emit('status_update', {
        status: status,
        timestamp: new Date().toISOString()
      });
    }
  }
  
/**
 * Handle notification from server (public method)
 */
handleNotification(data) {
  // Always extract notification object - handle both direct data and wrapped data
  const notificationData = data.data || data.notification || data;

  console.log('ZuzzuuNotification: Handling notification:', notificationData);

  // Ensure we have valid notification data
  if (!notificationData) {
    console.error('ZuzzuuNotification: No notification data provided');
    return;
  }

  // Validate required fields
  if (!notificationData.title && !notificationData.message) {
    console.error('ZuzzuuNotification: Notification must have title or message');
    return;
  }

  // Ensure notification container exists
  if (!this.notificationContainer) {
    this.log('Notification container not found, creating it');
    this.createNotificationContainer();
  }

  // Enhanced duplicate prevention with better ID checking
  const notificationId = notificationData.id || `${notificationData.title}_${notificationData.message}`.substring(0, 50);
  const existingNotification = this.notifications.find(n => {
    const existingId = n.data.id || `${n.data.title}_${n.data.message}`.substring(0, 50);
    return existingId === notificationId && 
           (Date.now() - (n.timestamp || 0)) < 5000; // Only check duplicates within 5 seconds
  });

  if (existingNotification) {
    this.log('Duplicate notification detected, skipping:', notificationId);
    return;
  }

  // Store timestamp for duplicate checking
  notificationData._timestamp = Date.now();

  // Only show notifications if there's actual content from API or Socket.IO
  // Skip welcome/setup notifications that appear on every refresh
  if (notificationData.source !== 'welcome-setup' &&
      notificationData.source !== 'auto-setup' &&
      notificationData.source !== 'service-worker-setup') {

    // Show in-app notification with enhanced image support
    this.showInAppNotification(notificationData);

    // Show browser notification with improved image handling
    this.showBrowserNotification(notificationData);

    this.log('Notification handling completed for:', notificationId);
  } else {
    this.log('Skipping welcome/setup notification:', notificationId);
  }
}
  
  /**
   * Show in-app notification
   */
  showInAppNotification(data) {
    this.log('Showing in-app notification:', data);
    
    // Ensure notification container exists and is attached to DOM
    if (!this.notificationContainer || !this.notificationContainer.parentNode) {
      this.log('Notification container missing, recreating');
      this.createNotificationContainer();
    }
    
    // Create notification element
    const notificationElement = document.createElement('div');
    notificationElement.className = 'zuzzuu-notification';
    const notificationId = data.id || Date.now();
    notificationElement.dataset.id = notificationId;
    
    this.log('Created notification element with ID:', notificationId);
    
    // Create close button
    const closeButton = document.createElement('div');
    closeButton.className = 'zuzzuu-notification-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNotification(notificationElement);
    });
    notificationElement.appendChild(closeButton);
    
    // Add image container with better error handling
    const imageUrl = this.resolveImageUrl(data);
    if (imageUrl) {
      const imageContainer = document.createElement('div');
      imageContainer.className = 'zuzzuu-notification-image-container';

      const image = document.createElement('img');
      image.className = 'zuzzuu-notification-image';
      image.src = imageUrl;
      image.alt = data.title || 'Notification Image';
      
      // Enhanced image error handling
      image.onerror = () => {
        this.log('Image failed to load:', imageUrl);
        // Remove the image container if image fails
        if (imageContainer.parentNode) {
          imageContainer.parentNode.removeChild(imageContainer);
        }
      };
      
      // Image load success
      image.onload = () => {
        this.log('Image loaded successfully:', imageUrl);
      };

      imageContainer.appendChild(image);
      notificationElement.appendChild(imageContainer);
    }
    
    // Create notification preview container
    const previewContainer = document.createElement('div');
    previewContainer.className = 'zuzzuu-notification-preview';
    
    // Create icon container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'zuzzuu-notification-icon';
    
    // Use logo from data, options, or fallback to first letter
    const logoUrl = data.logo_url || this.options.logoUrl;
    if (logoUrl) {
      const logoImg = document.createElement('img');
      logoImg.src = logoUrl;
      logoImg.alt = 'Logo';
      logoImg.onerror = () => {
        // Fallback to first letter if logo fails to load
        const titleText = data.title || 'Zuzzuu';
        iconContainer.innerHTML = titleText.charAt(0).toUpperCase();
        iconContainer.style.backgroundColor = '#6366f1';
        iconContainer.style.color = 'white';
        iconContainer.style.fontSize = '16px';
        iconContainer.style.fontWeight = 'bold';
      };
      iconContainer.appendChild(logoImg);
    } else {
      // Use first letter of title as fallback
      const titleText = data.title || 'Zuzzuu';
      iconContainer.textContent = titleText.charAt(0).toUpperCase();
      iconContainer.style.backgroundColor = '#6366f1';
      iconContainer.style.color = 'white';
      iconContainer.style.fontSize = '16px';
      iconContainer.style.fontWeight = 'bold';
    }
    previewContainer.appendChild(iconContainer);
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'zuzzuu-notification-content';
    
    // Create title
    const title = document.createElement('div');
    title.className = 'zuzzuu-notification-title';
    title.textContent = data.title || 'New Notification';
    title.title = data.title || 'New Notification'; // Add tooltip
    contentContainer.appendChild(title);
    
    // Create message
    const message = document.createElement('div');
    message.className = 'zuzzuu-notification-message';
    message.textContent = data.message || '';
    message.title = data.message || ''; // Add tooltip
    contentContainer.appendChild(message);
    
    // Add URL if provided
    if (data.url) {
      const url = document.createElement('div');
      url.className = 'zuzzuu-notification-url';
      url.textContent = data.url;
      url.title = data.url; // Add tooltip
      contentContainer.appendChild(url);
    }
    
    previewContainer.appendChild(contentContainer);
    notificationElement.appendChild(previewContainer);
    
    // Add click event
    notificationElement.addEventListener('click', () => {
      this.log('Notification clicked:', data);
      
      // Open URL if provided
      if (data.url) {
        window.open(data.url, '_blank');
      }
      
      // Call onNotificationClick callback if provided
      if (this.options.onNotificationClick) {
        this.options.onNotificationClick(data);
      }
      
      // Close notification
      this.closeNotification(notificationElement);
    });
    
    // Add to container
    this.notificationContainer.appendChild(notificationElement);
    
    // Store notification with timestamp for duplicate checking
    this.notifications.push({
      id: notificationId,
      element: notificationElement,
      data: data,
      timestamp: Date.now()
    });
    
    this.log('In-app notification added to DOM. Container children count:', this.notificationContainer.children.length);
    
    // Clean up old notifications periodically
    this.cleanupOldNotifications();
    
    // Auto-close after 8 seconds
    setTimeout(() => {
      if (notificationElement.parentNode) {
        this.closeNotification(notificationElement);
      }
    }, 8000);
  }
  
  /**
   * Clean up old notifications
   */
  cleanupOldNotifications() {
    const now = Date.now();
    const maxAge = 60000; // 60 seconds
    
    this.notifications = this.notifications.filter(notification => {
      const age = now - (notification.timestamp || 0);
      if (age > maxAge && notification.element && notification.element.parentNode) {
        this.closeNotification(notification.element);
        return false;
      }
      return true;
    });
  }
  
  /**
   * Resolve image URL from various possible locations
   */
  resolveImageUrl(data) {
    return data.image_url ||
           data.image ||
           (data.template && data.template.image_url) ||
           (data.template && data.template.image) ||
           (data.data && data.data.image_url) ||
           (data.data && data.data.image) ||
           null;
  }

  /**
   * Close notification
   */
  closeNotification(element) {
    element.classList.add('closing');
    
    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
      
      // Remove from notifications array
      this.notifications = this.notifications.filter(n => n.element !== element);
    }, 300);
  }

  /**
   * Show browser notification (like the test button does)
   */
  showBrowserNotification(data) {
    // Check if notifications are supported and permission is granted
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      this.log('Browser notifications not supported or permission not granted');
      return;
    }

    try {
      const title = data.title || 'New Notification';
      
      // Enhanced image URL resolution
      const imageUrl = this.resolveImageUrl(data);
      
      const options = {
        body: data.message || 'You have a new notification',
        icon: data.logo_url || this.options.logoUrl,
        badge: data.logo_url || this.options.logoUrl,
        image: imageUrl, // Use resolved image URL
        tag: data.id || "browser-notification-" + Date.now(),
        data: {
          url: data.url || window.location.href,
          timestamp: data.timestamp || new Date().toISOString(),
          id: data.id
        },
        requireInteraction: false,
        silent: false,
        vibrate: [200, 100, 200]
      };

      // Show the browser notification directly using Notification API
      const notification = new Notification(title, options);

      // Handle click on browser notification
      notification.onclick = function(event) {
        event.preventDefault();
        const url = event.target.data?.url || window.location.href;
        window.focus();
        if (url && url !== window.location.href) {
          window.open(url, '_blank');
        }
      };

      this.log('Browser notification shown for:', options.tag);
    } catch (error) {
      this.log('Error showing browser notification:', error);
    }
  }

  /**
   * Show connectivity notification (special styling for network status)
   */
  showConnectivityNotification(options) {
    const { title, message, type, icon, image_url } = options;

    this.log(`Showing connectivity notification (${type}):`, { title, message });

    // Create notification data for connectivity alert
    const notificationData = {
      id: `connectivity-${type}-${Date.now()}`,
      title: title,
      message: message,
      logo_url: this.options.logoUrl,
      image_url: image_url || null, // Add image URL support
      connectivity_type: type, // Special flag for connectivity notifications
      icon: icon || 'Ã°Å¸â€œÂ¡'
    };

    // Ensure notification container exists and is attached to DOM
    if (!this.notificationContainer || !this.notificationContainer.parentNode) {
      this.log('Notification container missing, recreating');
      this.createNotificationContainer();
    }
    
    // Create notification element
    const notificationElement = document.createElement('div');
    notificationElement.className = `zuzzuu-notification zuzzuu-connectivity-notification zuzzuu-connectivity-${type}`;
    notificationElement.dataset.id = notificationData.id;
    
    this.log('Created connectivity notification element with ID:', notificationElement.dataset.id);
    
    // Create close button
    const closeButton = document.createElement('div');
    closeButton.className = 'zuzzuu-notification-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNotification(notificationElement);
    });
    notificationElement.appendChild(closeButton);
    
    // Create notification preview container (no image for connectivity notifications)
    const previewContainer = document.createElement('div');
    previewContainer.className = 'zuzzuu-notification-preview';
    
    // Create icon container with the provided icon
    const iconContainer = document.createElement('div');
    iconContainer.className = 'zuzzuu-notification-icon zuzzuu-connectivity-icon';
    iconContainer.textContent = icon || 'Ã°Å¸â€œÂ¡';
    iconContainer.style.fontSize = '20px';
    iconContainer.style.backgroundColor = type === 'online' ? '#10b981' : '#ef4444';
    iconContainer.style.color = 'white';
    iconContainer.style.display = 'flex';
    iconContainer.style.alignItems = 'center';
    iconContainer.style.justifyContent = 'center';
    previewContainer.appendChild(iconContainer);
    
    // Create content container
    const contentContainer = document.createElement('div');
    contentContainer.className = 'zuzzuu-notification-content';
    
    // Create title
    const titleElement = document.createElement('div');
    titleElement.className = 'zuzzuu-notification-title';
    titleElement.textContent = title;
    titleElement.title = title; // Add tooltip
    contentContainer.appendChild(titleElement);
    
    // Create message
    const messageElement = document.createElement('div');
    messageElement.className = 'zuzzuu-notification-message';
    messageElement.textContent = message;
    messageElement.title = message; // Add tooltip
    contentContainer.appendChild(messageElement);
    
    previewContainer.appendChild(contentContainer);
    notificationElement.appendChild(previewContainer);
    
    // Add click event (just close the notification for connectivity alerts)
    notificationElement.addEventListener('click', () => {
      this.log('Connectivity notification clicked:', notificationData);
      this.closeNotification(notificationElement);
    });
    
    // Add to container
    this.notificationContainer.appendChild(notificationElement);
    
    // Store notification
    this.notifications.push({
      id: notificationElement.dataset.id,
      element: notificationElement,
      data: notificationData
    });
    
    this.log('Connectivity notification added to DOM. Container children count:', this.notificationContainer.children.length);
    
    // Force a reflow to ensure the element is rendered
    notificationElement.offsetHeight;
    
    // Auto-close after longer time for connectivity notifications (10 seconds)
    setTimeout(() => {
      if (notificationElement.parentNode) {
        this.closeNotification(notificationElement);
      }
    }, 10000);
  }
  
  /**
   * Fetch and display a notification by ID
   */
  async fetchNotification(notificationId) {
    try {
      const apiBaseUrl = this.options.apiUrl || "https://vibte.shop/api/v1";
      const response = await fetch(`${apiBaseUrl}/notification/${notificationId}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriber_id: this.subscriberId
        })
      });

      const result = await response.json();

      if (result.success && result.data) {
        this.handleNotification(result.data);
        return result.data;
      } else {
        throw new Error(result.message || 'Failed to fetch notification');
      }
    } catch (error) {
      this.log('Error fetching notification:', error);
      throw error;
    }
  }
  
  /**
   * Set up push notifications
   */
  async setupPushNotifications() {
    if (!this.pushSupported) {
      this.log('Push notifications not supported in this browser');
      return;
    }

    if (!this.subscriberId) {
      this.log('No subscriber ID available, cannot set up push notifications');
      return;
    }

    try {
      // Register service worker if not already registered
      if (!navigator.serviceWorker.controller) {
        const registration = await navigator.serviceWorker.register('zuzzuu-sw.js');
        this.log('Service worker registered for push notifications:', registration);
      }

      // Check if we already have a push subscription
      const existingSubscription = await this.getExistingPushSubscription();
      if (existingSubscription) {
        this.pushSubscription = existingSubscription;
        this.log('Existing push subscription found:', existingSubscription);
        await this.sendPushSubscriptionToServer(existingSubscription);
        return;
      }

      // Request permission and subscribe
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await this.subscribeToPush();
      } else {
        this.log('Push notification permission denied');
      }
    } catch (error) {
      this.log('Error setting up push notifications:', error);
    }
  }

  /**
   * Get existing push subscription
   */
  async getExistingPushSubscription() {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return subscription;
    } catch (error) {
      this.log('Error getting existing push subscription:', error);
      return null;
    }
  }

  /**
   * Subscribe to push notifications
   */
  async subscribeToPush() {
    try {
      const registration = await navigator.serviceWorker.ready;

      // Use VAPID key if provided, otherwise skip push notifications
      if (this.options.vapidPublicKey) {
        const subscribeOptions = {
          userVisibleOnly: true,
          applicationServerKey: this.urlBase64ToUint8Array(this.options.vapidPublicKey)
        };

        const subscription = await registration.pushManager.subscribe(subscribeOptions);
        this.pushSubscription = subscription;

        this.log('Push subscription created:', subscription);

        // Send subscription to server
        await this.sendPushSubscriptionToServer(subscription);

        // Store subscription locally
        localStorage.setItem('zuzzuu_push_subscription', JSON.stringify(subscription));
      } else {
        this.log('No VAPID key provided, skipping push notification setup');
        // Still mark as successful since the notification system works without push
        this.pushSubscription = null;
      }

    } catch (error) {
      this.log('Error subscribing to push notifications:', error);
      // Don't throw error - push notifications are optional
      this.pushSubscription = null;
    }
  }

  /**
   * Send push subscription to server
   */
  async sendPushSubscriptionToServer(subscription) {
    if (!this.subscriberId) {
      this.log('No subscriber ID, cannot send push subscription to server');
      return;
    }

    try {
      const apiBaseUrl = this.options.apiUrl || "https://vibte.shop/api/v1";
      const subscriptionData = {
        subscriber_id: this.subscriberId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: this.arrayBufferToBase64(subscription.getKey('p256dh')),
          auth: this.arrayBufferToBase64(subscription.getKey('auth'))
        },
        user_agent: navigator.userAgent,
        browser_info: this.getBrowserInfo()
      };

      const response = await fetch(`${apiBaseUrl}/push/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(subscriptionData)
      });

      if (response.ok) {
        const result = await response.json();
        this.log('Push subscription sent to server successfully:', result);
      } else {
        this.log('Failed to send push subscription to server:', response.status);
      }
    } catch (error) {
      this.log('Error sending push subscription to server:', error);
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribeFromPush() {
    if (!this.pushSubscription) {
      this.log('No push subscription to unsubscribe from');
      return;
    }

    try {
      const result = await this.pushSubscription.unsubscribe();
      if (result) {
        this.log('Successfully unsubscribed from push notifications');
        this.pushSubscription = null;
        localStorage.removeItem('zuzzuu_push_subscription');

        // Notify server
        await this.notifyServerOfUnsubscription();
      }
    } catch (error) {
      this.log('Error unsubscribing from push notifications:', error);
    }
  }

  /**
   * Notify server of unsubscription
   */
  async notifyServerOfUnsubscription() {
    if (!this.subscriberId) return;

    try {
      const apiBaseUrl = this.options.apiUrl || "https://vibte.shop/api/v1";
      await fetch(`${apiBaseUrl}/push/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriber_id: this.subscriberId
        })
      });
    } catch (error) {
      this.log('Error notifying server of unsubscription:', error);
    }
  }

  /**
   * Get browser info for push subscription
   */
  getBrowserInfo() {
    const userAgent = navigator.userAgent;
    let browser = 'Unknown';
    let os = 'Unknown';

    if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';

    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac')) os = 'macOS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iOS')) os = 'iOS';

    return { browser, os, userAgent };
  }

  /**
   * Convert VAPID key to Uint8Array
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Convert ArrayBuffer to base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Fetch notification data from the API
   */
  async fetchNotificationData(since = null) {
    if (!this.subscriberId) {
      throw new Error('No subscriber ID available. Please ensure user is subscribed to notifications.');
    }

    try {
      // Use production URL by default
      const apiBaseUrl = this.options.apiUrl || "https://vibte.shop/api/v1";
      const apiUrl = `${apiBaseUrl}/public/notifications/check`;

      this.log('Fetching notifications from:', apiUrl);

      // Format the since parameter exactly as shown in the curl command
      const sinceParam = since || new Date().toISOString();

      const myHeaders = new Headers();
      myHeaders.append("Content-Type", "application/json");

      const raw = JSON.stringify({
        "subscriber_id": this.subscriberId,
        "since": sinceParam
      });

      const requestOptions = {
        method: "POST",
        headers: myHeaders,
        body: raw,
        redirect: "follow"
      };

      const response = await fetch(apiUrl, requestOptions);

      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }

      const result = await response.json();
      this.log('API response received:', result);

      return result;
    } catch (error) {
      this.log('Error fetching notification data:', error);
      throw error;
    }
  }

  /**
   * Display notifications using the existing Zuzzuu notification system
   */
  async displayNotifications(since = null) {
    try {
      const result = await this.fetchNotificationData(since);

      if (result.success && result.data && result.data.length > 0) {
        this.log(`Displaying ${result.data.length} notifications`);

        // Use existing Zuzzuu notification system
        result.data.forEach(notification => {
          this.handleNotification(notification);
        });

        return result.data;
      } else {
        this.log('No new notifications to display');
        return [];
      }
    } catch (error) {
      this.log('Error displaying notifications:', error);
      throw error;
    }
  }

  /**
   * Get subscriber ID
   */
  getSubscriberId() {
    return this.subscriberId;
  }

  /**
   * Set subscriber ID
   */
  setSubscriberId(subscriberId) {
    this.subscriberId = subscriberId;
    localStorage.setItem('zuzzuu_subscriber_id', subscriberId);
  }

  /**
   * Check if notifications are supported
   */
  static isSupported() {
    return 'Notification' in window;
  }

  /**
   * Request notification permission
   */
  static async requestPermission() {
    if (!ZuzzuuNotification.isSupported()) {
      throw new Error('Notifications are not supported in this browser');
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      throw new Error('Notification permission has been denied');
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }


  /**
   * Log debug messages
   */
  log(...args) {
    if (this.options.debug) {
      console.log('[ZuzzuuNotification]', ...args);
    }
  }

  /**
   * Test notification system - shows a test notification
   */
  testNotification() {
    console.log('[ZuzzuuNotification] Testing notification system...');

    const testData = {
      title: "Test Notification",
      message: "This is a test notification to verify the system is working correctly.",
      icon: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
      tag: "zuzzuu-test-" + Date.now(),
      url: window.location.href,
      data: {
        source: "test",
        timestamp: new Date().toISOString()
      }
    };

    // Show both in-app and browser notifications
    this.showInAppNotification(testData);
    this.showBrowserNotification(testData);

    console.log('[ZuzzuuNotification] Test notification sent');
    return testData;
  }

  /**
   * Show system notification with enhanced error handling
   */
  showSystemNotification(data) {
    console.log('[ZuzzuuNotification] Showing system notification:', data);

    // Only show if there's actual notification data, not just welcome messages
    if (!data || (!data.title && !data.message && !data.body)) {
      console.log('[ZuzzuuNotification] No notification data to display');
      return;
    }

    // Skip welcome/setup notifications that appear on every refresh
    if (data.source === 'welcome-setup' || data.source === 'auto-setup') {
      console.log('[ZuzzuuNotification] Skipping welcome/setup notification');
      return;
    }

    // Ensure we have permission first
    if ("Notification" in window && Notification.permission === "default") {
      console.log('[ZuzzuuNotification] Requesting permission for system notification...');
      Notification.requestPermission().then(permission => {
        if (permission === "granted") {
          this.showBrowserNotification(data);
        } else {
          console.log('[ZuzzuuNotification] Permission denied for system notifications');
        }
      });
    } else if (Notification.permission === "granted") {
      this.showBrowserNotification(data);
    } else {
      console.log('[ZuzzuuNotification] Cannot show system notification - permission not granted');
    }
  }

  /**
   * Reset welcome notification flag (for testing)
   */
  resetWelcomeNotification() {
    localStorage.removeItem('zuzzuu_welcome_notification_shown');
    console.log('[ZuzzuuNotification] Welcome notification flag reset');
  }
}

// Initialize when DOM is loaded
if (typeof window !== 'undefined') {
  window.ZuzzuuNotification = ZuzzuuNotification;

  document.addEventListener('DOMContentLoaded', () => {
    // Auto-initialize if data-zuzzuu-notification attribute is present
    const elements = document.querySelectorAll('[data-zuzzuu-notification]');
    elements.forEach(el => {
      const options = {
        debug: el.dataset.debug === 'true',
        autoConnect: el.dataset.autoConnect !== 'false'
      };

      if (el.dataset.apiUrl) options.apiUrl = el.dataset.apiUrl;
      if (el.dataset.socketUrl) options.socketUrl = el.dataset.socketUrl;

      window.zuzzuuNotification = new ZuzzuuNotification(options);
    });

    // Auto-initialize notification system with permission handling
    if (!window.zuzzuuNotification) {
      window.zuzzuuNotification = new ZuzzuuNotification({
        debug: true,
        autoConnect: false,
        socketUrl: 'https://vibte.shop',
        apiUrl: 'https://vibte.shop/api/v1',
        vapidPublicKey: null,
      });
    }

    // Enhanced notification permission and welcome notification system
    if ("Notification" in window) {
      console.log("[Auto-Notification] Current permission status:", Notification.permission);

      if (Notification.permission === "default") {
        console.log("[Auto-Notification] Requesting notification permission...");
        Notification.requestPermission().then(function (permission) {
          console.log("[Auto-Notification] Notification permission result:", permission);
          if (permission === "granted") {
            // Only show welcome notification if not shown before
            const welcomeShown = localStorage.getItem('zuzzuu_welcome_notification_shown');
            if (!welcomeShown) {
              setTimeout(() => {
                showWelcomeNotification();
                localStorage.setItem('zuzzuu_welcome_notification_shown', 'true');
              }, 1000);
            }
          }
        });
      } else if (Notification.permission === "granted") {
        // Only show welcome notification if not shown before and system is ready
        const welcomeShown = localStorage.getItem('zuzzuu_welcome_notification_shown');
        if (!welcomeShown) {
          setTimeout(() => {
            showWelcomeNotification();
            localStorage.setItem('zuzzuu_welcome_notification_shown', 'true');
          }, 2000);
        }
      }
    }

    // Enhanced welcome notification function
    function showWelcomeNotification() {
      console.log("[Auto-Notification] Showing welcome notification...");

      const welcomeData = {
        title: "Zuzzuu Notifications Active",
        message: "Push notifications are now enabled! You'll receive notifications even when the browser is closed.",
        icon: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
        badge: "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg",
        tag: "zuzzuu-welcome-" + Date.now(),
        requireInteraction: false,
        silent: false,
        data: {
          url: window.location.href,
          source: "welcome-setup",
        },
      };

      // Try service worker first, then fallback to direct notification
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        console.log("[Auto-Notification] Using service worker for welcome notification");
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_WELCOME_NOTIFICATION',
          data: welcomeData
        });
      } else {
        console.log("[Auto-Notification] Using direct notification for welcome");
        try {
          const notification = new Notification(welcomeData.title, {
            body: welcomeData.message,
            icon: welcomeData.icon,
            badge: welcomeData.badge,
            tag: welcomeData.tag,
            requireInteraction: welcomeData.requireInteraction,
            silent: welcomeData.silent,
            data: welcomeData.data,
          });

          // Handle notification click
          notification.onclick = function() {
            window.focus();
            if (welcomeData.data.url && welcomeData.data.url !== window.location.href) {
              window.open(welcomeData.data.url, '_blank');
            }
          };

          console.log("[Auto-Notification] Welcome notification shown successfully");
        } catch (error) {
          console.error("[Auto-Notification] Error showing welcome notification:", error);
        }
      }

      // Update notification system UI
      if (window.ZuzzuuNotificationSystem && window.ZuzzuuNotificationSystem.updateUI) {
        setTimeout(() => {
          window.ZuzzuuNotificationSystem.updateUI();
        }, 100);
      }
    }
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZuzzuuNotification;
}

/**
 * Zuzzuu Notification System with Service Worker Integration
 * Enhanced notification system for dashboard and real-time updates
 */
const ZuzzuuNotificationSystem = {
  // State management
  state: {
    connected: false,
    connecting: false,
    socket: null,
    subscriberId: null,
    serviceWorkerRegistered: false,
    notificationCount: 0,
    connectionCount: 0,
    startTime: Date.now(),
    environment: "development",
    autoScroll: true,
    logs: [],
  },

  // Initialize the notification system
  init() {
    this.log("info", " Initializing Zuzzuu Notification System...");
    this.detectEnvironment();
    this.loadStoredData();
    this.checkServiceWorker();
    this.checkNotificationPermission();
    this.updateUI();
    this.startUptimeCounter();
    this.setInitialTimestamp();
    this.log("success", " Notification System initialized successfully");

          // Register subscriber with backend before connecting
          // setTimeout(() => {
          //   this.log("info", "Ã°Å¸â€œÂ Registering subscriber with backend...");
          //   this.registerSubscriber()
          //     .then(() => {
          //       this.log("info", "Ã°Å¸â€â€ž Auto-connecting to Socket.IO...");
          //       this.connect();
          //       // Initialize notification system with push support
          //       this.initializeNotificationSystem();
          //
          //     })
          //     .catch((error) => {
          //       this.log("error", `Ã¢ÂÅ’ Subscriber registration failed: ${error.message}`);
          //       // Still attempt to connect even if registration fails
          //       this.log("info", "Ã°Å¸â€â€ž Auto-connecting to Socket.IO anyway...");
          //       this.connect();
          //       // Still initialize notification system
          //       this.initializeNotificationSystem();
          //
          //     });
          // }, 1000);
          // Temporarily disable auto-registration as per user request.
          // The notification system will still attempt to connect to Socket.IO.
          this.log("info", "Ã°Å¸â€â€ž Auto-connecting to Socket.IO (registration disabled)...");
          this.connect();
          this.initializeNotificationSystem();  },

  // Check for lost notifications on page load
  async checkForLostNotifications() {
    try {
      this.log("info", "Ã°Å¸â€Â Checking for lost notifications on page load...");

      // Wait a bit more to ensure everything is ready
      setTimeout(async () => {
        if (window.zuzzuuNotification && window.zuzzuuNotification.displayNotifications) {
          // Check for notifications from the last 24 hours
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          this.log("info", `Ã°Å¸â€œâ€¦ Checking for notifications since: ${since}`);

          const result = await window.zuzzuuNotification.displayNotifications(since);

          if (result && result.length > 0) {
            this.log("success", `Ã°Å¸â€œÂ§ Found ${result.length} lost notifications, displaying them...`);
          } else {
            this.log("info", "Â No lost notifications found");
          }
        } else {
          this.log("warning", "Â ZuzzuuNotification not available for lost notification check");
        }
      }, 2000); // Wait 2 seconds after initialization
    } catch (error) {
      this.log("error", `Ã¢ÂÅ’ Error checking for lost notifications: ${error.message}`);
    }
  },

  // Get Socket.IO URL based on environment
  getSocketIOUrl() {
    if (this.state.environment === 'development') {
      return 'https://vibte.co:6443';
    }
    // Use production URL by default
    return "https://vibte.shop";
  },

  // Get API base URL
  getApiBaseUrl() {
    if (this.state.environment === 'development') {
      return 'https://vibte.co:6443/api/v1';
    }
    // Use production URL by default
    return "https://vibte.shop/api/v1";
  },

  // Detect environment
  detectEnvironment() {
    const hostname = window.location.hostname;
    const port = window.location.port;

    // Check if it's a development environment
    if (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.includes("vibte.co") ||
        (hostname === "vibte.co" && port === "6443")) {
      this.state.environment = "development";
    } else if (hostname.includes("staging") || hostname.includes("test")) {
      this.state.environment = "staging";
    } else {
      this.state.environment = "production";
    }

    this.log("info", `Â Environment detected: ${this.state.environment} (${hostname}:${port})`);
  },

  // Load stored data
  loadStoredData() {
    this.state.subscriberId = localStorage.getItem("zuzzuu_subscriber_id");
    if (this.state.subscriberId) {
      this.log("info", `Ã°Å¸â€œÂ± Loaded subscriber ID: ${this.state.subscriberId.substring(0, 8)}...`);
    } else {
      // Generate new subscriber ID
      this.state.subscriberId = this.generateSubscriberId();
      localStorage.setItem("zuzzuu_subscriber_id", this.state.subscriberId);
      this.log("info", `Ã°Å¸â€œÂ± Generated new subscriber ID: ${this.state.subscriberId.substring(0, 8)}...`);
    }
  },

  // Generate subscriber ID
  generateSubscriberId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c == "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },

  // Check service worker
  async checkServiceWorker() {
    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          this.state.serviceWorkerRegistered = true;
          this.log("success", "Ã°Å¸â€˜Â· Service Worker is registered");
          this.updateUI();
        } else {
          this.log("info", "Ã°Å¸â€˜Â· Service Worker not registered yet - will auto-register on page load");
        }
      } catch (error) {
        this.log("error", `Ã°Å¸â€˜Â· Service Worker check failed: ${error.message}`);
      }
    } else {
      this.log("warning", "Ã°Å¸â€˜Â· Service Worker not supported");
      this.updateUI();
    }
  },

  // Check notification permission
  async checkNotificationPermission() {
    if (typeof Notification === "undefined") {
      this.log("warning", "Ã°Å¸â€â€ Notifications not supported in this browser");
      return;
    }

    const permission = Notification.permission;
    this.log("info", `Ã°Å¸â€â€ Current notification permission: ${permission}`);

    if (permission === "granted") {
      this.log("success", " Browser notifications are enabled");
    } else if (permission === "denied") {
      this.log("warning", "Â Browser notifications are denied");
    } else {
      this.log("info", "Ã°Å¸â€â€ Browser notifications not yet requested");
    }
  },

  // Register subscriber with backend
  async registerSubscriber() {
    this.log("info", "Ã°Å¸â€œÂ¡ Subscriber registration has been disabled by an administrator.");
    return;
  },

  // Get browser info
  getBrowserInfo() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes("Chrome")) return "Chrome";
    if (userAgent.includes("Firefox")) return "Firefox";
    if (userAgent.includes("Safari")) return "Safari";
    if (userAgent.includes("Edge")) return "Edge";
    if (userAgent.includes("Opera")) return "Opera";
    return "Unknown";
  },

  // Get OS info
  getOSInfo() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes("Windows")) return "Windows";
    if (userAgent.includes("Mac")) return "macOS";
    if (userAgent.includes("Linux")) return "Linux";
    if (userAgent.includes("Android")) return "Android";
    if (userAgent.includes("iOS")) return "iOS";
    return "Unknown";
  },

  // Get country info
  getCountryInfo() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone.includes("America")) return "US";
    if (timezone.includes("Europe")) return "EU";
    if (timezone.includes("Asia")) return "AS";
    return "Unknown";
  },

  // Connect to Socket.IO
  async connect() {
    if (this.state.connecting || this.state.connected) {
      return;
    }

    this.state.connecting = true;
    this.updateUI();
    this.log("info", "Ã°Å¸â€Å’ Connecting to Socket.IO...");

    try {
      const socketUrl = this.getSocketIOUrl();
      this.log("info", `Ã°Å¸â€â€” Connecting to: ${socketUrl}`);

      // Use Socket.IO if available
      if (typeof io !== 'undefined') {
        this.state.socket = io(socketUrl, {
          query: {
            subscriber_id: this.state.subscriberId,
            client_type: "dashboard_connection",
            timestamp: Date.now(),
          },
          transports: ["websocket", "polling"],
          timeout: 20000,
          forceNew: true,
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionAttempts: 5,
          maxReconnectionAttempts: 5,
        });

        // Socket.IO event handlers
        this.state.socket.on("connect", () => {
          this.state.connected = true;
          this.state.connecting = false;
          this.state.connectionCount++;
          this.log("success", ` Connected to Socket.IO (ID: ${this.state.socket.id})`);
          this.updateUI();
        });

        this.state.socket.on("disconnect", (reason) => {
          this.state.connected = false;
          this.state.connecting = false;
          this.log("warning", `Ã¢ÂÅ’ Disconnected from Socket.IO: ${reason}`);
          this.updateUI();
        });

        this.state.socket.on("connect_error", (error) => {
          this.state.connected = false;
          this.state.connecting = false;
          this.log("error", `Â Connection error: ${error.message}`);
          this.updateUI();
        });

        this.state.socket.on("connection_established", (data) => {
          this.log("success", "Connection established event received:", data);
          this.state.connected = true;
          this.state.connecting = false;
          this.updateUI();
        });

        this.state.socket.on("notification", (data) => {
          this.state.notificationCount++;
          this.log("info", " Notification received via Socket.IO", data);
          this.handleNotification(data);
          this.updateUI();
        });
      } else {
        this.log("error", "Ã¢ÂÅ’ Socket.IO library not available");
        this.state.connecting = false;
        this.updateUI();
        return;
      }

      // Set connection timeout
      setTimeout(() => {
        if (this.state.connecting && !this.state.connected) {
          this.log("warning", "Ã¢ÂÂ±Ã¯Â¸Â Connection timeout - Socket.IO may still be connecting");
          this.state.connecting = false;
          this.updateUI();
        }
      }, 20000);
    } catch (error) {
      this.state.connecting = false;
      this.log("error", `Ã°Å¸â€Å’ Connection failed: ${error.message}`);
      this.updateUI();
    }
  },


  // Handle received notification
  handleNotification(data) {
    // Only show notifications if there's actual content from API or Socket.IO
    // Skip welcome/setup notifications that appear on every refresh
    if (data.source === 'welcome-setup' || data.source === 'auto-setup' || data.source === 'service-worker-setup') {
      this.log('info', 'Skipping welcome/setup notification:', data.id || 'no-id');
      return;
    }

    // Log the notification BEFORE duplicate check to avoid false positives
    this.log('info', 'Notification received:', data);

    // Track shown notifications separately (not in logs)
    if (!this.state.shownNotifications) {
      this.state.shownNotifications = new Set();
    }

    // Check for duplicate using notification ID
    if (data.id && this.state.shownNotifications.has(data.id)) {
      this.log('info', 'Duplicate notification detected, skipping:', data.id);
      return;
    }

    // Mark notification as shown
    if (data.id) {
      this.state.shownNotifications.add(data.id);
      
      // Clean up old notification IDs after 5 minutes to prevent memory leak
      setTimeout(() => {
        this.state.shownNotifications.delete(data.id);
      }, 300000);
    }

    // Use site-wide notification system to show across all pages
    if (window.siteWideNotifications) {
      window.siteWideNotifications.displayNotification(data);
    } else {
      // Fallback to direct display
      this.showNotification(data);
    }

    this.state.notificationCount++;
    this.updateUI();
  },

  // Show notification directly (fallback method)
  showNotification(data) {
    // Initialize ZuzzuuNotification if not already done
    if (!window.zuzzuuNotification) {
      window.zuzzuuNotification = new ZuzzuuNotification({
        debug: true,
        autoConnect: false,
        socketUrl: this.getSocketIOUrl(),
        apiUrl: this.getApiBaseUrl(),
        vapidPublicKey: null,
      });
    }

    // Handle the notification
    window.zuzzuuNotification.handleNotification(data);
  },

  // Initialize notification system with push support
  initializeNotificationSystem() {
    if (!window.zuzzuuNotification) {
      window.zuzzuuNotification = new ZuzzuuNotification({
        debug: this.state.environment !== 'production',
        autoConnect: false,
        socketUrl: this.getSocketIOUrl(),
        apiUrl: this.getApiBaseUrl(),
        vapidPublicKey: null,
      });
    }

    // Set up push notifications
    if (window.zuzzuuNotification && window.zuzzuuNotification.setupPushNotifications) {
      window.zuzzuuNotification.setupPushNotifications()
        .then(() => {
          this.log("success", " Push notifications set up successfully");
        })
        .catch((error) => {
          this.log("error", `Ã¢ÂÅ’ Push notification setup failed: ${error.message}`);
        });
    }
  },

  // Update UI (placeholder for dashboard UI)
  updateUI() {
    // This would update dashboard UI if present
    // For now, just log the status
    this.log("info", `UI Updated - Connected: ${this.state.connected}, Notifications: ${this.state.notificationCount}`);
  },

  // Start uptime counter
  startUptimeCounter() {
    setInterval(() => {
      const uptime = Math.floor((Date.now() - this.state.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      let uptimeText = "";
      if (hours > 0) {
        uptimeText = `${hours}h ${minutes}m ${seconds}s`;
      } else if (minutes > 0) {
        uptimeText = `${minutes}m ${seconds}s`;
      } else {
        uptimeText = `${seconds}s`;
      }

      // Update uptime display if element exists
      const uptimeElement = document.getElementById("uptimeCount");
      if (uptimeElement) {
        uptimeElement.textContent = uptimeText;
      }
    }, 1000);
  },

  // Set initial timestamp
  setInitialTimestamp() {
    const timestamp = new Date().toLocaleTimeString();
    const timestampElement = document.getElementById("initialTimestamp");
    if (timestampElement) {
      timestampElement.textContent = timestamp;
    }
  },

  // Log function
  log(level, message, data = null) {
    if (this.state.environment === 'production') return;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
    };

    this.state.logs.push(logEntry);

    // Console log for debugging
    console.log(`[ZuzzuuNotificationSystem] ${level.toUpperCase()}: ${message}`, data || "");

    // Keep only last 100 log entries
    if (this.state.logs.length > 100) {
      this.state.logs.shift();
    }
  },
};

// Initialize the notification system when DOM is loaded (FULL AUTOMATIC INITIALIZATION)
if (typeof window !== 'undefined') {
  window.ZuzzuuNotification = ZuzzuuNotification;
  window.ZuzzuuNotificationSystem = ZuzzuuNotificationSystem;

  // Add global test function for easy access
  window.testZuzzuuNotification = function() {
    if (window.zuzzuuNotification) {
      return window.zuzzuuNotification.testNotification();
    } else {
      console.error('ZuzzuuNotification not initialized yet. Please wait for page load.');
      return null;
    }
  };

  // Add global function to show system notification
  window.showZuzzuuSystemNotification = function(title, message, options = {}) {
    if (window.zuzzuuNotification) {
      const notificationData = {
        title: title || "Zuzzuu System Notification",
        message: message || "This is a system notification",
        ...options
      };
      window.zuzzuuNotification.showSystemNotification(notificationData);
      return notificationData;
    } else {
      console.error('ZuzzuuNotification not initialized yet. Please wait for page load.');
      return null;
    }
  };

  // Add global function to reset welcome notification (for testing)
  window.resetZuzzuuWelcomeNotification = function() {
    if (window.zuzzuuNotification) {
      window.zuzzuuNotification.resetWelcomeNotification();
      console.log('Welcome notification flag reset - refresh page to see welcome notification again');
    } else {
      localStorage.removeItem('zuzzuu_welcome_notification_shown');
      console.log('Welcome notification flag reset - refresh page to see welcome notification again');
    }
  };

  document.addEventListener('DOMContentLoaded', function() {
    ZuzzuuNotificationSystem.init();
  });
}
