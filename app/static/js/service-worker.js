const CACHE_NAME = 'scouting-app-v3';
const STATIC_CACHE_NAME = 'scouting-app-static-v3';
const DYNAMIC_CACHE_NAME = 'scouting-app-dynamic-v3';
const OFFLINE_PAGE = '/static/offline.html';

// Expanded list of core navigation URLs to pre-cache
const CORE_URLS = [
  '/',
  '/scout',
  '/scout/match',
  '/scout/pit',
  '/team/manage',
  '/scouting/home'
];

// Critical static assets for app shell
const STATIC_ASSETS = [
  // App shell assets
  '/static/css/global.css',
  '/static/css/index.css',
  '/static/js/Canvas.js',
  '/static/js/offline-manager.js',
  '/static/js/notifications.js',
  
  // Images and icons
  '/static/images/field-2025.png',
  '/static/images/default_profile.png',
  '/static/images/offline-image.png',
  '/static/logo.png',
  '/static/icons/icon-192x192.png',
  '/static/icons/icon-512x512.png',
  
  // Fonts
  '/static/fonts/Richardson Brand Accelerator.otf',
  '/static/fonts/oxanium-vrb.ttf',
  
  // Other essential files
  '/static/manifest.json',
  '/static/offline.html',
  '/static/connection-test.txt'
];

// Combined list of all URLs to pre-cache (core URLs + static assets)
const PRECACHE_URLS = [...CORE_URLS, ...STATIC_ASSETS];

// Install event - cache static assets and core pages
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing new service worker (v3)...');
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching app shell and core pages');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => {
        console.log('[ServiceWorker] Installation complete, skipping waiting');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('[ServiceWorker] Pre-cache error:', error);
      })
  );
});

// Activate event - clean up old caches and take control immediately
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating new service worker (v3)...');
  event.waitUntil(
    Promise.all([
      // Clear old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (![STATIC_CACHE_NAME, DYNAMIC_CACHE_NAME].includes(cacheName)) {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // CRITICAL: Claim clients immediately - this makes the service worker take control
      // of any existing clients (open pages) without requiring a reload
      self.clients.claim().then(() => {
        console.log('[ServiceWorker] Claimed all clients');
      })
    ])
  );
});

