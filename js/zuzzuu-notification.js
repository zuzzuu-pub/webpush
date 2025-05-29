/**
 * Zuzzuu Notification System
 *
 * This file handles displaying notifications from the server
 * and manages WebSocket connections for real-time updates.
 */

class ZuzzuuNotification {
  constructor(options = {}) {
    // Default Zuzzuu logo URL from environment variable or fallback
    const defaultLogoUrl =
      "https://res.cloudinary.com/do5wahloo/image/upload/v1746001971/zuzzuu/vhrhfihk5t6sawer0bhw.svg";

    this.options = {
      apiUrl: options.apiUrl || "http://localhost:8001/api/v1",
      wsUrl: options.wsUrl || "ws://localhost:8001/api/v1/ws",
      debug: options.debug || true, // Enable debug by default for testing
      autoConnect: options.autoConnect !== false,
      heartbeatInterval: options.heartbeatInterval || 30000, // 30 seconds
      reconnectInterval: options.reconnectInterval || 5000, // 5 seconds
      maxReconnectAttempts: options.maxReconnectAttempts || 10,
      onNotificationClick: options.onNotificationClick || null,
      onConnectionChange: options.onConnectionChange || null,
      logoUrl: options.logoUrl || defaultLogoUrl, // Default Zuzzuu logo URL
    };

    // Create CSS styles
    this.createStyles();

    // WebSocket connection
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.isOnline = navigator.onLine;

    // Notification container
    this.notificationContainer = null;
    this.notifications = [];

    // Get subscriber ID
    this.subscriberId = localStorage.getItem("zuzzuu_subscriber_id");

    // Create notification container
    this.createNotificationContainer();

    // Set up network listeners
    this.setupNetworkListeners();

    // Check if service worker is available
    this.useServiceWorker = "serviceWorker" in navigator;

    // Add connection state tracking
    this.isConnecting = false;
    this.connectionAttempted = false;

    // Check stored connection state
    const storedConnectionState = localStorage.getItem(
      "zuzzuu_ws_connection_state"
    );
    let wsConnectionState = { connected: false, subscriberId: null };

    if (storedConnectionState) {
      try {
        wsConnectionState = JSON.parse(storedConnectionState);
      } catch (e) {
        this.log("Error parsing stored connection state:", e);
      }
    }

    // Don't auto-connect if already connected or if subscriber registration might be in progress
    const hasConsent = localStorage.getItem("zuzzuu_notification_consent");
    const isRejected = localStorage.getItem("zuzzuu_notification_rejected");

    // Only auto-connect if user has consented, not rejected, and not already connected
    if (
      this.options.autoConnect &&
      this.subscriberId &&
      hasConsent &&
      !isRejected &&
      (!wsConnectionState.connected ||
        wsConnectionState.subscriberId !== this.subscriberId)
    ) {
      // Add delay to avoid conflicts with registration
      setTimeout(() => {
        this.connect();
      }, 3000);
    } else if (
      wsConnectionState.connected &&
      wsConnectionState.subscriberId === this.subscriberId
    ) {
      this.log("Already connected according to stored state");
      this.connected = true;
    }

    this.log("Zuzzuu Notification initialized");
  }

  /**
   * Create and inject CSS styles
   */
  createStyles() {
    const styleElement = document.createElement("style");
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
    this.notificationContainer = document.createElement("div");
    this.notificationContainer.className = "zuzzuu-notification-container";
    document.body.appendChild(this.notificationContainer);
  }

