// /home/admin/imgu/frontend/src/app/page.jsx (Updated with Pagination)
"use client";

import React, { useState, useEffect, useCallback } from 'react';

// --- 格式化字节大小的辅助函数 ---
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function HomePage() {
  // --- State Variables ---
  const [images, setImages] = useState([]); // 存储所有已加载的图片
  const [loadingInitial, setLoadingInitial] = useState(true); // 仅用于初始加载
  const [loadingMore, setLoadingMore] = useState(false); // 用于加载更多时的状态
  const [error, setError] = useState(null);
  const [nextToken, setNextToken] = useState(null); // 存储下一页的令牌
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const startSyncUrl = apiUrl ? `${apiUrl.replace(/\/$/, '')}/start-sync` : null;

  // --- 获取数据的函数 (现在可以被多次调用) ---
  // useCallback 避免在每次渲染时重新创建函数
  const fetchImageData = useCallback(async (token = null) => {
    if (!apiUrl) {
      setError("API URL configuration missing.");
      setLoadingInitial(false); // 初始加载结束
      return;
    }

    // 根据是否有 token 判断是初始加载还是加载更多
    if (!token) {
      setLoadingInitial(true); // 开始初始加载
    } else {
      setLoadingMore(true); // 开始加载更多
    }
    setError(null);

    // 构建带 token 的 URL (如果 token 存在)
    const urlToFetch = token ? `${apiUrl}?nextToken=${encodeURIComponent(token)}` : apiUrl;
    console.log(`Workspaceing data from: ${urlToFetch}`);

    try {
      const response = await fetch(urlToFetch); // GET 请求
      if (!response.ok) {
        let errorMsg = `HTTP error fetching image list! status: ${response.status}`;
        try { const errorData = await response.json(); errorMsg += `, message: ${errorData.message || 'No details'}`; } catch (e) {}
        throw new Error(errorMsg);
      }

      const data = await response.json(); // 期望格式 { items: [...], nextToken: '...' | null }
      console.log("Data page fetched successfully:", data.items?.length || 0, "items. Next token:", data.nextToken);

      if (data && data.items) {
        // 如果是初始加载，直接设置；如果是加载更多，则追加
        setImages(prevImages => token ? [...prevImages, ...data.items] : data.items);
        setNextToken(data.nextToken); // 更新下一页的令牌
      } else {
        // API 返回格式不正确或 items 丢失
        throw new Error("Invalid data format received from API.");
      }

    } catch (e) {
      console.error("Failed to fetch images:", e);
       if (e instanceof TypeError && e.message.includes('fetch')) {
             setError(`Network error: Failed to fetch image list from API. Check network or CORS.`);
        } else {
             setError(`Failed to load images: ${e.message}`);
        }
    } finally {
      // 结束加载状态
      if (!token) setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, [apiUrl]); // 依赖 apiUrl

  // --- 初始加载 Effect ---
  useEffect(() => {
    fetchImageData(); // 首次加载时不传递 token
  }, [fetchImageData]); // 当 fetchImageData 函数变化时 (主要是 apiUrl 变化时)

  // --- 点击加载更多的处理函数 ---
  const handleLoadMore = () => {
    if (nextToken && !loadingMore) {
      fetchImageData(nextToken); // 传递当前存储的 token
    }
  };

  // --- 点击启动同步的函数 ---
  const handleStartSync = async () => {
    // ... (这部分逻辑不变) ...
    if (!startSyncUrl) {
        setSyncStatus('Error: API URL not configured properly.');
        return;
    }
    setSyncStatus('Initiating sync process...');
    setIsSyncing(true);
    try {
        const response = await fetch(startSyncUrl, { method: 'POST' });
        const result = await response.json();
        if (!response.ok || response.status !== 202) {
            throw new Error(result.message || `Failed to start sync (${response.status})`);
        }
        setSyncStatus(`Sync process initiated successfully! Execution ARN: ${result.executionArn || 'N/A'}`);
    } catch (error) {
        console.error('Error starting sync:', error);
        setSyncStatus(`Error starting sync: ${error.message}`);
        setIsSyncing(false);
    }
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
      {/* 初始加载状态 */}
      {loadingInitial && <p>Loading initial metadata...</p>}
      {/* 加载错误 */}
      {error && <p style={{ color: 'red' }}>Error loading metadata: {error}</p>}
      {/* 表格数据 */}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? (
            <p>No image metadata found. Try starting the sync?</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid black' }}>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Category</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>R2 Object Key</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Dimensions</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>File Size</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Sync Timestamp</th>
                  <th style={{ textAlign: 'left', padding: '8px' }}>Unsplash ID</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr key={image.photo_id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '8px' }}>{image.image_category || 'N/A'}</td>
                    <td style={{ padding: '8px', wordBreak: 'break-all' }}>{image.r2_object_key || 'N/A'}</td>
                    <td style={{ padding: '8px' }}>{image.width && image.height ? `${image.width} x ${image.height}` : 'N/A'}</td>
                    <td style={{ padding: '8px' }}>
                      {typeof image.r2_object_size_bytes === 'number' ? formatBytes(image.r2_object_size_bytes) : 'N/A'}
                    </td>
                    <td style={{ padding: '8px' }}>{image.sync_timestamp ? new Date(image.sync_timestamp).toLocaleString() : 'N/A'}</td>
                    <td style={{ padding: '8px' }}>{image.id || image.photo_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* --- 加载更多按钮 --- */}
      {!loadingInitial && !error && nextToken && ( // 只有在非初始加载、无错误且有下一页令牌时显示
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading...' : 'Load More'}
              </button>
          </div>
      )}
    </main>
  );
}
