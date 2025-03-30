// /home/admin/imgu/frontend/src/app/page.jsx (Updated to display metadata list)
"use client";

import React, { useState, useEffect } from 'react';

export default function HomePage() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  // Construct the start sync URL safely, ensuring no double slash if apiUrl ends with one
  const startSyncUrl = apiUrl ? `${apiUrl.replace(/\/$/, '')}/start-sync` : null;

  useEffect(() => {
    async function fetchImageData() {
      if (!apiUrl) {
        setError("API URL configuration missing.");
        setLoading(false);
        return;
      }
      console.log(`Workspaceing data from: ${apiUrl}`);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(apiUrl); // GET / to fetch image list
        if (!response.ok) throw new Error(`HTTP error fetching image list! status: ${response.status}`);
        const data = await response.json();
        if (data && data.length > 0) console.log('First image data sample:', data[0]);
        console.log("Image list fetched successfully:", data.length);
        setImages(data);
      } catch (e) {
        console.error("Failed to fetch images:", e);
        if (e instanceof TypeError && e.message.includes('fetch')) { // Broader check for fetch errors
             setError(`Network error: Failed to fetch image list from API. Check network or CORS.`);
        } else {
             setError(`Failed to load images: ${e.message}`);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchImageData();
  }, [apiUrl]);

  const handleStartSync = async () => {
      if (!startSyncUrl) {
          setSyncStatus('Error: API URL not configured properly.');
          return;
      }
      setSyncStatus('Initiating sync process...');
      setIsSyncing(true);

      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json();

          if (!response.ok || response.status !== 202) { // Check for non-202 status as well
              throw new Error(result.message || `Failed to start sync (${response.status})`);
          }
          setSyncStatus(`Sync process initiated successfully! Execution ARN: ${result.executionArn || 'N/A'}`);
      } catch (error) {
          console.error('Error starting sync:', error);
          setSyncStatus(`Error starting sync: ${error.message}`);
          setIsSyncing(false);
      }
      // Optional: Clear status and re-enable button after a delay
      // setTimeout(() => { setSyncStatus(''); setIsSyncing(false); }, 10000);
  };

  // --- Render Logic ---
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <h1>Unsplash Image Gallery</h1>
      <p>Images synchronized from Unsplash, stored in Cloudflare R2 & AWS DynamoDB.</p>

      {/* --- 同步控制 --- */}
      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee' }}>
          <button onClick={handleStartSync} disabled={isSyncing}>
              Start Syncing Oldest Photos (Batch 30, 2min interval)
          </button>
          {syncStatus && <p style={{ marginTop: '10px', color: syncStatus.startsWith('Error') ? 'red' : 'green' }}>{syncStatus}</p>}
      </div>

      {/* --- 图片元数据展示 --- */}
      <h2>Synchronized Image Metadata</h2>
      {loading && <p>Loading metadata...</p>}
      {error && <p style={{ color: 'red' }}>Error loading metadata: {error}</p>}
      {!loading && !error && (
        <div style={{ overflowX: 'auto' }}> {/* Add scroll for smaller screens */}
          {images.length === 0 ? (
            <p>No image metadata found. Try starting the sync?</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid black' }}>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Category</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>R2 Object Key</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Dimensions</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Sync Timestamp</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Unsplash ID</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr key={image.photo_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{image.image_category || 'N/A'}</td>
                    <td style={{ padding: '8px', wordBreak: 'break-all' }}>{image.r2_object_key || 'N/A'}</td>
                    {/* 确认 width 和 height 是直接可访问的数字 */}
                    <td style={{ padding: '8px' }}>{image.width && image.height ? `${image.width} x ${image.height}` : 'N/A'}</td>
                    <td style={{ padding: '8px' }}>{image.sync_timestamp ? new Date(image.sync_timestamp).toLocaleString() : 'N/A'}</td>
                    <td style={{ padding: '8px' }}>{image.id || image.photo_id}</td>
                    {/* 这里不再包含 <img> 标签 */}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </main>
  );
}