  /**
   * Connect to WebSocket (updated to work with service worker)
   */
  connect() {
    const currentSubscriberId = localStorage.getItem("zuzzuu_subscriber_id");

    if (!currentSubscriberId) {
      this.log("No subscriber ID found. Cannot connect.");
      return;
    }

    this.subscriberId = currentSubscriberId;
    this.isConnecting = true;

    if (this.useServiceWorker && navigator.serviceWorker.controller) {
      // Use service worker for WebSocket connection
      navigator.serviceWorker.controller.postMessage({
        type: "CONNECT_WEBSOCKET",
        data: {
          subscriberId: this.subscriberId,
          wsUrl: this.options.wsUrl,
          useAuth: this.options.useAuthentication || false,
          authToken: this.options.useAuthentication
            ? localStorage.getItem("auth_token")
            : null,
        },
      });

      // Set up timeout for connection attempt
      setTimeout(() => {
        if (this.isConnecting && !this.connected) {
          this.log("Connection attempt timed out");
          this.isConnecting = false;
        }
      }, 10000);

      return;
    }

    // Fallback to direct WebSocket connection
    // Close existing connection if any
    if (this.socket) {
      this.socket.close();
    }

    try {
      // Build the correct WebSocket URL with subscriber ID
      const subscriberId =
        this.subscriberId || localStorage.getItem("zuzzuu_subscriber_id");

      if (!subscriberId) {
        this.log("No subscriber ID available for WebSocket connection");
        this.isConnecting = false;
        return;
      }

      // Choose between authenticated and public WebSocket endpoint
      let wsUrl;
      if (this.options.useAuthentication) {
        const authToken = localStorage.getItem("auth_token");
        if (!authToken) {
          this.log("Authentication required but no token found");
          this.isConnecting = false;
          return;
        }
        // Use authenticated WebSocket endpoint with token as query parameter
        wsUrl = `${
          this.options.wsUrl
        }/auth/${subscriberId}?token=${encodeURIComponent(authToken)}`;
      } else {
        // Use public WebSocket endpoint
        wsUrl = `${this.options.wsUrl}/${subscriberId}`;
      }

      this.log(`Connecting to WebSocket at ${wsUrl}`);

      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.log("WebSocket connection established", "success");
        this.connected = true;
        this.isConnecting = false;
        this.connectionAttempts = 0;

        if (this.options.onConnect) {
          this.options.onConnect();
        }
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.socket.onclose = (event) => {
        this.connected = false;
        this.isConnecting = false;

        if (event.code === 4001) {
          this.log("WebSocket closed: Invalid authentication token", "error");
        } else if (event.code === 4002) {
          this.log("WebSocket closed: User not found", "error");
        } else if (event.code === 4003) {
          this.log("WebSocket closed: Unauthorized access", "error");
        } else if (event.code === 4004) {
          this.log("WebSocket closed: Subscriber not found", "error");
        } else {
          this.log(
            `WebSocket connection closed: ${event.code} ${event.reason}`,
            "warning"
          );
        }

        if (this.options.onDisconnect) {
          this.options.onDisconnect(event);
        }

        // Only attempt to reconnect for unexpected disconnections and if not an auth error
        if (event.code !== 1000 && event.code !== 1001 && event.code < 4000) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (error) => {
        this.log("WebSocket error: " + error.message, "error");
        this.connected = false;
        this.isConnecting = false;

        if (this.options.onError) {
          this.options.onError(error);
        }
      };
    } catch (error) {
      this.log("Error creating WebSocket: " + error.message, "error");
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from WebSocket (updated to work with service worker)
   */
  disconnect() {
    this.isConnecting = false;
    this.connectionAttempted = false;

    if (this.useServiceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "DISCONNECT_WEBSOCKET",
      });
      return;
    }

    // Fallback to direct disconnection
    if (this.socket) {
      this.socket.close(1000, "User disconnected");
      this.socket = null;
    }

    this.connected = false;
    this.stopHeartbeat();

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
        this.log("Sending heartbeat");
        this.socket.send(
          JSON.stringify({
            type: "heartbeat",
            timestamp: new Date().toISOString(),
          })
        );
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
      this.log("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;

    this.log(
      `Attempting to reconnect (${this.reconnectAttempts}/${
        this.options.maxReconnectAttempts
      }) in ${this.options.reconnectInterval / 1000}s`
    );

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
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.log("Browser is online");

      if (!this.connected) {
        this.connect();
      }
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.log("Browser is offline");

      if (this.connected) {
        this.sendStatusUpdate("offline");
      }
    });

    // Handle visibility change
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.log("Document is visible");
        if (this.connected) {
          this.sendStatusUpdate("online");
        } else if (this.isOnline) {
          this.connect();
        }
      } else {
        this.log("Document is hidden");
        if (this.connected) {
          this.sendStatusUpdate("away");
        }
      }
    });
  }

  /**
   * Send status update
   */
  sendStatusUpdate(status) {
    if (
      this.connected &&
      this.socket &&
      this.socket.readyState === WebSocket.OPEN
    ) {
      this.log(`Sending status update: ${status}`);
      this.socket.send(
        JSON.stringify({
          type: "status_update",
          status: status,
          timestamp: new Date().toISOString(),
        })
      );
    }
  }

  /**
   * Handle notification from server (public method)
   */
  handleNotification(data) {
    this.log("Handling notification:", data);

    // Ensure notification container exists
    if (!this.notificationContainer) {
      this.log("Notification container not found, creating it");
      this.createNotificationContainer();
    }

    // Show browser notification if supported
    this.showBrowserNotification(data);

    // Show in-app notification
    this.showInAppNotification(data);

    this.log("Notification handling completed");
  }

  /**
   * Show browser notification
   */
  showBrowserNotification(data) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      this.log("Browser notifications not available or not permitted");
      return;
    }

    try {
      const notification = new Notification(data.title || "New Notification", {
        body: data.message || "",
        icon: data.logo_url || data.image_url || "/favicon.ico",
        tag: data.id || "zuzzuu-notification",
        data: data,
        requireInteraction: false,
      });

      notification.onclick = () => {
        notification.close();
        window.focus();

        // Open URL if provided
        if (data.url) {
          window.open(data.url, "_blank");
        }

        // Call onNotificationClick callback if provided
        if (this.options.onNotificationClick) {
          this.options.onNotificationClick(data);
        }
      };

      // Auto-close browser notification after 5 seconds
      setTimeout(() => {
        notification.close();
      }, 5000);

      this.log("Browser notification shown");
    } catch (error) {
      this.log("Error showing browser notification:", error);
    }
  }

  /**
   * Show in-app notification
   */
  showInAppNotification(data) {
    this.log("Showing in-app notification:", data);

    // Ensure notification container exists and is attached to DOM
    if (!this.notificationContainer || !this.notificationContainer.parentNode) {
      this.log("Notification container missing, recreating");
      this.createNotificationContainer();
    }

    // Create notification element
    const notificationElement = document.createElement("div");
    notificationElement.className = "zuzzuu-notification";
    notificationElement.dataset.id = data.id || Date.now();

    this.log(
      "Created notification element with ID:",
      notificationElement.dataset.id
    );

    // Create close button
    const closeButton = document.createElement("div");
    closeButton.className = "zuzzuu-notification-close";
    closeButton.innerHTML = "&times;";
    closeButton.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeNotification(notificationElement);
    });
    notificationElement.appendChild(closeButton);

    // Add image container if image is provided
    if (data.image_url) {
      const imageContainer = document.createElement("div");
      imageContainer.className = "zuzzuu-notification-image-container";

      const image = document.createElement("img");
      image.className = "zuzzuu-notification-image";
      image.src = data.image_url;
      image.alt = data.title || "Notification Image";
      image.onerror = () => {
        // Hide image container if image fails to load
        imageContainer.style.display = "none";
      };

      imageContainer.appendChild(image);
      notificationElement.appendChild(imageContainer);
    }

    // Create notification preview container
    const previewContainer = document.createElement("div");
    previewContainer.className = "zuzzuu-notification-preview";

    // Create icon container
    const iconContainer = document.createElement("div");
    iconContainer.className = "zuzzuu-notification-icon";

    // Use logo from data, options, or fallback to first letter
    const logoUrl = data.logo_url || this.options.logoUrl;
    if (logoUrl) {
      const logoImg = document.createElement("img");
      logoImg.src = logoUrl;
      logoImg.alt = "Logo";
      logoImg.onerror = () => {
        // Fallback to first letter if logo fails to load
        const titleText = data.title || "Zuzzuu";
        iconContainer.innerHTML = titleText.charAt(0).toUpperCase();
        iconContainer.style.backgroundColor = "#6366f1";
        iconContainer.style.color = "white";
        iconContainer.style.fontSize = "16px";
        iconContainer.style.fontWeight = "bold";
      };
      iconContainer.appendChild(logoImg);
    } else {
      // Use first letter of title as fallback
      const titleText = data.title || "Zuzzuu";
      iconContainer.textContent = titleText.charAt(0).toUpperCase();
      iconContainer.style.backgroundColor = "#6366f1";
      iconContainer.style.color = "white";
      iconContainer.style.fontSize = "16px";
      iconContainer.style.fontWeight = "bold";
    }
    previewContainer.appendChild(iconContainer);

    // Create content container
    const contentContainer = document.createElement("div");
    contentContainer.className = "zuzzuu-notification-content";

    // Create title
    const title = document.createElement("div");
    title.className = "zuzzuu-notification-title";
    title.textContent = data.title || "New Notification";
    title.title = data.title || "New Notification"; // Add tooltip
    contentContainer.appendChild(title);

    // Create message
    const message = document.createElement("div");
    message.className = "zuzzuu-notification-message";
    message.textContent = data.message || "";
    message.title = data.message || ""; // Add tooltip
    contentContainer.appendChild(message);

    // Add URL if provided
    if (data.url) {
      const url = document.createElement("div");
      url.className = "zuzzuu-notification-url";
      url.textContent = data.url;
      url.title = data.url; // Add tooltip
      contentContainer.appendChild(url);
    }

    previewContainer.appendChild(contentContainer);
    notificationElement.appendChild(previewContainer);

    // Add click event
    notificationElement.addEventListener("click", () => {
      this.log("Notification clicked:", data);

      // Open URL if provided
      if (data.url) {
        window.open(data.url, "_blank");
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
      data: data,
    });

    this.log(
      "In-app notification added to DOM. Container children count:",
      this.notificationContainer.children.length
    );

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
    element.classList.add("closing");

    setTimeout(() => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }

      // Remove from notifications array
      this.notifications = this.notifications.filter(
        (n) => n.element !== element
      );
    }, 300);
  }

  /**
   * Fetch and display a notification by ID
   */
  async fetchNotification(notificationId) {
    try {
      const response = await fetch(
        `${this.options.apiUrl}/notification/${notificationId}/send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subscriber_id: this.subscriberId,
          }),
        }
      );

      const result = await response.json();

      if (result.success && result.data) {
        this.handleNotification(result.data);
        return result.data;
      } else {
        throw new Error(result.message || "Failed to fetch notification");
      }
    } catch (error) {
      this.log("Error fetching notification:", error);
      throw error;
    }
  }

  /**
   * Log debug messages
   */
  log(...args) {
    if (this.options.debug) {
      console.log("[ZuzzuuNotification]", ...args);
    }
  }
}

// Initialize when DOM is loaded
if (typeof window !== "undefined") {
  window.ZuzzuuNotification = ZuzzuuNotification;

  document.addEventListener("DOMContentLoaded", () => {
    // Auto-initialize if data-zuzzuu-notification attribute is present
    const elements = document.querySelectorAll("[data-zuzzuu-notification]");
    elements.forEach((el) => {
      const options = {
        debug: el.dataset.debug === "true",
        autoConnect: el.dataset.autoConnect !== "false",
      };

      if (el.dataset.apiUrl) options.apiUrl = el.dataset.apiUrl;
      if (el.dataset.wsUrl) options.wsUrl = el.dataset.wsUrl;

      window.zuzzuuNotification = new ZuzzuuNotification(options);
    });
  });
}

// Export for module usage
if (typeof module !== "undefined" && module.exports) {
  module.exports = ZuzzuuNotification;
}
