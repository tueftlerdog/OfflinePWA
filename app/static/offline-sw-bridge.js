/**
 * Offline Service Worker Bridge - Helps ensure proper offline functionality in PWA mode
 * This script should be included on all pages to improve service worker control
 */

(function() {
  // Check if service workers are supported
  if ('serviceWorker' in navigator) {
    
    // Function to check if we're in standalone PWA mode
    function isPwa() {
      return window.matchMedia('(display-mode: standalone)').matches || 
             window.navigator.standalone || 
             document.referrer.includes('android-app://');
    }
    
    // Function to handle offline mode detection
    function handleOfflineMode() {
      // Add a specific class to the body when offline
      if (!navigator.onLine) {
        document.body.classList.add('offline-mode');
      } else {
        document.body.classList.remove('offline-mode');
      }
    }
    
    // Handle clicks on links to ensure they're intercepted by the service worker
    function handleNavigation(event) {
      // Only handle if we're in PWA mode and offline
      if (isPwa() && !navigator.onLine) {
        const link = event.target.closest('a');
        
        if (link && link.href) {
          const url = new URL(link.href);
          
          // Only handle same-origin links
          if (url.origin === window.location.origin) {
            event.preventDefault();
            
            // Use the history API instead of direct navigation
            // This helps ensure the service worker intercepts the request
            window.history.pushState(null, '', url.pathname);
            
            // Dispatch a popstate event to trigger the same behavior as real navigation
            window.dispatchEvent(new PopStateEvent('popstate'));
            
            // Reload the page to ensure it's handled by the service worker
            window.location.reload();
          }
        }
      }
    }
    
    // Monitor online/offline status
    window.addEventListener('online', handleOfflineMode);
    window.addEventListener('offline', handleOfflineMode);
    
    // Add navigation handler
    document.addEventListener('click', handleNavigation);
    
    // Initial setup
    handleOfflineMode();
    
    // Reload the page if we detect we're in a PWA but not controlled by SW
    if (isPwa() && !navigator.serviceWorker.controller) {
      console.log('PWA detected but not controlled by service worker, reloading...');
      window.location.reload();
    }
  }
})(); 