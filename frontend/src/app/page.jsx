// /home/admin/imgu/frontend/src/app/page.jsx (Chinese UI, Updated Columns)
"use client";

import React, { useState, useEffect, useCallback } from 'react';

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
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

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const startSyncUrl = apiUrl ? `${apiUrl.replace(/\/$/, '')}/start-sync` : null;

  const fetchImageData = useCallback(async (token = null) => {
    if (!apiUrl) {
      setError("API URL 配置缺失。请设置 NEXT_PUBLIC_API_URL 环境变量。");
      setLoadingInitial(false);
      return;
    }
    console.log(`正在从 API 获取数据: ${token ? '下一页' : '初始页'}`);
    if (!token) {
      setLoadingInitial(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    const urlToFetch = token ? `${apiUrl}?nextToken=${encodeURIComponent(token)}` : apiUrl;

    try {
      const response = await fetch(urlToFetch);
      if (!response.ok) {
        let errorMsg = `HTTP 错误！状态码: ${response.status}`;
        try { const errorData = await response.json(); errorMsg += `, 信息: ${errorData.message || '无详情'}`; } catch (e) {}
        throw new Error(errorMsg);
      }
      const data = await response.json();
      console.log("成功获取数据:", data.items?.length || 0, "条。下一页令牌:", data.nextToken);
      if (data && data.items) {
        setImages(prevImages => token ? [...prevImages, ...data.items] : data.items);
        setNextToken(data.nextToken);
      } else {
        throw new Error("从 API 收到无效的数据格式。");
      }
    } catch (e) {
      console.error("获取图片列表失败:", e);
       if (e instanceof TypeError && e.message.includes('fetch')) {
           setError(`网络错误：无法从 API 获取图片列表。请检查网络或 CORS 设置。`);
      } else {
           setError(`加载图片列表出错: ${e.message}`);
      }
    } finally {
      if (!token) setLoadingInitial(false);
      setLoadingMore(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchImageData();
  }, [fetchImageData]);

  const handleLoadMore = () => {
    if (nextToken && !loadingMore) {
      fetchImageData(nextToken);
    }
  };

  const handleStartSync = async () => {
      if (!startSyncUrl) {
          setSyncStatus('错误：API URL 未正确配置。');
          return;
      }
      setSyncStatus('正在启动同步任务...');
      setIsSyncing(true);
      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json();
          if (!response.ok || response.status !== 202) {
              throw new Error(result.message || `启动同步失败 (${response.status})`);
          }
          setSyncStatus(`同步任务已成功启动！执行 ARN: ${result.executionArn || 'N/A'}`);
          // 考虑一段时间后清除状态，或实现状态轮询
          // setTimeout(() => { setSyncStatus(''); setIsSyncing(false); }, 15000); // 15秒后清除
      } catch (error) {
          console.error('启动同步时出错:', error);
          setSyncStatus(`启动同步出错: ${error.message}`);
          setIsSyncing(false);
      }
  };

  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee' }}>
          <button onClick={handleStartSync} disabled={isSyncing}>
              开始同步最老照片 (每批30张, 间隔2分钟)
          </button>
          {/* 可以在这里添加停止按钮 (需要后端 API 支持) */}
          {syncStatus && <p style={{ marginTop: '10px', color: syncStatus.startsWith('错误') ? 'red' : 'green' }}>{syncStatus}</p>}
      </div>

      <h2>已同步图片元数据</h2>
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>加载元数据出错: {error}</p>}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? (
            <p>未找到图片元数据。尝试启动同步？</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '15px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ddd' }}>
                  {/* --- 更新列标题和顺序 --- */}
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>文件 ID (Unsplash)</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>文件大小</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>分辨率</th>
                  <th style={{ textAlign: 'left', padding: '8px 10px' }}>同步时间</th>
                  {/* 移除了 Category 和 R2 Key */}
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr key={image.photo_id} style={{ borderBottom: '1px solid #eee' }}>
                    {/* --- 更新列内容和顺序 --- */}
                    <td style={{ padding: '8px 10px' }}>{image.id || image.photo_id}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {typeof image.r2_object_size_bytes === 'number' ? formatBytes(image.r2_object_size_bytes) : 'N/A'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{image.width && image.height ? `${image.width} x ${image.height}` : 'N/A'}</td>
                    <td style={{ padding: '8px 10px' }}>{image.sync_timestamp ? new Date(image.sync_timestamp).toLocaleString('zh-CN') : 'N/A'}</td>
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
