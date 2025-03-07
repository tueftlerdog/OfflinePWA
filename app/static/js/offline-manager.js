/**
 * Offline Manager - Manages offline functionality for the Castle Scouting App
 * 
 * Features:
 * - Monitors online/offline status
 * - Shows notifications to the user when network status changes
 * - Manages data queuing and synchronization
 * - Provides offline status indicator
 */

class OfflineManager {
  constructor() {
    this.isOnline = navigator.onLine;
    this.pendingRequests = [];
    this.offlineIndicator = null;
    this.offlineNotificationShown = false;
    this.toastTimeout = null;
    this.syncInProgress = false;
    this.networkCheckInterval = null;

    // Initialize IndexedDB for offline storage
    this.initIndexedDB();
    
    // Add event listeners for online/offline events
    this.setupEventListeners();
    
    // Create UI elements
    this.createToastContainer();
    this.createOfflineIndicator();
    
    // Start periodic connection check
    this.startPeriodicConnectionCheck();
    
    // Initial status check and UI update
    this.checkNetworkStatus(true);
  }

  /**
   * Initialize IndexedDB for offline data storage
   */
  async initIndexedDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('CastleOfflineDB', 1);
      
      request.onerror = (event) => {
        console.error('IndexedDB error:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('IndexedDB initialized successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object stores for different types of data
        if (!db.objectStoreNames.contains('scoutingData')) {
          const scoutingStore = db.createObjectStore('scoutingData', { keyPath: 'id', autoIncrement: true });
          scoutingStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          scoutingStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        if (!db.objectStoreNames.contains('pendingRequests')) {
          const requestsStore = db.createObjectStore('pendingRequests', { keyPath: 'id', autoIncrement: true });
          requestsStore.createIndex('url', 'url', { unique: false });
          requestsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  /**
   * Set up event listeners for online/offline events
   */
  setupEventListeners() {
    window.addEventListener('online', () => this.handleNetworkChange());
    window.addEventListener('offline', () => this.handleNetworkChange());
    
    // Handle visibility change to check network status when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkNetworkStatus();
      }
    });
    
    // Listen for form submissions to handle offline submissions
    document.addEventListener('submit', (event) => {
      if (!this.isOnline && event.target.method?.toLowerCase() === 'post') {
        // If we're offline and this is a POST form, handle it specially
        this.handleOfflineFormSubmission(event);
      }
    });
  }

  /**
   * Handle form submissions when offline
   * @param {Event} event - The form submission event
   */
  handleOfflineFormSubmission(event) {
    // Only handle if we're truly offline
    if (!this.isOnline) {
      const form = event.target;
      
      // Prevent the default submission
      event.preventDefault();
      
      // Get form data
      const formData = new FormData(form);
      const data = {};
      
      // Convert FormData to JSON object
      for (const [key, value] of formData.entries()) {
        data[key] = value;
      }
      
      // Add metadata
      data._offlineSubmitted = true;
      data._submittedAt = new Date().toISOString();
      data._formAction = form.action;
      data._formMethod = form.method;
      
      // Store in IndexedDB
      this.storeScoutingData(data)
        .then((id) => {
          this.showToast('Your form has been saved offline and will be submitted when you reconnect.', 'success');
          
          // If the form has a success redirect data attribute, use it
          const successRedirect = form.dataset.successRedirect;
          if (successRedirect) {
            window.location.href = successRedirect;
          }
        })
        .catch((error) => {
          console.error('Error storing form data offline:', error);
          this.showToast('Failed to save your data offline. Please try again.', 'error');
        });
    }
  }

  /**
   * Start periodic check of connection status
   * This helps detect "lie-fi" situations where the browser thinks it's online
   * but actual requests fail
   */
  startPeriodicConnectionCheck() {
    // Clear any existing interval
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
    }
    
    // Check every 30 seconds
    this.networkCheckInterval = setInterval(() => {
      this.performActiveConnectionCheck();
    }, 30000);
  }

