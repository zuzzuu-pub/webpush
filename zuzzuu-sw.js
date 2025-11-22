/**
 * Zuzzuu Modern Service Worker for WebPush Notifications
 * Version: 2.0.0
 * 
 * This service worker handles:
 * - Push notification events
 * - Notification click actions
 * - Background sync
 * - Offline notification storage
 * - Notification analytics
 */

// Configuration
const CONFIG = {
    DEBUG: false,
    VAPID_PUBLIC_KEY: '', // Will be set dynamically
    NOTIFICATION_ICON: '/icons/icon-192x192.png',
    DEFAULT_NOTIFICATION_ICON: '/icons/default-notification-icon.png',
    STORAGE_KEYS: {
        PENDING_NOTIFICATIONS: 'zuzzuu_pending_notifications',
        USER_PREFERENCES: 'zuzzuu_user_preferences',
        ANALYTICS: 'zuzzuu_notification_analytics'
    }
};

// Debug logging
function debugLog(...args) {
    if (CONFIG.DEBUG) {
        console.log('[ZuzzuuSW]', ...args);
    }
}

// Service Worker Install Event
self.addEventListener('install', (event) => {
    debugLog('Service Worker installing...');
    
    // Skip waiting to activate immediately
    self.skipWaiting();
    
    // Cache static assets
    event.waitUntil(
        caches.open('zuzzuu-static-v1').then((cache) => {
            return cache.addAll([
                '/',
                '/static/zuzzuu-sw.js',
                CONFIG.DEFAULT_NOTIFICATION_ICON,
                '/manifest.json'
            ]);
        })
    );
});

