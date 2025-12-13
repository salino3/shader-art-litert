// generate-sw.js
import fs from "fs/promises";
import path from "path";

// Define the output folder of your project
const distDir = "dist";
// Set the base URL prefix for your GitHub Pages project
const BASE_URL_PREFIX = "/shader-art-litert/";
const OFFLINE_PAGE = "/shader-art-litert/404.html";

// This recursive function finds all files in a directory
async function getFiles(dir, files = []) {
  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      // Ignore the 'node_modules' folder and any others you don't want to cache
      if (item.name === "node_modules") continue;
      // Traverse subdirectories
      await getFiles(itemPath, files);
    } else {
      // Ignore the temporary sw.js file to avoid an infinite loop
      if (item.name === "sw.js") continue;
      files.push(itemPath);
    }
  }

  return files;
}

// Main async function to handle file generation
async function generateServiceWorker() {
  // Get the complete list of files in the 'dist' folder
  const allFiles = await getFiles(distDir);

  // Prepare the URL array for the Service Worker
  const urlsToCache = allFiles.map((file) => {
    // Remove the 'dist/' folder from the beginning of the path
    const relativePath = file.substring(distDir.length + 1);
    // Normalize path separators to forward slashes for URLs (Windows uses backslashes)
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return `${BASE_URL_PREFIX}${normalizedPath}`;
  });

  // The base content of your Service Worker
  const swContent = `
const CACHE_NAME = 'shader-art-cache-v1';
const OFFLINE_URL = '${OFFLINE_PAGE}';

// List of files to precache automatically
const urlsToCache = [
  ...${JSON.stringify(urlsToCache, null, 2)},
  OFFLINE_URL
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        // Add all static assets and the offline page to the cache
        return cache.addAll(urlsToCache);
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete old caches that don't match the current cache name
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Handle root path requests - redirect to index.html
  const url = new URL(event.request.url);
  const rootPath = '${BASE_URL_PREFIX}';
  const indexPath = '${BASE_URL_PREFIX}index.html';
  
  if (url.pathname === rootPath || url.pathname === rootPath.slice(0, -1) || url.pathname === indexPath) {
    event.respondWith(
      caches.match(indexPath)
        .then((response) => {
          if (response) return response;
          return fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                  cache.put(indexPath, responseToCache);
                });
              }
              return networkResponse;
            })
            .catch(() => caches.match(OFFLINE_URL));
        })
    );
    return;
  }

  event.respondWith(
    // Try to find the resource in the cache first
    caches.match(event.request)
    .then((response) => {
      // If the resource is in the cache, return it
      if (response) {
        return response;
      }

      // If not in cache, try to fetch it from the network
      return fetch(event.request)
        .then((networkResponse) => {
          // Cache successful network responses for future use
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If the network request fails (because we're offline)
          if (event.request.mode === 'navigate') {
            // For navigation requests, serve the offline page (404.html)
            return caches.match(OFFLINE_URL);
          }
          // For other requests, try to match the request URL in cache
          return caches.match(event.request);
        });
    })
  );
});
`;

  // Write the content to the new sw.js file inside 'dist'
  try {
    await fs.writeFile(path.join(distDir, "sw.js"), swContent);
    console.log("sw.js successfully generated with dynamic precaching paths!");

    // Copy index.html to 404.html for GitHub Pages offline fallback
    const indexHtmlPath = path.join(distDir, "index.html");
    const fourOhFourHtmlPath = path.join(distDir, "404.html");
    try {
      await fs.copyFile(indexHtmlPath, fourOhFourHtmlPath);
      console.log("404.html created from index.html for offline support!");
    } catch (copyError) {
      console.error("Error copying index.html to 404.html:", copyError);
    }
  } catch (error) {
    console.error("Error writing sw.js file:", error);
  }
}

// Run the main function
generateServiceWorker();