  /**
   * Actively check if we can actually reach the server
   * This helps detect situations where the browser thinks it's online
   * but the connection doesn't actually work
   */
  async performActiveConnectionCheck() {
    if (!navigator.onLine) {
      // If the browser already knows we're offline, no need to check
      return;
    }
    
    try {
      // Try to fetch a tiny resource with a cache buster
      const response = await fetch(`/static/connection-test.txt?cachebust=${Date.now()}`, {
        method: 'HEAD',
        headers: { 'Cache-Control': 'no-cache' },
        mode: 'no-cors',
        cache: 'no-store'
      });
      
      // If we get a response, we're truly online
      const wasOffline = !this.isOnline;
      this.isOnline = true;
      
      // If we transitioned from offline to online, handle it
      if (wasOffline) {
        this.handleNetworkChange();
      }
    } catch (error) {
      // If the fetch fails, we're offline even if the browser thinks we're online
      const wasOnline = this.isOnline;
      this.isOnline = false;
      
      // If we transitioned from online to offline, handle it
      if (wasOnline) {
        this.handleNetworkChange();
      }
    }
  }

  /**
   * Check current network status
   * @param {boolean} initial - Whether this is the initial check
   */
  checkNetworkStatus(initial = false) {
    const wasOnline = this.isOnline;
    this.isOnline = navigator.onLine;
    
    // If status changed or this is initial load, update UI
    if (wasOnline !== this.isOnline || initial) {
      this.updateOfflineIndicator();
      
      // If it's not the initial check and status actually changed, handle it
      if (!initial && wasOnline !== this.isOnline) {
        this.handleNetworkChange();
      }
    }
  }

