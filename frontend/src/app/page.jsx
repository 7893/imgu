// /home/admin/imgu/frontend/src/app/page.jsx (Updated with Button)
"use client";

import React, { useState, useEffect } from 'react';

export default function HomePage() {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState(''); // 用于显示同步按钮状态
  const [isSyncing, setIsSyncing] = useState(false); // 用于禁用按钮

  const apiUrl = process.env.NEXT_PUBLIC_API_URL; // API Lambda URL (获取图片列表)
  const startSyncUrl = `${apiUrl}/start-sync`;     // 启动同步的 URL

  // --- 获取图片列表的 Effect ---
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
        const response = await fetch(apiUrl); // GET /
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        if (data && data.length > 0) console.log('First image data sample:', data[0]);
        console.log("Data fetched successfully:", data);
        setImages(data);
      } catch (e) {
        console.error("Failed to fetch images:", e);
        if (e instanceof TypeError && e.message === 'Failed to fetch') {
             setError(`Network error: Failed to fetch image list from API.`);
        } else {
             setError(`Failed to load images: ${e.message}`);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchImageData();
  }, [apiUrl]);

  // --- 点击按钮启动同步的函数 ---
  const handleStartSync = async () => {
      if (!startSyncUrl || !apiUrl) {
          setSyncStatus('Error: API URL not configured properly.');
          return;
      }
      setSyncStatus('Initiating sync process...');
      setIsSyncing(true); // 禁用按钮

      try {
          const response = await fetch(startSyncUrl, {
              method: 'POST',
              // 可以根据需要添加 headers 或 body
              // headers: { 'Content-Type': 'application/json' },
              // body: JSON.stringify({ some: 'data' })
          });

          const result = await response.json(); // 读取响应体

          if (!response.ok) {
              // 如果 API 返回错误 (例如 500)
              throw new Error(result.message || `Failed to start sync (${response.status})`);
          }

          // API 返回成功 (例如 202 Accepted)
          setSyncStatus(`Sync process initiated successfully! Execution ARN: ${result.executionArn || 'N/A'}`);
          // 注意：这里只是启动了任务，任务本身在后台运行
          // 可以考虑一段时间后解除按钮禁用，或者实现状态轮询来更新状态

      } catch (error) {
          console.error('Error starting sync:', error);
          setSyncStatus(`Error starting sync: ${error.message}`);
          setIsSyncing(false); // 出错时解除禁用
      }
      // 可以在这里设置一个定时器，几秒后清除状态信息和解除禁用
      // setTimeout(() => {
      //     setSyncStatus('');
      //     setIsSyncing(false);
      // }, 10000); // 10秒后清除
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

      {/* --- 图片展示 --- */}
      {loading && <p>Loading image gallery...</p>}
      {error && <p style={{ color: 'red' }}>Error loading gallery: {error}</p>}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
          {images.length === 0 ? (
            <p>No images found. Try starting the sync?</p>
          ) : (
            images.map((image) => (
              <div key={image.photo_id} style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', padding: '8px' }}>
                <img
                  src={image.r2_public_url}
                  alt={image.alt_description || `Photo ${image.photo_id}`}
                  style={{ width: '100%', height: '200px', objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <p style={{ fontSize: '0.8em', marginTop: '8px', textAlign: 'center' }}>
                  Photo by: {image.user?.name || 'Unknown'}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
