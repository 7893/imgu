// /home/admin/imgu/frontend/src/app/page.jsx (Added Category column and File ID link)
"use client";

import React, { useState, useEffect, useCallback } from 'react';

function formatBytes(bytes, decimals = 2) {
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncExecutionArn, setSyncExecutionArn] = useState(null);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const baseApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : null;
  const startSyncUrl = baseApiUrl ? `${baseApiUrl}/start-sync` : null;
  const stopSyncUrl = baseApiUrl ? `${baseApiUrl}/stop-sync` : null;
  // const statusSyncUrl = baseApiUrl ? `${baseApiUrl}/sync-status` : null;

  const fetchImageData = useCallback(async (token = null) => {
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
    // TODO: Implement initial status check
  }, [fetchImageData]);

  const handleLoadMore = () => {
      if (nextToken && !loadingMore) fetchImageData(nextToken);
  };

  const handleStartSync = async () => {
      if (!startSyncUrl) { setSyncStatus('错误：API URL 未正确配置。'); return; }
      setSyncStatus('正在启动同步任务...');
      setIsSyncing(true);
      setSyncExecutionArn(null);
      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json();
          if (!response.ok || response.status !== 202) { throw new Error(result.message || `启动同步失败 (${response.status})`); }
          setSyncStatus(`同步任务已成功启动！请稍后刷新查看或前往 Step Functions 控制台监控进度。`); // 移除 ARN 显示
          setSyncExecutionArn(result.executionArn);
          console.log("Started Execution ARN:", result.executionArn);
      } catch (error) {
          console.error('启动同步时出错:', error);
          setSyncStatus(`启动同步出错: ${error.message}`);
          setIsSyncing(false);
      }
  };

  const handleStopSync = async () => {
      if (!stopSyncUrl) { setSyncStatus('错误：停止 API URL 未配置。'); return; }
      if (!syncExecutionArn) { setSyncStatus('错误：没有找到当前运行的任务 ARN。'); return; }
      setSyncStatus(`正在发送停止请求...`);
      try {
          const response = await fetch(stopSyncUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ executionArn: syncExecutionArn })
          });
          const result = await response.json();
          if (!response.ok) { throw new Error(result.message || `停止同步失败 (${response.status})`); }
          setSyncStatus(`同步任务停止请求已发送。`);
          setIsSyncing(false);
          setSyncExecutionArn(null);
      } catch (error) {
          console.error('停止同步时出错:', error);
          setSyncStatus(`停止同步出错: ${error.message}`);
      }
  };

  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={handleStartSync} disabled={isSyncing}>
              开始同步最老照片
          </button>
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
                  {/* --- 更新后的列标题和顺序 --- */}
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
                    {/* --- 更新后的列内容和顺序 --- */}
                    <td>
                      {/* 文件 ID 添加链接 */}
                      <a href={image.r2_public_url} target="_blank" rel="noopener noreferrer" title={`查看 ${image.r2_object_key || '图片'}`}>
                        {image.id || image.photo_id}
                      </a>
                    </td>
                    <td>{image.image_category || 'N/A'}</td> {/* 加回分类列 */}
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
