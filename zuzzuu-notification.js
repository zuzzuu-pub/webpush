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

    this.options = {
      apiUrl: options.apiUrl || 'http://localhost:8002/api/v1',
      socketUrl: options.socketUrl || 'http://localhost:8002', // Socket.IO URL
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
            this.log('📧 Notification received from service worker:', data);
            // Handle the notification data
            const notificationData = data.data || data;
            this.handleNotification(notificationData);
            break;
          case 'SOCKETIO_CONNECTED':
            this.connected = true;
            this.isConnecting = false;
            this.log('✅ Socket.IO connected via service worker');
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(true);
            }
            break;
          case 'SOCKETIO_DISCONNECTED':
            this.connected = false;
            this.isConnecting = false;
            this.log('❌ Socket.IO disconnected via service worker');
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(false);
            }
            break;
          case 'SOCKETIO_ERROR':
            this.connected = false;
            this.isConnecting = false;
            this.log('⚠️ Socket.IO error via service worker:', data);
            if (this.options.onConnectionChange) {
              this.options.onConnectionChange(false);
            }
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
    
    // Fallback to direct Socket.IO connection if service worker not available
    this.log('Service worker not available, using direct Socket.IO connection');
    // Note: Direct Socket.IO connection in main thread would need socket.io client library
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
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.log('Sending heartbeat');
        this.socket.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        }));
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
      
      if (!this.connected) {
        this.connect();
      }
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.log('Browser is offline');
      
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
    if (this.connected && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.log(`Sending status update: ${status}`);
      this.socket.send(JSON.stringify({
        type: 'status_update',
        status: status,
        timestamp: new Date().toISOString()
      }));
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

    // Only show in-app notification
    this.showInAppNotification(notificationData);

    this.log('Notification handling completed for:', notificationData.id || 'unknown');
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
    notificationElement.dataset.id = data.id || Date.now();
    
    this.log('Created notification element with ID:', notificationElement.dataset.id);
    
    // Create close button
    const closeButton = document.createElement('div');
    closeButton.className = 'zuzzuu-notification-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeNotification(notificationElement);
    });
    notificationElement.appendChild(closeButton);
    
    // Add image container if image is provided
    const imageUrl = data.image_url || '';
    if (imageUrl) {
      const imageContainer = document.createElement('div');
      imageContainer.className = 'zuzzuu-notification-image-container';

      const image = document.createElement('img');
      image.className = 'zuzzuu-notification-image';
      image.src = imageUrl;
      image.alt = data.title || 'Notification Image';
      image.onerror = () => {
        // Show fallback image if image fails to load
        image.src = 'https://placehold.co/380x140?text=No+Image';
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
    
    // Store notification
    this.notifications.push({
      id: notificationElement.dataset.id,
      element: notificationElement,
      data: data
    });
    
    this.log('In-app notification added to DOM. Container children count:', this.notificationContainer.children.length);
    
    // Force a reflow to ensure the element is rendered
    notificationElement.offsetHeight;
    
    // Auto-close after 8 seconds
    setTimeout(() => {
      if (notificationElement.parentNode) {
        this.closeNotification(notificationElement);
      }
    }, 8000);
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
   * Fetch and display a notification by ID
   */
  async fetchNotification(notificationId) {
    try {
      const response = await fetch(`${this.options.apiUrl}/notification/${notificationId}/send`, {
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

      // Use VAPID key if provided, otherwise use applicationServerKey
      const subscribeOptions = {
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.options.vapidPublicKey || 'BDefaultVAPIDKeyForTestingPurposes1234567890')
      };

      const subscription = await registration.pushManager.subscribe(subscribeOptions);
      this.pushSubscription = subscription;

      this.log('Push subscription created:', subscription);

      // Send subscription to server
      await this.sendPushSubscriptionToServer(subscription);

      // Store subscription locally
      localStorage.setItem('zuzzuu_push_subscription', JSON.stringify(subscription));

    } catch (error) {
      this.log('Error subscribing to push notifications:', error);
      throw error;
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

      const response = await fetch(`${this.options.apiUrl}/push/subscribe`, {
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
      await fetch(`${this.options.apiUrl}/push/unsubscribe`, {
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
   * Log debug messages
   */
  log(...args) {
    if (this.options.debug) {
      console.log('[ZuzzuuNotification]', ...args);
    }
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
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZuzzuuNotification;
}
