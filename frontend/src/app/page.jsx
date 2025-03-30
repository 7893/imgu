// /home/admin/imgu/frontend/src/app/page.jsx (Reordered columns, added Category back)
"use client";

import React, { useState, useEffect, useCallback } from 'react';

// --- 格式化字节大小的辅助函数 ---
function formatBytes(bytes, decimals = 2) {
  if (!+bytes && bytes !== 0) return 'N/A'; // 处理 null, undefined, NaN 等
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  // 添加健壮性检查，防止 i 超出 sizes 数组范围
  if (i < 0 || i >= sizes.length) {
      // 对于非常小或非常大的数，可能直接显示 Bytes 或最高单位
      return `${bytes} Bytes`;
  }

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

  // --- 获取数据的函数 ---
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
         // 如果 items 不存在或不是数组，也可能是 API 异常或数据为空
         if (!token) setImages([]); // 初始加载为空
         setNextToken(null); // 确保 token 被清除
         console.warn("API 返回的数据格式不符合预期或 items 为空。");
         // 可以选择不设置错误，而是显示 "无数据"
         // throw new Error("从 API 收到无效的数据格式。");
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

  // --- 初始加载 Effect ---
  useEffect(() => {
    fetchImageData();
  }, [fetchImageData]);

  // --- 点击加载更多的处理函数 ---
  const handleLoadMore = () => {
    if (nextToken && !loadingMore) {
      fetchImageData(nextToken);
    }
  };

  // --- 点击启动同步的函数 ---
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
          setSyncStatus(`同步任务已成功启动！请稍后刷新查看或前往 Step Functions 控制台监控进度。执行 ARN: ${result.executionArn || 'N/A'}`);
      } catch (error) {
          console.error('启动同步时出错:', error);
          setSyncStatus(`启动同步出错: ${error.message}`);
          setIsSyncing(false);
      }
      // 这里暂时不自动解除禁用，用户可以手动刷新页面查看新数据或之后添加状态轮询
  };


  // --- Render Logic ---
  return (
    <main> {/* 移除之前的内联样式，让 globals.css 控制 */}
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      {/* --- 同步控制 --- */}
      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee' }}>
          <button onClick={handleStartSync} disabled={isSyncing}>
              开始同步最老照片 (每批30张, 间隔2分钟)
          </button>
          {syncStatus && <p style={{ marginTop: '10px', color: syncStatus.startsWith('错误') ? 'red' : 'green' }}>{syncStatus}</p>}
      </div>

      {/* --- 图片元数据展示 --- */}
      <h2>已同步图片元数据</h2>
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>加载元数据出错: {error}</p>}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? (
            <p>未找到图片元数据。请尝试启动同步，或稍后刷新。</p>
          ) : (
            <table> {/* 使用全局样式 */}
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
                  <tr key={image.photo_id || image.id}> {/* 使用 photo_id 或 id 作为 key */}
                    {/* --- 更新后的列内容和顺序 --- */}
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
      {/* --- 加载更多按钮 --- */}
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