// Fetch event - handle network requests with offline support
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Don't handle non-GET and cross-origin requests (except for critical CDNs)
  if (request.method !== 'GET') {
    return;
  }
  
  // Allow same-origin requests and critical CDNs
  const isSameOrigin = url.origin === self.location.origin;
  const isCriticalCDN = 
    url.hostname.includes('cdn.tailwindcss.com') || 
    url.hostname.includes('unpkg.com');
    
  if (!isSameOrigin && !isCriticalCDN) {
    return;
  }

  // Handle navigation requests (HTML)
  if (request.mode === 'navigate' || 
      (request.headers.get('Accept') && 
       request.headers.get('Accept').includes('text/html'))) {
    
    // CRITICAL: This implements a "network-first, falling back to cache, 
    // then offline page" strategy for navigation requests
    event.respondWith(
      // First, try the network
      fetch(request)
        .then(response => {
          // If successful, clone and cache the response
          const responseToCache = response.clone();
          
          caches.open(DYNAMIC_CACHE_NAME).then(cache => {
            if (isSameOrigin) {
              cache.put(request, responseToCache);
              console.log('[ServiceWorker] Cached HTML response for:', url.pathname);
            }
          });
          
          return response;
        })
        .catch(error => {
          console.log('[ServiceWorker] Fetch failed for HTML:', url.pathname, error);
          
          // If network fails, look in cache
          return caches.match(request)
            .then(cachedResponse => {
              // Return cached HTML if available
              if (cachedResponse) {
                console.log('[ServiceWorker] Serving cached HTML for:', url.pathname);
                return cachedResponse;
              }
              
              // For core app routes, try to match parent routes
              const isAppRoute = CORE_URLS.some(route => 
                url.pathname === route || url.pathname.startsWith(route + '/')
              );
              
              if (isAppRoute) {
                // Try to find a cached parent route
                return CORE_URLS.reduce((promise, route) => {
                  return promise.then(cachedPage => {
                    if (cachedPage) return cachedPage;
                    
                    if (url.pathname.startsWith(route + '/') || url.pathname === route) {
                      return caches.match(route)
                        .then(cachedRoute => {
                          if (cachedRoute) {
                            console.log('[ServiceWorker] Serving cached parent route:', route);
                            return cachedRoute;
                          }
                          return null;
                        });
                    }
                    return null;
                  });
                }, Promise.resolve(null))
                .then(cachedPage => {
                  // If we found a cached parent route, return it
                  if (cachedPage) return cachedPage;
                  
                  // If all else fails, show the offline page
                  console.log('[ServiceWorker] No parent route cached, serving offline page');
                  return caches.match(OFFLINE_PAGE);
                });
              }
              
              // For non-app routes, serve the offline page
              console.log('[ServiceWorker] Not an app route, serving offline page');
              return caches.match(OFFLINE_PAGE);
            });
        })
    );
    return;
  }
  
  // Handle static assets (cache-first strategy)
  if (STATIC_ASSETS.some(asset => url.pathname.includes(asset)) || 
      url.pathname.startsWith('/static/')) {
    
    event.respondWith(
      caches.match(request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // Return the cached version
            return cachedResponse;
          }
          
          // If not in cache, try to fetch it
          return fetch(request)
            .then(response => {
              // Cache the new response
              const responseToCache = response.clone();
              caches.open(STATIC_CACHE_NAME).then(cache => {
                cache.put(request, responseToCache);
              });
              return response;
            })
            .catch(error => {
              console.log('[ServiceWorker] Failed to fetch static asset:', url.pathname, error);
              
              // For images, return a placeholder
              if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
                return caches.match('/static/images/offline-image.png');
              }
              
              // For other assets, return an empty response
              return new Response('/* Resource not available offline */', {
                status: 200,
                headers: { 'Content-Type': 
                  request.url.endsWith('.js') ? 'application/javascript' : 
                  request.url.endsWith('.css') ? 'text/css' : 
                  'text/plain'
                }
              });
            });
        })
    );
    return;
  }
  
  // Handle API requests (network-first with fallback)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(DYNAMIC_CACHE_NAME).then(cache => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          console.log('[ServiceWorker] API request failed, checking cache:', url.pathname);
          return caches.match(request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              
              // Return a JSON response for offline API requests
              return new Response(JSON.stringify({
                error: 'You are offline',
                offline: true,
                success: false
              }), {
                headers: { 'Content-Type': 'application/json' }
              });
            });
        })
    );
    return;
  }
  
  // For all other requests (network-first with cache fallback)
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache successful responses
        if (response.ok) {
          const responseToCache = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then(cache => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // If network request fails, try to get from cache
        return caches.match(request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // Specific handling for different file types
            if (request.url.match(/\.(js|css)$/)) {
              return new Response('/* Offline fallback */', { 
                headers: { 'Content-Type': request.url.endsWith('.js') ? 'application/javascript' : 'text/css' } 
              });
            }
            
            if (request.url.match(/\.(jpg|jpeg|png|gif|svg)$/)) {
              return caches.match('/static/images/offline-image.png');
            }
            
            // Default fallback
            return new Response('Offline content not available', {
              status: 200,
              statusText: 'OK',
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

// Cache for tracking dismissed notifications
const dismissedNotifications = new Set();

self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push event received', {
    data: event.data ? 'Has data' : 'No data',
    timestamp: new Date().toISOString()
  });
  
  try {
    if (!event.data) {
      console.warn('[ServiceWorker] Push event has no data');
      return;
    }
    
    // Parse the notification data
    let data;
    try {
      data = event.data.json();
      console.log('[ServiceWorker] Push data received:', {
        data,
        type: typeof data,
        hasTitle: !!data.title,
        hasBody: !!data.body,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('[ServiceWorker] Failed to parse push data as JSON:', error);
      const text = event.data.text();
      console.log('[ServiceWorker] Push data as text:', text);
      data = { title: 'New Notification', body: text };
    }

    // Check if this notification has been dismissed
    const notificationId = data.data?.assignment_id || 'general';
    if (dismissedNotifications.has(notificationId)) {
      console.log('[ServiceWorker] Notification was previously dismissed:', notificationId);
      return;
    }
    
    // Show the notification
    const title = data.title || 'New Notification';
    const options = {
      body: data.body || 'You have a new notification',
      icon: '/static/images/logo.png',  // Your app logo
      badge: '/static/images/logo.png',  // Small monochrome version of your logo
      data: {
        ...data.data || {},
        notificationId: notificationId
      },
      actions: data.data?.type === 'new_assignment' ? [
        {
          action: 'view',
          title: 'View Assignment'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ] : [
        {
          action: 'view',
          title: 'View'
        },
        {
          action: 'complete',
          title: 'Marked as Complete'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ],
      vibrate: [100, 50, 100],
      tag: notificationId,
      renotify: false,
      requireInteraction: false,
      timestamp: data.timestamp || Date.now(),
      silent: false,
      dir: 'auto',
      lang: 'en-US',
      badge: '/static/images/badge.png',
      image: '/static/images/logo.png',
      applicationName: 'Castle',
    };
    
    console.log('[ServiceWorker] Showing notification:', { 
      title, 
      options,
      timestamp: new Date().toISOString()
    });
    
    event.waitUntil(
      self.registration.showNotification(title, options)
        .then(() => {
          console.log('[ServiceWorker] Notification shown successfully');
        })
        .catch(error => {
          console.error('[ServiceWorker] Failed to show notification:', error);
        })
    );
  } catch (error) {
    console.error('[ServiceWorker] Error handling push event:', error);
  }
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('Notification click received', event);
  
  const {notificationId} = event.notification.data;
  
  // Close the notification
  event.notification.close();
  
  // Add to dismissed set for ALL actions
  dismissedNotifications.add(notificationId);
  
  // Handle action buttons
  const url = event.notification.data.url || '/team/manage';
  const assignmentId = event.notification.data.assignment_id;
  
  // Default action (clicking the notification body) or View action
  if (!event.action || event.action === 'view') {
    // Open or focus on the application window
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Check if there's already a window/tab open with the target URL
          for (const client of clientList) {
            if (client.url.includes(url) && 'focus' in client) {
              return client.focus();
            }
          }
          // If no existing window/tab, open a new one
          return clients.openWindow(url);
        })
    );
  } 
  // Complete action - mark the assignment as completed
  else if (event.action === 'complete' && assignmentId) {
    event.waitUntil(
      fetch(`/team/assignments/${assignmentId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'completed' })
      })
      .then(response => {
        if (response.ok) {
          // Show a confirmation notification
          return self.registration.showNotification('Assignment Completed', {
            body: 'The assignment has been marked as completed',
            icon: '/static/images/logo.png',
            tag: 'status-update-' + assignmentId
          });
        } else {
          return self.registration.showNotification('Action Failed', {
            body: 'Could not mark assignment as completed. Please try again.',
            icon: '/static/images/logo.png',
            tag: 'status-update-error-' + assignmentId
          });
        }
      })
      .catch(error => {
        console.error('Error updating status:', error);
        return self.registration.showNotification('Network Error', {
          body: 'Could not connect to the server. Please try again later.',
          icon: '/static/images/logo.png',
          tag: 'network-error'
        });
      })
    );
  }
});
