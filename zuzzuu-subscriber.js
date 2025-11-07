/**
 * Zuzzuu Subscriber Registration System
 * 
 * This file handles subscriber registration with random UUID generation
 * and notification permission requests.
 */

class ZuzzuuSubscriber {
  constructor(options = {}) {
    this.options = {
      apiUrl: options.apiUrl || (window.ZuzzuuNotificationSystem ? window.ZuzzuuNotificationSystem.getApiBaseUrl() : 'https://vibte.shop/api/v1'),
      pubRegisterUrl: options.pubRegisterUrl || (window.ZuzzuuNotificationSystem ? `${window.ZuzzuuNotificationSystem.getApiBaseUrl()}/public/register` : 'https://vibte.shop/api/v1/public/register'),
      debug: options.debug || false,
      autoShowConsent: options.autoShowConsent !== false,
      consentDelay: options.consentDelay || 2000,
      onRegistered: options.onRegistered || function() {},
      onError: options.onError || function() {}
    };

    // Create CSS styles
    this.createStyles();
    
    // Elements that will be created
    this.elements = {
      popup: null,
      consentButtons: null,
      statusMessage: null
    };
    
    // Initialize subscriber ID
    this.subscriberId = this.getOrCreateSubscriberId();
    
    // Create UI elements
    this.createPopupElements();
    
    // Don't show popup if user has already responded
    const hasConsent = localStorage.getItem('zuzzuu_notification_consent');
    const isRejected = localStorage.getItem('zuzzuu_notification_rejected');
    const isRegistered = localStorage.getItem('zuzzuu_subscriber_registered');
    
    // Auto-show consent popup after delay if enabled and no previous response
    if (this.options.autoShowConsent && !hasConsent && !isRejected && !isRegistered) {
      setTimeout(() => {
        this.showConsentPopup();
      }, this.options.consentDelay);
    } else if (hasConsent && isRegistered) {
      this.log('User has already consented and is registered, skipping popup');
    } else if (isRejected) {
      this.log('User has rejected notifications, skipping popup');
    }
    
    // Add registration state tracking
    this.isRegistering = false;
    this.registrationComplete = false;
    
    this.log('Zuzzuu Subscriber initialized with ID:', this.subscriberId);
    this.log('API URLs - Base:', this.options.apiUrl, 'Register:', this.options.pubRegisterUrl);
  }

  
  /**
   * Create and inject CSS styles
   */
  createStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .zuzzuu-popup {
        position: fixed;
        top: -200px;
        right: 20px;
        width: 90%;
        max-width: 400px;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        padding: 20px;
        z-index: 9999;
        transition: top 0.5s ease-in-out;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      }
      
      .zuzzuu-popup.visible {
        top: 20px;
      }
      
      .zuzzuu-popup-close {
        position: absolute;
        top: 8px;
        right: 8px;
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: #6c757d;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s;
      }
      
      .zuzzuu-popup-close:hover {
        background-color: #f8f9fa;
        color: #212529;
      }
      
      .zuzzuu-popup-title {
        margin: 0 0 10px 0;
        font-size: 18px;
        font-weight: 600;
        color: #333;
        padding-right: 30px;
      }
      
      .zuzzuu-popup-message {
        margin: 0 0 15px 0;
        font-size: 14px;
        line-height: 1.5;
        color: #666;
      }
      
