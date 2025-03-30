// /home/admin/imgu/frontend/src/app/page.jsx (Updated for Sync Status Check)
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';

// 和后端 api-lambda/index.mjs 中定义的状态常量保持一致
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING';
const STATUS_UNKNOWN = 'UNKNOWN';

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

  // --- 新的状态管理 ---
  const [syncStatusFromServer, setSyncStatusFromServer] = useState(STATUS_IDLE); // 从 API 获取的状态
  const [isLoadingStatus, setIsLoadingStatus] = useState(true); // 是否正在加载状态
  const [syncStatusMessage, setSyncStatusMessage] = useState(''); // 显示给用户的消息
  const [syncExecutionArn, setSyncExecutionArn] = useState(null); // 当前运行的 ARN (从 status API 获取)
  const pollingIntervalRef = useRef(null); // 用于存储轮询定时器 ID
  // --- 结束新的状态管理 ---

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const baseApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : null;
  const startSyncUrl = baseApiUrl ? `${baseApiUrl}/start-sync` : null;
  const stopSyncUrl = baseApiUrl ? `${baseApiUrl}/stop-sync` : null;
  // --- 新增 Status API URL ---
  const statusSyncUrl = baseApiUrl ? `${baseApiUrl}/sync-status` : null;
  // --- 结束新增 ---


  const fetchImageData = useCallback(async (token = null) => {
    // ... (此函数逻辑保持不变) ...
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

  // --- 新增：获取同步状态的函数 ---
  const fetchSyncStatus = useCallback(async () => {
    if (!statusSyncUrl) {
        setSyncStatusMessage("错误：状态 API URL 未配置。");
        setIsLoadingStatus(false);
        setSyncStatusFromServer(STATUS_UNKNOWN);
        return;
    }
    setIsLoadingStatus(true);
    console.log("Fetching sync status...");
    try {
        const response = await fetch(statusSyncUrl);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || `获取状态失败 (${response.status})`);
        }
        console.log("Sync status received:", data);
        setSyncStatusFromServer(data.status || STATUS_UNKNOWN);
        setSyncExecutionArn(data.executionArn || null); // 更新 ARN

        // 更新用户消息
        switch(data.status) {
            case STATUS_RUNNING: setSyncStatusMessage("同步任务正在运行中..."); break;
            case STATUS_STOPPING: setSyncStatusMessage("同步任务正在停止..."); break;
            case STATUS_SUCCEEDED: setSyncStatusMessage("上次同步成功完成。"); break;
            case STATUS_FAILED: setSyncStatusMessage("上次同步失败。"); break;
            case STATUS_TIMED_OUT: setSyncStatusMessage("上次同步超时。"); break;
            case STATUS_ABORTED: setSyncStatusMessage("上次同步被中止。"); break;
            case STATUS_IDLE: setSyncStatusMessage("同步任务已就绪。"); break;
            default: setSyncStatusMessage("未知同步状态。");
        }

    } catch (error) {
        console.error('获取同步状态时出错:', error);
        setSyncStatusMessage(`获取状态出错: ${error.message}`);
        setSyncStatusFromServer(STATUS_UNKNOWN);
        setSyncExecutionArn(null);
    } finally {
        setIsLoadingStatus(false);
    }
  }, [statusSyncUrl]);


  useEffect(() => {
    // 初始加载图片数据和同步状态
    fetchImageData();
    fetchSyncStatus();

    // --- 可选：设置轮询 ---
    /*
    const startPolling = () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current); // Clear existing interval
      pollingIntervalRef.current = setInterval(() => {
        // 只有在任务可能还在运行时才轮询
        if (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) {
          fetchSyncStatus();
        } else {
          stopPolling(); // 如果状态变为终态或 IDLE，停止轮询
        }
      }, 15000); // 每 15 秒轮询一次
    };

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("Polling stopped.");
      }
    };

    // 根据状态决定是否开始轮询
    if (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) {
      startPolling();
    } else {
      stopPolling();
    }

    // 组件卸载时清除定时器
    return () => stopPolling();
    */
   // --- 结束可选轮询 ---

  }, [fetchImageData, fetchSyncStatus, syncStatusFromServer]); // 添加 syncStatusFromServer 到依赖项以触发轮询逻辑更新

  const handleLoadMore = () => {
      if (nextToken && !loadingMore) fetchImageData(nextToken);
  };

  const handleStartSync = async () => {
      if (!startSyncUrl) { setSyncStatusMessage('错误：API URL 未正确配置。'); return; }
      // 再次检查状态，防止快速点击
      if (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) {
          setSyncStatusMessage("任务已在运行或正在停止。");
          return;
      }
      setSyncStatusMessage('正在启动同步任务...');
      setIsLoadingStatus(true); // 将 isLoadingStatus 用于指示操作进行中
      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json(); // result 包含 message, executionArn, status
          if (!response.ok || response.status !== 202) {
              throw new Error(result.message || `启动同步失败 (${response.status})`);
          }
          setSyncStatusMessage(result.message || `同步任务已成功启动！`); // 使用 API 返回的消息
          // API 成功后，立即调用 fetchSyncStatus 来获取最新状态和 ARN
          await fetchSyncStatus();
      } catch (error) {
          console.error('启动同步时出错:', error);
          setSyncStatusMessage(`启动同步出错: ${error.message}`);
          setIsLoadingStatus(false); // 出错时结束加载状态
          // 可以在出错后也获取一次状态
          // await fetchSyncStatus();
      }
  };

  const handleStopSync = async () => {
      if (!stopSyncUrl) { setSyncStatusMessage('错误：停止 API URL 未配置。'); return; }
      // 使用从状态 API 获取的 ARN
      if (!syncExecutionArn) {
          setSyncStatusMessage('错误：没有找到当前运行的任务 ARN 来停止。');
          // 可以尝试再获取一次状态
          await fetchSyncStatus();
          return;
      }
      setSyncStatusMessage(`正在发送停止请求...`);
      setIsLoadingStatus(true);
      try {
          const response = await fetch(stopSyncUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // 请求体中仍然可以发送 ARN，虽然 API 可能会从 DB 获取
              body: JSON.stringify({ executionArn: syncExecutionArn })
          });
          const result = await response.json(); // result 包含 message, status
          if (!response.ok) {
              throw new Error(result.message || `停止同步失败 (${response.status})`);
          }
          setSyncStatusMessage(result.message || `同步任务停止请求已发送。`);
          // 立即调用 fetchSyncStatus 更新状态
           await fetchSyncStatus();
      } catch (error) {
          console.error('停止同步时出错:', error);
          setSyncStatusMessage(`停止同步出错: ${error.message}`);
          setIsLoadingStatus(false);
          // 可以在出错后也获取一次状态
          // await fetchSyncStatus();
      }
  };

  // --- 更新按钮禁用逻辑 ---
  const canStartSync = !isLoadingStatus && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING;
  const canStopSync = !isLoadingStatus && (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING);
  // --- 结束按钮禁用逻辑 ---


  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* 使用新的禁用逻辑 */}
          <button onClick={handleStartSync} disabled={!canStartSync}>
              {isLoadingStatus && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING ? '检查状态...' : '开始同步'}
          </button>
          {/* 根据状态决定是否显示停止按钮 */}
          {(syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) && (
              <button onClick={handleStopSync} disabled={!canStopSync}>
                  {isLoadingStatus ? '请稍候...' : '停止同步'}
              </button>
          )}
          {/* 显示状态消息 */}
          {syncStatusMessage && <p style={{ margin: '0 0 0 10px', color: syncStatusMessage.includes('错误') || syncStatusFromServer === STATUS_FAILED || syncStatusFromServer === STATUS_TIMED_OUT ? 'red' : 'inherit' }}>{syncStatusMessage}</p>}
           {isLoadingStatus && <span style={{marginLeft: '10px'}}>(加载状态中...)</span>}
      </div>

      <h2>已同步图片元数据</h2>
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>加载元数据出错: {error}</p>}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? (
            <p>未找到图片元数据。请尝试启动同步，或检查同步状态。</p>
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
                    <td>
                      <a href={image.r2_public_url || '#'} target="_blank" rel="noopener noreferrer" title={`查看 ${image.r2_object_key || '图片'}`}>
                        {image.id || image.photo_id || 'N/A'}
                      </a>
                    </td>
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