  /**
   * Create a persistent offline indicator
   */
  createOfflineIndicator() {
    // Check if indicator already exists
    if (document.getElementById('offline-status-indicator')) {
      this.offlineIndicator = document.getElementById('offline-status-indicator');
      return;
    }
    
    // Create indicator element
    this.offlineIndicator = document.createElement('div');
    this.offlineIndicator.id = 'offline-status-indicator';
    this.offlineIndicator.className = 'offline-indicator hidden';
    
    // Create content
    this.offlineIndicator.innerHTML = `
      <div class="offline-indicator-icon">📶</div>
      <div class="offline-indicator-text">Offline Mode</div>
    `;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .offline-indicator {
        position: fixed;
        bottom: 16px;
        left: 16px;
        background-color: #ef4444;
        color: white;
        padding: 8px 12px;
        border-radius: 50px;
        font-size: 14px;
        font-weight: bold;
        display: flex;
        align-items: center;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
        transition: transform 0.3s ease, opacity 0.3s ease;
        z-index: 9999;
        cursor: pointer;
      }
      
      .offline-indicator.hidden {
        transform: translateY(150%);
        opacity: 0;
      }
      
      .offline-indicator-icon {
        margin-right: 6px;
      }
      
      @media (max-width: 640px) {
        .offline-indicator {
          bottom: 70px;
        }
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(this.offlineIndicator);
    
    // Add click handler to show more info
    this.offlineIndicator.addEventListener('click', () => {
      this.showToast('You are currently offline. Your data will be saved locally and synchronized when you reconnect.', 'warning');
    });
    
    // Initial update
    this.updateOfflineIndicator();
  }

  /**
   * Update the offline indicator based on current connection status
   */
  updateOfflineIndicator() {
    if (!this.offlineIndicator) {
      this.createOfflineIndicator();
    }
    
    if (this.isOnline) {
      this.offlineIndicator.classList.add('hidden');
    } else {
      this.offlineIndicator.classList.remove('hidden');
    }
  }

  /**
   * Handle network status change events
   */
  handleNetworkChange() {
    const wasOnline = this.isOnline;
    this.isOnline = navigator.onLine;
    
    // Check if status actually changed
    if (wasOnline === this.isOnline) {
      return;
    }
    
    // Update UI
    this.updateOfflineIndicator();
    
    if (this.isOnline) {
      console.log('🌐 Application is online');
      this.showToast('You are back online! Syncing data...', 'success');
      this.syncPendingData();
    } else {
      console.log('📴 Application is offline');
      this.showToast('You are offline. Data will be saved locally.', 'warning');
    }
    
    // Dispatch custom event for other parts of the application
    const event = new CustomEvent('networkStatusChanged', { 
      detail: { isOnline: this.isOnline } 
    });
    document.dispatchEvent(event);
  }

  /**
   * Show toast notification to the user
   * @param {string} message - The message to display
   * @param {string} type - Type of toast (success, warning, error)
   */
  showToast(message, type = 'info') {
    // Clear any existing timeout
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    
    // Get or create toast container
    let toastContainer = document.getElementById('offline-toast-container');
    if (!toastContainer) {
      this.createToastContainer();
      toastContainer = document.getElementById('offline-toast-container');
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `offline-toast ${type}`;
    toast.innerText = message;
    
    // Add icon based on type
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    
    if (type === 'success') {
      icon.innerHTML = '✅';
    } else if (type === 'warning') {
      icon.innerHTML = '⚠️';
    } else if (type === 'error') {
      icon.innerHTML = '❌';
    } else {
      icon.innerHTML = 'ℹ️';
    }
    
    toast.prepend(icon);
    
    // Add close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    };
    toast.appendChild(closeBtn);
    
    // Add to container
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);
    
    // Auto remove after 5 seconds
    this.toastTimeout = setTimeout(() => {
      toast.classList.add('toast-hiding');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, 5000);
  }

  /**
   * Create toast container if it doesn't exist
   */
  createToastContainer() {
    // Check if container already exists
    if (document.getElementById('offline-toast-container')) {
      return;
    }
    
    // Create container
    const container = document.createElement('div');
    container.id = 'offline-toast-container';
    document.body.appendChild(container);
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #offline-toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
      }
      
      .offline-toast {
        background-color: #fff;
        color: #333;
        border-radius: 6px;
        padding: 12px 15px;
        margin-bottom: 10px;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15);
        transform: translateX(120%);
        transition: transform 0.3s ease;
        display: flex;
        align-items: center;
        min-width: 240px;
        max-width: 350px;
        position: relative;
      }
      
      .offline-toast.show {
        transform: translateX(0);
      }
      
      .offline-toast.toast-hiding {
        transform: translateX(120%);
      }
      
      .offline-toast.success {
        border-left: 4px solid #10b981;
      }
      
      .offline-toast.warning {
        border-left: 4px solid #f59e0b;
      }
      
      .offline-toast.error {
        border-left: 4px solid #ef4444;
      }
      
      .offline-toast.info {
        border-left: 4px solid #3b82f6;
      }
      
      .toast-icon {
        margin-right: 10px;
      }
      
      .toast-close {
        position: absolute;
        top: 8px;
        right: 8px;
        cursor: pointer;
        font-size: 18px;
        opacity: 0.6;
      }
      
      .toast-close:hover {
        opacity: 1;
      }

      @media (max-width: 480px) {
        #offline-toast-container {
          left: 10px;
          right: 10px;
          top: 10px;
          align-items: stretch;
        }
        
        .offline-toast {
          min-width: auto;
          max-width: none;
          transform: translateY(-120%);
        }
        
        .offline-toast.show {
          transform: translateY(0);
        }
        
        .offline-toast.toast-hiding {
          transform: translateY(-120%);
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Store scouting data in IndexedDB
   * @param {Object} data - The scouting data to store
   * @returns {Promise<number>} - The ID of the stored data
   */
  async storeScoutingData(data) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['scoutingData'], 'readwrite');
      const store = transaction.objectStore('scoutingData');
      
      // Add metadata for sync
      const dataToStore = {
        ...data,
        syncStatus: 'pending',
        timestamp: Date.now()
      };
      
      const request = store.add(dataToStore);
      
      request.onsuccess = (event) => {
        console.log('Stored scouting data locally with ID:', event.target.result);
        this.showToast('Data saved locally and will be uploaded when you are back online', 'info');
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        console.error('Error storing scouting data:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Queue a network request for later
   * @param {string} url - The URL to request
   * @param {Object} options - Fetch API options
   * @returns {Promise<number>} - The ID of the queued request
   */
  async queueRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      
      const request = store.add({
        url,
        options,
        timestamp: Date.now()
      });
      
      request.onsuccess = (event) => {
        console.log('Queued request for later with ID:', event.target.result);
        resolve(event.target.result);
      };
      
      request.onerror = (event) => {
        console.error('Error queueing request:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Synchronize all pending data with the server
   */
  async syncPendingData() {
    if (!this.isOnline || this.syncInProgress) {
      return;
    }
    
    this.syncInProgress = true;
    console.log('Starting data synchronization...');
    
    try {
      // Sync scouting data
      await this.syncScoutingData();
      
      // Process pending requests
      await this.processPendingRequests();
      
      console.log('Data synchronization complete');
      this.showToast('All data synchronized successfully', 'success');
    } catch (error) {
      console.error('Error during data synchronization:', error);
      this.showToast('Error synchronizing some data', 'error');
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Synchronize pending scouting data with the server
   */
  async syncScoutingData() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['scoutingData'], 'readwrite');
      const store = transaction.objectStore('scoutingData');
      const index = store.index('syncStatus');
      
      const request = index.openCursor(IDBKeyRange.only('pending'));
      
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        
        if (cursor) {
          const data = cursor.value;
          
          try {
            // Send data to server
            const response = await fetch('/api/scout/submit', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(data)
            });
            
            if (response.ok) {
              // Update sync status
              data.syncStatus = 'synced';
              cursor.update(data);
              console.log('Synchronized scouting data with ID:', data.id);
            } else {
              console.error('Server rejected scouting data:', await response.text());
            }
          } catch (error) {
            console.error('Error sending scouting data to server:', error);
          }
          
          cursor.continue();
        } else {
          resolve();
        }
      };
      
      request.onerror = (event) => {
        console.error('Error accessing scouting data for sync:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Process all pending network requests
   */
  async processPendingRequests() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      
      const request = store.openCursor();
      
      request.onsuccess = async (event) => {
        const cursor = event.target.result;
        
        if (cursor) {
          const { url, options } = cursor.value;
          
          try {
            // Send request
            await fetch(url, options);
            
            // Remove from queue
            cursor.delete();
            console.log('Processed queued request:', url);
          } catch (error) {
            console.error('Error processing queued request:', error);
          }
          
          cursor.continue();
        } else {
          resolve();
        }
      };
      
      request.onerror = (event) => {
        console.error('Error accessing pending requests:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Get the count of pending offline items to be synced
   * @returns {Promise<number>} - Number of pending items
   */
  async getPendingItemCount() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(0);
        return;
      }

      try {
        const transaction = this.db.transaction(['scoutingData'], 'readonly');
        const store = transaction.objectStore('scoutingData');
        const index = store.index('syncStatus');
        
        const countRequest = index.count(IDBKeyRange.only('pending'));
        
        countRequest.onsuccess = () => {
          resolve(countRequest.result);
        };
        
        countRequest.onerror = (event) => {
          console.error('Error counting pending items:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in getPendingItemCount:', error);
        resolve(0);
      }
    });
  }

  /**
   * Send data to the server with offline support
   * @param {string} url - The URL to send data to
   * @param {Object} data - The data to send
   * @param {Object} options - Additional fetch options
   * @returns {Promise<Object>} - The server response or stored data ID
   */
  async sendData(url, data, options = {}) {
    // If online, try to send directly
    if (this.isOnline) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          body: JSON.stringify(data),
          ...options
        });
        
        if (response.ok) {
          return await response.json();
        } else {
          // If server responds with an error, try to fall back to offline storage
          const storedId = await this.storeScoutingData(data);
          return { id: storedId, offlineStored: true, serverError: true };
        }
      } catch (error) {
        console.error('Error sending data, falling back to offline storage:', error);
        
        // If fetch fails (network error), fall back to offline storage
        const storedId = await this.storeScoutingData(data);
        
        // Run a connection check as we might actually be offline
        this.performActiveConnectionCheck();
        
        return { id: storedId, offlineStored: true };
      }
    } else {
      // If offline, store immediately
      const storedId = await this.storeScoutingData(data);
      return { id: storedId, offlineStored: true };
    }
  }
}

// Initialize the offline manager when the page loads
let offlineManager;
document.addEventListener('DOMContentLoaded', () => {
  offlineManager = new OfflineManager();
  
  // Make it available globally
  window.offlineManager = offlineManager;
  
  // Create a tiny connection test file if it doesn't exist
  fetch('/static/connection-test.txt')
    .catch(() => {
      console.log('Creating connection test file for offline detection');
      // If it doesn't exist, the service worker will handle this when offline
    });
}); 