// Service Worker Activate Event
self.addEventListener('activate', (event) => {
    debugLog('Service Worker activating...');
    
    // Claim all clients immediately
    event.waitUntil(self.clients.claim());
    
    // Clean up old caches
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith('zuzzuu-static-') && cacheName !== 'zuzzuu-static-v1') {
                        debugLog('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Push Event Handler
self.addEventListener('push', (event) => {
    debugLog('Push event received:', event);
    
    if (!event.data) {
        debugLog('No data in push event');
        return;
    }
    
    try {
        const data = event.data.json();
        debugLog('Push data:', data);
        
        const options = buildNotificationOptions(data);
        
        // Show notification
        event.waitUntil(
            self.registration.showNotification(data.title || 'Notification', options)
        );
        
        // Track analytics
        trackNotificationEvent('push_received', data);
        
    } catch (error) {
        debugLog('Error processing push event:', error);
        
        // Fallback notification
        event.waitUntil(
            self.registration.showNotification('New Notification', {
                body: 'You have a new notification',
                icon: CONFIG.DEFAULT_NOTIFICATION_ICON,
                badge: CONFIG.NOTIFICATION_ICON,
                tag: 'fallback-notification',
                timestamp: Date.now()
            })
        );
    }
});

// Notification Click Event
self.addEventListener('notificationclick', (event) => {
    debugLog('Notification clicked:', event.notification.tag);
    
    event.notification.close();
    
    const data = event.notification.data || {};
    const action = event.action || 'default';
    
    // Track analytics
    trackNotificationEvent('notification_click', {
        notification: data,
        action: action
    });
    
    event.waitUntil(handleNotificationClick(action, data));
});

// Notification Close Event
self.addEventListener('notificationclose', (event) => {
    debugLog('Notification closed:', event.notification.tag);
    
    const data = event.notification.data || {};
    trackNotificationEvent('notification_dismissed', data);
});

// Background Sync Event
self.addEventListener('sync', (event) => {
    debugLog('Background sync event:', event.tag);
    
    if (event.tag === 'background-notification-sync') {
        event.waitUntil(syncPendingNotifications());
    }
});

// Message Event from Client
self.addEventListener('message', (event) => {
    debugLog('Message received from client:', event.data);
    
    const { type, data } = event.data;
    
    switch (type) {
        case 'SET_VAPID_KEY':
            CONFIG.VAPID_PUBLIC_KEY = data.publicKey;
            debugLog('VAPID key set');
            break;
            
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;
            
        case 'GET_PENDING_NOTIFICATIONS':
            getPendingNotifications().then((notifications) => {
                event.ports[0].postMessage({
                    type: 'PENDING_NOTIFICATIONS',
                    data: notifications
                });
            });
            break;
            
        case 'CLEAR_PENDING_NOTIFICATIONS':
            clearPendingNotifications();
            event.ports[0].postMessage({
                type: 'PENDING_NOTIFICATIONS_CLEARED'
            });
            break;
            
        default:
            debugLog('Unknown message type:', type);
    }
});

// Helper Functions

function buildNotificationOptions(data) {
    const options = {
        body: data.body || data.message || '',
        icon: data.icon || data.logo_url || CONFIG.NOTIFICATION_ICON,
        badge: CONFIG.NOTIFICATION_ICON,
        tag: data.tag || generateNotificationTag(data),
        timestamp: Date.now(),
        requireInteraction: data.requireInteraction || false,
        silent: data.silent || false,
        vibrate: data.vibrate || [200, 100, 200],
        data: {
            id: data.id,
            url: data.url || data.action_url,
            timestamp: data.timestamp,
            action_url: data.action_url,
            action_title: data.action_title,
            ...data.data
        },
        actions: []
    };
    
    // Add actions
    if (data.actions && Array.isArray(data.actions)) {
        options.actions = data.actions.map((action, index) => ({
            action: action.action || `action_${index}`,
            title: action.title,
            icon: action.icon
        }));
    } else if (data.action_url && data.action_title) {
        options.actions.push({
            action: 'open',
            title: data.action_title,
            icon: data.action_icon
        });
    }
    
    // Add image
    if (data.image || data.image_url) {
        options.image = data.image || data.image_url;
    }
    
    return options;
}

async function handleNotificationClick(action, data) {
    try {
        const url = data.url || data.action_url || '/';
        
        // Focus existing window if available
        const clients = await self.clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        });
        
        let client = null;
        for (const c of clients) {
            if (c.url === url || c.url.includes(url)) {
                client = c;
                break;
            }
        }
        
        if (client) {
            // Focus the existing window
            await client.focus();
            
            // Send message to client
            client.postMessage({
                type: 'NOTIFICATION_CLICKED',
                data: {
                    action: action,
                    notification: data,
                    url: url
                }
            });
            
        } else {
            // Open new window
            const newClient = await self.clients.openWindow(url);
            
            if (newClient) {
                // Send message to new client after it's loaded
                newClient.postMessage({
                    type: 'NOTIFICATION_CLICKED',
                    data: {
                        action: action,
                        notification: data,
                        url: url
                    }
                });
            }
        }
        
        debugLog('Notification click handled:', action, url);
        
    } catch (error) {
        debugLog('Error handling notification click:', error);
    }
}

function generateNotificationTag(data) {
    // Generate a consistent tag for notifications
    if (data.tag) return data.tag;
    
    const timestamp = data.timestamp || Date.now();
    const title = data.title || 'notification';
    const hash = btoa(title).slice(0, 8);
    
    return `zuzzuu-${hash}-${timestamp}`;
}

function trackNotificationEvent(eventType, data) {
    try {
        const analytics = getStoredItem(CONFIG.STORAGE_KEYS.ANALYTICS, {
            push_received: 0,
            notification_click: 0,
            notification_dismissed: 0,
            last_updated: Date.now()
        });
        
        analytics[eventType] = (analytics[eventType] || 0) + 1;
        analytics.last_updated = Date.now();
        
        setStoredItem(CONFIG.STORAGE_KEYS.ANALYTICS, analytics);
        
        debugLog('Analytics tracked:', eventType, analytics);
        
    } catch (error) {
        debugLog('Error tracking analytics:', error);
    }
}

async function syncPendingNotifications() {
    try {
        debugLog('Syncing pending notifications...');
        
        const pending = await getPendingNotifications();
        debugLog('Pending notifications:', pending.length);
        
        for (const notification of pending) {
            try {
                await self.registration.showNotification(
                    notification.title || 'Notification',
                    buildNotificationOptions(notification.data)
                );
                
                debugLog('Synced notification:', notification.id);
                
            } catch (error) {
                debugLog('Error syncing notification:', notification.id, error);
            }
        }
        
        // Clear pending notifications after syncing
        await clearPendingNotifications();
        
    } catch (error) {
        debugLog('Error syncing pending notifications:', error);
    }
}

// Storage Helpers
function getStoredItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
        debugLog('Error getting stored item:', key, error);
        return defaultValue;
    }
}

function setStoredItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        debugLog('Error setting stored item:', key, error);
    }
}

async function getPendingNotifications() {
    try {
        const cache = await caches.open('zuzzuu-pending-v1');
        const response = await cache.match(CONFIG.STORAGE_KEYS.PENDING_NOTIFICATIONS);
        
        if (response) {
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        }
        
        return [];
    } catch (error) {
        debugLog('Error getting pending notifications:', error);
        return [];
    }
}

async function storePendingNotification(notification) {
    try {
        const cache = await caches.open('zuzzuu-pending-v1');
        const pending = await getPendingNotifications();
        
        pending.push(notification);
        
        await cache.put(
            CONFIG.STORAGE_KEYS.PENDING_NOTIFICATIONS,
            new Response(JSON.stringify(pending))
        );
        
        debugLog('Stored pending notification:', notification.id);
        
    } catch (error) {
        debugLog('Error storing pending notification:', error);
    }
}

async function clearPendingNotifications() {
    try {
        const cache = await caches.open('zuzzuu-pending-v1');
        await cache.delete(CONFIG.STORAGE_KEYS.PENDING_NOTIFICATIONS);
        debugLog('Cleared pending notifications');
    } catch (error) {
        debugLog('Error clearing pending notifications:', error);
    }
}

// Public API for clients
self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        // Make service worker controller available immediately
        if (self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
        }
    })());
});

// Export for testing (in development)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        buildNotificationOptions,
        generateNotificationTag,
        trackNotificationEvent
    };
}

debugLog('Zuzzuu Service Worker loaded successfully');