      .zuzzuu-popup-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      
      .zuzzuu-btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s ease;
      }
      
      .zuzzuu-btn-primary {
        background-color: #4CAF50;
        color: white;
      }
      
      .zuzzuu-btn-primary:hover {
        background-color: #3e8e41;
        transform: translateY(-1px);
      }
      
      .zuzzuu-btn-secondary {
        background-color: #f1f1f1;
        color: #333;
        border: 1px solid #ddd;
      }
      
      .zuzzuu-btn-secondary:hover {
        background-color: #e9ecef;
        transform: translateY(-1px);
      }
      
      .zuzzuu-status {
        margin-top: 15px;
        padding: 10px;
        border-radius: 4px;
        font-size: 14px;
        display: none;
      }
      
      .zuzzuu-status.success {
        display: block;
        background-color: #d4edda;
        color: #155724;
        border: 1px solid #c3e6cb;
      }
      
      .zuzzuu-status.error {
        display: block;
        background-color: #f8d7da;
        color: #721c24;
        border: 1px solid #f5c6cb;
      }
      
      .zuzzuu-status.info {
        display: block;
        background-color: #d1ecf1;
        color: #0c5460;
        border: 1px solid #bee5eb;
      }
      
      @media (max-width: 480px) {
        .zuzzuu-popup {
          width: 95%;
          right: 2.5%;
          padding: 15px;
        }
        
        .zuzzuu-popup-title {
          font-size: 16px;
        }
        
        .zuzzuu-popup-message {
          font-size: 13px;
        }
        
        .zuzzuu-btn {
          padding: 6px 12px;
          font-size: 13px;
        }
      }
    `;
    
    document.head.appendChild(styleElement);
  }
  
  /**
   * Get or create subscriber ID
   */
  getOrCreateSubscriberId() {
    let subscriberId = localStorage.getItem('zuzzuu_subscriber_id');
    
    if (!subscriberId) {
      subscriberId = window.ZuzzuuNotificationSystem ? window.ZuzzuuNotificationSystem.generateSubscriberId() : this.generateUUID();
      try {
        localStorage.setItem('zuzzuu_subscriber_id', subscriberId);
      } catch (e) {
        this.log('Error saving subscriber ID to localStorage:', e);
      }
    }
    
    return subscriberId;
  }
  
  
  /**
   * Create popup elements
   */
  createPopupElements() {
    // Create popup container
    this.elements.popup = document.createElement('div');
    this.elements.popup.className = 'zuzzuu-popup';
    
    // Create close button
    const closeButton = document.createElement('button');
    closeButton.className = 'zuzzuu-popup-close';
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => this.hideConsentPopup());
    
    // Create popup title
    const title = document.createElement('h4');
    title.className = 'zuzzuu-popup-title';
    title.textContent = 'Stay Updated with Zuzzuu';
    
    // Create popup message
    const message = document.createElement('p');
    message.className = 'zuzzuu-popup-message';
    message.textContent = 'Would you like to receive notifications about updates and important information from our website?';
    
    // Create buttons container
    this.elements.consentButtons = document.createElement('div');
    this.elements.consentButtons.className = 'zuzzuu-popup-buttons';
    
    // Create No button
    const noButton = document.createElement('button');
    noButton.className = 'zuzzuu-btn zuzzuu-btn-secondary';
    noButton.textContent = 'Maybe Later';
    noButton.addEventListener('click', () => this.handleReject());
    
    // Create Yes button
    const yesButton = document.createElement('button');
    yesButton.className = 'zuzzuu-btn zuzzuu-btn-primary';
    yesButton.textContent = 'Yes, Keep Me Updated';
    yesButton.addEventListener('click', () => this.handleConsent());
    
    // Create status message
    this.elements.statusMessage = document.createElement('div');
    this.elements.statusMessage.className = 'zuzzuu-status';
    
    // Add buttons to container
    this.elements.consentButtons.appendChild(noButton);
    this.elements.consentButtons.appendChild(yesButton);
    
    // Add elements to popup
    this.elements.popup.appendChild(closeButton);
    this.elements.popup.appendChild(title);
    this.elements.popup.appendChild(message);
    this.elements.popup.appendChild(this.elements.consentButtons);
    this.elements.popup.appendChild(this.elements.statusMessage);
    
    // Add popup to body
    document.body.appendChild(this.elements.popup);
  }
  
  /**
   * Show consent popup
   */
  showConsentPopup() {
    // Double-check consent status before showing
    const hasConsent = localStorage.getItem('zuzzuu_notification_consent');
    const isRejected = localStorage.getItem('zuzzuu_notification_rejected');
    const isRegistered = localStorage.getItem('zuzzuu_subscriber_registered');
    
    if (hasConsent || isRejected || isRegistered) {
      this.log('User has already responded to consent or is registered, not showing popup');
      return;
    }
    
    // Reset popup state
    this.elements.consentButtons.style.display = 'flex';
    this.elements.statusMessage.className = 'zuzzuu-status';
    this.elements.statusMessage.textContent = '';
    
    // Show popup with slide down animation
    this.elements.popup.classList.add('visible');
    
    this.log('Consent popup shown');
  }
  
  /**
   * Hide consent popup
   */
  hideConsentPopup() {
    this.elements.popup.classList.remove('visible');
    this.log('Consent popup hidden');
  }
  
  /**
   * Request browser notification permission
   */
  async requestNotificationPermission() {
    if (!('Notification' in window)) {
      this.log('Notifications not supported in this browser');
      return false;
    }
    
    if (Notification.permission === 'granted') {
      this.log('Notification permission already granted');
      return true;
    }
    
    if (Notification.permission === 'denied') {
      this.log('Notification permission permanently denied by user');
      return false;
    }
    
    try {
      // For browsers that support the promise-based API
      if ('requestPermission' in Notification && typeof Notification.requestPermission === 'function') {
        const permission = await Notification.requestPermission();
        this.log('Notification permission result:', permission);
        return permission === 'granted';
      }
      
      // Fallback for older browsers
      return new Promise((resolve) => {
        Notification.requestPermission((permission) => {
          this.log('Notification permission result (callback):', permission);
          resolve(permission === 'granted');
        });
      });
    } catch (error) {
      this.log('Error requesting notification permission:', error);
      return false;
    }
  }

  /**
   * Handle user consent with improved error handling
   */
  async handleConsent() {
    if (this.isRegistering) {
      this.log('Registration already in progress');
      return;
    }
    
    try {
      this.isRegistering = true;
      
      // Update UI
      this.elements.consentButtons.style.display = 'none';
      this.showStatus('Registering with Zuzzuu...', 'info');
      
      // Get client info using notification system utilities
      const clientInfo = window.ZuzzuuNotificationSystem ? {
        browser: window.ZuzzuuNotificationSystem.getBrowserInfo(),
        os: window.ZuzzuuNotificationSystem.getOSInfo(),
        language: navigator.language || navigator.userLanguage || 'en-US',
        country: window.ZuzzuuNotificationSystem.getCountryInfo()
      } : this.detectClientInfo();
      
      // Register with API FIRST (this is the most important step)
      const result = await this.registerWithApi(clientInfo);
      
      if (result && result.success) {
        // Store registration data in localStorage immediately after successful registration
        localStorage.setItem('zuzzuu_notification_consent', 'true');
        localStorage.setItem('zuzzuu_notification_consent_at', new Date().toISOString());
        localStorage.setItem('zuzzuu_subscriber_registered', 'true');
        localStorage.setItem('zuzzuu_subscriber_registration_date', new Date().toISOString());
        
        // Mark registration as complete
        this.registrationComplete = true;
        
        this.showStatus('âœ… Registration successful! Requesting notification permission...', 'success');
        
        // Now try to request notification permission (optional - don't fail if denied)
        try {
          const permissionGranted = await this.requestNotificationPermission();
          if (permissionGranted) {
            this.showStatus('âœ… Registration successful! Notifications enabled.', 'success');
            localStorage.setItem('zuzzuu_notification_permission_granted', 'true');
          } else {
            this.showStatus('âœ… Registration successful! You can enable notifications later in browser settings.', 'success');
            localStorage.setItem('zuzzuu_notification_permission_granted', 'false');
          }
        } catch (permissionError) {
          this.log('Notification permission request failed, but registration was successful:', permissionError);
          this.showStatus('âœ… Registration successful! You can enable notifications later in browser settings.', 'success');
          localStorage.setItem('zuzzuu_notification_permission_granted', 'false');
        }
        
        // Call onRegistered callback
        setTimeout(() => {
          this.options.onRegistered({
            success: true,
            subscriberId: this.subscriberId,
            registrationComplete: true,
            data: result.data || result
          });
        }, 500);
        
        // Hide popup after delay
        setTimeout(() => {
          this.hideConsentPopup();
        }, 4000);
      } else {
        throw new Error(result?.message || 'Registration failed - no success response');
      }
    } catch (error) {
      this.log('Error during consent handling:', error);
      this.showStatus('âŒ Registration failed: ' + (error.message || 'Unknown error'), 'error');
      this.options.onError(error);
      
      // Show buttons again after error
      setTimeout(() => {
        this.elements.consentButtons.style.display = 'flex';
        this.elements.statusMessage.style.display = 'none';
      }, 3000);
    } finally {
      this.isRegistering = false;
    }
  }
  
  /**
   * Handle user rejection
   */
  handleReject() {
    // Store rejection in localStorage with timestamp
    localStorage.setItem('zuzzuu_notification_rejected', 'true');
    localStorage.setItem('zuzzuu_notification_rejected_at', new Date().toISOString());
    
    this.showStatus('Notification preferences saved. You can change this later in your browser settings.', 'info');
    
    // Hide popup after short delay
    setTimeout(() => {
      this.hideConsentPopup();
    }, 2000);
  }
  
  /**
   * Show status message
   */
  showStatus(message, type) {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = 'zuzzuu-status';
    
    if (type) {
      this.elements.statusMessage.classList.add(type);
    }
  }
  
  /**
   * Register with API
   */
  async registerWithApi(clientInfo) {
    // Ensure we have a subscriber_id before making the request
    if (!this.subscriberId) {
      this.subscriberId = window.ZuzzuuNotificationSystem ? window.ZuzzuuNotificationSystem.generateSubscriberId() : this.generateUUID();
      localStorage.setItem('zuzzuu_subscriber_id', this.subscriberId);
      this.log('Generated new subscriber ID for registration:', this.subscriberId);
    }
    
    const requestData = {
      subscriber_id: this.subscriberId,  // Always send the subscriber_id from the client
      browser: clientInfo.browser,
      operating_system: clientInfo.os,
      language: clientInfo.language,
      country: clientInfo.country,
      status: 'active',
      metadata: {
        source: 'zuzzuu_subscriber_js',
        user_agent: navigator.userAgent,
        registration_type: 'consent_popup',
        page_url: window.location.origin,
        timestamp: new Date().toISOString()
      }
    };
      
    this.log('Registering with API using client subscriber_id:', requestData);
    
    try {
      // Use the public register URL from options
      const apiUrl = this.options.pubRegisterUrl;
      this.log('Using API URL:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(requestData)
      });
      
      this.log('API Response status:', response.status, response.statusText);
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        // Try to get more detailed error message from response
        try {
          const errorData = await response.json();
          if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (parseError) {
          this.log('Could not parse error response:', parseError);
        }
        
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      this.log('API response:', result);
      
      // Verify that the backend used our subscriber_id
      if (result.success && result.data && result.data.subscriber_id) {
        if (result.data.subscriber_id !== this.subscriberId) {
          this.log('WARNING: Backend returned different subscriber_id. Expected:', this.subscriberId, 'Got:', result.data.subscriber_id);
          // Update local storage with the backend's response to maintain consistency
          localStorage.setItem('zuzzuu_subscriber_id', result.data.subscriber_id);
          this.subscriberId = result.data.subscriber_id;
        } else {
          this.log('SUCCESS: Backend confirmed our subscriber_id:', this.subscriberId);
        }
      }
      
      return result;
    } catch (error) {
      this.log('API registration error:', error);
      
      // Provide more specific error messages
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Could not connect to server. Please check your internet connection.');
      } else if (error.message.includes('CORS')) {
        throw new Error('CORS error: Server configuration issue. Please try again later.');
      } else {
        throw error;
      }
    }
  }
  
  
  /**
   * Generate a UUID v4 (fallback if notification system not available)
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Detect client information (fallback if notification system not available)
   */
  detectClientInfo() {
    const userAgent = navigator.userAgent;
    let browser = 'Unknown';
    let os = 'Unknown';

    // Simple browser detection
    if (userAgent.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (userAgent.indexOf('Chrome') > -1) browser = 'Chrome';
    else if (userAgent.indexOf('Safari') > -1) browser = 'Safari';
    else if (userAgent.indexOf('Edge') > -1) browser = 'Edge';
    else if (userAgent.indexOf('MSIE') > -1 || userAgent.indexOf('Trident') > -1) browser = 'IE';

    // Simple OS detection
    if (userAgent.indexOf('Windows') > -1) os = 'Windows';
    else if (userAgent.indexOf('Mac') > -1) os = 'macOS';
    else if (userAgent.indexOf('Linux') > -1) os = 'Linux';
    else if (userAgent.indexOf('Android') > -1) os = 'Android';
    else if (userAgent.indexOf('iPhone') > -1 || userAgent.indexOf('iPad') > -1) os = 'iOS';

    // Get language and country
    const language = navigator.language || navigator.userLanguage || 'en-US';
    let country = 'US';

    try {
      const countryCode = language.split('-').pop().toUpperCase();
      if (countryCode && countryCode.length === 2) {
        country = countryCode;
      }
    } catch (e) {
      this.log('Error getting country from language:', e);
    }

    return { browser, os, language, country };
  }

  /**
   * Log debug messages
   */
  log(...args) {
    if (this.options.debug) {
      console.log('[ZuzzuuSubscriber]', ...args);
    }
  }
}

// Initialize when DOM is loaded
if (typeof window !== 'undefined') {
  window.ZuzzuuSubscriber = ZuzzuuSubscriber;

  document.addEventListener('DOMContentLoaded', function() {
    // Auto-initialize if data-zuzzuu-subscriber attribute is present
    const elements = document.querySelectorAll('[data-zuzzuu-subscriber]');
    elements.forEach(function(el) {
      const options = {
        debug: el.dataset.debug === 'true',
        autoShowConsent: el.dataset.autoShowConsent !== 'false'
      };

      if (el.dataset.apiUrl) options.apiUrl = el.dataset.apiUrl;
      if (el.dataset.pubRegisterUrl) options.pubRegisterUrl = el.dataset.pubRegisterUrl;
      if (el.dataset.consentDelay) options.consentDelay = parseInt(el.dataset.consentDelay);

      window.zuzzuuSubscriber = new ZuzzuuSubscriber(options);
    });

    // Auto-initialize subscriber system if not already initialized
    if (!window.zuzzuuSubscriber) {
      window.zuzzuuSubscriber = new ZuzzuuSubscriber({
        debug: false,
        autoShowConsent: true,
        consentDelay: 2000,
        onRegistered: function(data) {
          console.log('[ZuzzuuSubscriber] Registration completed:', data);

          // Notify notification system that subscriber is registered
          if (window.ZuzzuuNotificationSystem) {
            window.ZuzzuuNotificationSystem.state.subscriberId = data.subscriberId;
            window.ZuzzuuNotificationSystem.log('success', 'ðŸ“± Subscriber registered, connecting to notifications...');

            // Auto-connect after successful registration
            setTimeout(() => {
              if (window.ZuzzuuNotificationSystem && !window.ZuzzuuNotificationSystem.state.connected) {
                window.ZuzzuuNotificationSystem.connect();
              }
            }, 1000);
          }
        },
        onError: function(error) {
          console.error('[ZuzzuuSubscriber] Registration failed:', error);

          // Notify notification system of registration failure
          if (window.ZuzzuuNotificationSystem) {
            window.ZuzzuuNotificationSystem.log('error', `âŒ Subscriber registration failed: ${error.message}`);
          }
        }
      });
    }
  });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZuzzuuSubscriber;
}
