// /home/admin/imgu/frontend/src/app/page.jsx (Added Stop Button Logic)
"use client";

import React, { useState, useEffect, useCallback } from 'react';

function formatBytes(bytes, decimals = 2) {
  // ... (formatBytes function remains the same as previous version) ...
  if (!+bytes && bytes !== 0) return 'N/A';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) { return `${bytes} Bytes`; }
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function HomePage() {
  const [images, setImages] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [nextToken, setNextToken] = useState(null);
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false); // Now represents if a sync *might* be running
  const [syncExecutionArn, setSyncExecutionArn] = useState(null); // Store ARN for stopping

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const baseApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : null; // Ensure no trailing slash
  const startSyncUrl = baseApiUrl ? `${baseApiUrl}/start-sync` : null;
  const stopSyncUrl = baseApiUrl ? `${baseApiUrl}/stop-sync` : null;
  // const statusSyncUrl = baseApiUrl ? `${baseApiUrl}/sync-status` : null; // For future status check

  // --- 获取图片列表的 Effect ---
  const fetchImageData = useCallback(async (token = null) => {
    // ... (fetchImageData function remains the same as previous version) ...
     if (!apiUrl) {
      setError("API URL 配置缺失。"); setLoadingInitial(false); return;
    }
    console.log(`正在从 API 获取数据: ${token ? '下一页' : '初始页'}`);
    if (!token) setLoadingInitial(true); else setLoadingMore(true);
    setError(null);
    const urlToFetch = token ? `${apiUrl}?nextToken=${encodeURIComponent(token)}` : apiUrl;
    try {
      const response = await fetch(urlToFetch);
      if (!response.ok) throw new Error(`HTTP 错误！状态码: ${response.status}`);
      const data = await response.json();
      console.log("成功获取数据:", data.items?.length || 0, "条。下一页令牌:", data.nextToken);
      if (data && data.items) {
        setImages(prevImages => token ? [...prevImages, ...data.items] : data.items);
        setNextToken(data.nextToken);
      } else {
         if (!token) setImages([]);
         setNextToken(null);
         console.warn("API 返回的数据格式不符合预期或 items 为空。");
      }
    } catch (e) {
      console.error("获取图片列表失败:", e);
       if (e instanceof TypeError && e.message.includes('fetch')) { setError(`网络错误：无法从 API 获取图片列表。`); }
       else { setError(`加载图片列表出错: ${e.message}`); }
    } finally {
      if (!token) setLoadingInitial(false); setLoadingMore(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchImageData();
    // TODO: Implement initial status check here later using statusSyncUrl
    // to set isSyncing and syncExecutionArn correctly on page load/refresh
  }, [fetchImageData]); // Run once on load

  const handleLoadMore = () => { /* ... (unchanged) ... */
      if (nextToken && !loadingMore) fetchImageData(nextToken);
  };

  // --- 启动同步 ---
  const handleStartSync = async () => {
      if (!startSyncUrl) { setSyncStatus('错误：API URL 未正确配置。'); return; }
      setSyncStatus('正在启动同步任务...');
      setIsSyncing(true); // Assume syncing starts, disable buttons
      setSyncExecutionArn(null); // Clear previous ARN
      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json();
          if (!response.ok || response.status !== 202) { throw new Error(result.message || `启动同步失败 (${response.status})`); }
          setSyncStatus(`同步任务已成功启动！`);
          setSyncExecutionArn(result.executionArn); // <-- Store the ARN
          console.log("Started Execution ARN:", result.executionArn);
          // Keep isSyncing true until status check confirms completion/failure/abort
      } catch (error) {
          console.error('启动同步时出错:', error);
          setSyncStatus(`启动同步出错: ${error.message}`);
          setIsSyncing(false); // Re-enable button on error
      }
  };

  // --- 停止同步 ---
  const handleStopSync = async () => {
      if (!stopSyncUrl) { setSyncStatus('错误：停止 API URL 未配置。'); return; }
      if (!syncExecutionArn) { setSyncStatus('错误：没有找到当前运行的任务 ARN。'); return; }

      setSyncStatus(`正在发送停止请求 (ARN: ${syncExecutionArn.split(':').pop()})...`);
      // Keep isSyncing true for now

      try {
          const response = await fetch(stopSyncUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ executionArn: syncExecutionArn }) // Send ARN in body
          });
          const result = await response.json();
          if (!response.ok) { throw new Error(result.message || `停止同步失败 (${response.status})`); }
          setSyncStatus(`同步任务停止请求已发送。请前往 Step Functions 控制台确认状态。`);
          // Successfully sent stop request, assume it will stop
          setIsSyncing(false);
          setSyncExecutionArn(null);
      } catch (error) {
          console.error('停止同步时出错:', error);
          setSyncStatus(`停止同步出错: ${error.message}`);
          // Keep isSyncing true maybe? Or allow retry? For now, just show error.
      }
  };

  // --- Render Logic ---
  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleStartSync} disabled={isSyncing}>
              开始同步最老照片
          </button>
          {/* --- 添加停止按钮，仅在 isSyncing 为 true 时显示 --- */}
          {isSyncing && (
              <button onClick={handleStopSync}>
                  停止同步
              </button>
          )}
          {syncStatus && <p style={{ margin: '0 0 0 10px', color: syncStatus.startsWith('错误') ? 'red' : 'green' }}>{syncStatus}</p>}
      </div>

      <h2>已同步图片元数据</h2>
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>加载元数据出错: {error}</p>}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? (
            <p>未找到图片元数据。请尝试启动同步，或稍后刷新。</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>文件 ID (Unsplash)</th>
                  <th>分类</th>
                  <th>文件大小</th>
                  <th>分辨率</th>
                  <th>同步时间</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr key={image.photo_id || image.id}>
                    <td>{image.id || image.photo_id}</td>
                    <td>{image.image_category || 'N/A'}</td>
                    <td>
                      {typeof image.r2_object_size_bytes === 'number' ? formatBytes(image.r2_object_size_bytes) : 'N/A'}
                    </td>
                    <td>{image.width && image.height ? `${image.width} x ${image.height}` : 'N/A'}</td>
                    <td>{image.sync_timestamp ? new Date(image.sync_timestamp).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {!loadingInitial && !error && nextToken && (
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? '正在加载...' : '加载更多'}
              </button>
          </div>
      )}
    </main>
  );
}
