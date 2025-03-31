// /home/admin/imgu/frontend/src/app/page.jsx (Updated to fetch and display summary info)
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';

// 状态常量
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING';
const STATUS_UNKNOWN = 'UNKNOWN';

// formatBytes 函数
function formatBytes(bytes, decimals = 2) {
  if (!+bytes && bytes !== 0) return 'N/A';
  const absBytes = Math.abs(bytes);
  if (absBytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
  const i = Math.floor(Math.log(absBytes) / Math.log(k));
  if (i < 0 || i >= sizes.length) { return `${bytes} Bytes`; }
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// formatDate 辅助函数
const formatDate = (isoString) => {
    if (!isoString) return 'N/A';
    try {
        // 使用更完整的选项，并指定时区（如果需要本地化显示）
        return new Date(isoString).toLocaleString('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: false // 使用 24 小时制
            // timeZone: 'Asia/Seoul' // 如果需要显示特定时区时间
        });
    } catch {
        return 'Invalid Date';
    }
};

export default function HomePage() {
  // --- 现有状态 ---
  const [images, setImages] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [nextToken, setNextToken] = useState(null);
  const [syncStatusFromServer, setSyncStatusFromServer] = useState(STATUS_IDLE);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [syncStatusMessage, setSyncStatusMessage] = useState('');
  const [syncExecutionArn, setSyncExecutionArn] = useState(null);
  const pollingIntervalRef = useRef(null);

  // --- 新增：概要信息状态 ---
  const [summaryData, setSummaryData] = useState(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState(null);
  // --- 结束新增状态 ---

  // --- API URLs ---
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const baseApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : null;
  const startSyncUrl = baseApiUrl ? `${baseApiUrl}/start-sync` : null;
  const stopSyncUrl = baseApiUrl ? `${baseApiUrl}/stop-sync` : null;
  const statusSyncUrl = baseApiUrl ? `${baseApiUrl}/sync-status` : null;
  const summaryApiUrl = baseApiUrl ? `${baseApiUrl}/summary` : null; // 新增
  // --- 结束 API URLs ---

  // fetchImageData
  const fetchImageData = useCallback(async (token = null) => {
      // ... (代码保持不变，使用 formatDate) ...
       if (!apiUrl) { setError("API URL 配置缺失。"); setLoadingInitial(false); return; }
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

  // fetchSyncStatus
  const fetchSyncStatus = useCallback(async () => {
      // ... (代码保持不变) ...
       if (!statusSyncUrl) { setSyncStatusMessage("错误：状态 API URL 未配置。"); setIsLoadingStatus(false); setSyncStatusFromServer(STATUS_UNKNOWN); return; }
       setIsLoadingStatus(true); console.log("Fetching sync status...");
       try {
           const response = await fetch(statusSyncUrl); const data = await response.json();
           if (!response.ok) { throw new Error(data.message || `获取状态失败 (${response.status})`); }
           console.log("Sync status received:", data); setSyncStatusFromServer(data.status || STATUS_UNKNOWN); setSyncExecutionArn(data.executionArn || null);
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
       } catch (error) { console.error('获取同步状态时出错:', error); setSyncStatusMessage(`获取状态出错: ${error.message}`); setSyncStatusFromServer(STATUS_UNKNOWN); setSyncExecutionArn(null); }
        finally { setIsLoadingStatus(false); }
  }, [statusSyncUrl]);

  // --- 新增：获取概要信息的函数 ---
  const fetchSummaryData = useCallback(async () => {
    if (!summaryApiUrl) { setSummaryError("概要 API URL 未配置。"); setIsLoadingSummary(false); return; }
    setIsLoadingSummary(true); setSummaryError(null); console.log("Fetching summary data...");
    try {
      const response = await fetch(summaryApiUrl); const data = await response.json();
      if (!response.ok) { throw new Error(data.message || `获取概要信息失败 (${response.status})`); }
      console.log("Summary data received:", data); setSummaryData(data);
    } catch (error) { console.error('获取概要信息时出错:', error); setSummaryError(`加载概要信息出错: ${error.message}`); setSummaryData(null); }
     finally { setIsLoadingSummary(false); }
  }, [summaryApiUrl]);
  // --- 结束新增 ---

  // useEffect: 添加 fetchSummaryData 调用
  useEffect(() => {
    fetchImageData();
    fetchSyncStatus();
    fetchSummaryData(); // <--- 添加调用
  }, [fetchImageData, fetchSyncStatus, fetchSummaryData]); // <--- 添加依赖

  // handleLoadMore (保持不变)
  const handleLoadMore = () => { if (nextToken && !loadingMore) fetchImageData(nextToken); };
  // handleStartSync (可以添加成功后刷新 summary)
  const handleStartSync = async () => {
       // ... (之前的逻辑) ...
       try {
            // ... (fetch startSyncUrl) ...
            await fetchSyncStatus();
            await fetchSummaryData(); // <--- 启动后刷新概要
       } catch (error) { /* ... */ }
       finally { setIsLoadingStatus(false); }
  };
  // handleStopSync (可以添加成功后刷新 summary)
  const handleStopSync = async () => {
        // ... (之前的逻辑) ...
        try {
            // ... (fetch stopSyncUrl) ...
            await fetchSyncStatus();
            await fetchSummaryData(); // <--- 停止后刷新概要
        } catch (error) { /* ... */ }
        finally { setIsLoadingStatus(false); }
  };

  // 按钮禁用逻辑 (保持不变)
  const canStartSync = !isLoadingStatus && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING;
  const canStopSync = !isLoadingStatus && (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING);

  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      {/* --- 同步控制区域 (保持不变) --- */}
      <div style={{ margin: '20px 0', padding: '10px', border: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={handleStartSync} disabled={!canStartSync}>
              {isLoadingStatus && !canStartSync ? '检查状态...' : '开始同步'}
          </button>
          {(syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) && (
              <button onClick={handleStopSync} disabled={!canStopSync}>
                  {isLoadingStatus ? '请稍候...' : '停止同步'}
              </button>
          )}
          {syncStatusMessage && <p style={{ margin: '0', color: syncStatusMessage.includes('错误') || syncStatusFromServer === STATUS_FAILED || syncStatusFromServer === STATUS_TIMED_OUT ? 'red' : 'inherit' }}>{syncStatusMessage}</p>}
           {isLoadingStatus && <span style={{marginLeft: 'auto'}}>(状态加载中...)</span>}
      </div>

      {/* --- 新增：概要信息区域 --- */}
      <div className="summary-info" style={{ margin: '20px 0', padding: '15px', border: '1px solid #eee', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
        <h2>系统概要</h2>
        {isLoadingSummary && <p>加载概要信息...</p>}
        {summaryError && <p style={{ color: 'red' }}>{summaryError}</p>}
        {!isLoadingSummary && !summaryError && summaryData && (
          // 使用 CSS Grid 来更好地布局，允许自适应换行
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 20px', fontSize: '0.9em' }}>
            <div><strong>当前同步状态:</strong> {summaryData.currentSyncStatus ?? 'N/A'}</div>
            {/* 只在运行时显示当前页码 */}
            {summaryData.currentSyncPage && <div><strong>当前处理页:</strong> {summaryData.currentSyncPage}</div>}
            <div><strong>图片总数 (估):</strong> {summaryData.overallStats?.approxFileCount?.toLocaleString('zh-CN') ?? 'N/A'}</div>
            <div><strong>总存储大小 (估):</strong> {summaryData.overallStats?.approxTotalSizeFormatted ?? 'N/A'}</div>
            <div><strong>上次同步结束:</strong> {formatDate(summaryData.lastRun?.endTime)}</div>
            <div><strong>上次同步状态:</strong> {summaryData.lastRun?.status ?? 'N/A'}</div>
            {/* 只在上次失败时显示错误信息 */}
            {summaryData.lastRun?.status === STATUS_FAILED && summaryData.lastRun.errorInfo &&
                <div style={{ color: 'orange', gridColumn: '1 / -1' }}> {/* 跨列显示 */}
                    <strong>上次失败原因:</strong> {summaryData.lastRun.errorInfo}
                </div>
            }
            <div><strong>API 剩余/限制:</strong> {summaryData.apiLimits?.remaining ?? 'N/A'} / {summaryData.apiLimits?.limit ?? 'N/A'}</div>
            <div><strong>API 下次重置 (估):</strong> {formatDate(summaryData.apiLimits?.estimatedReset)}</div>
            {/* <div><strong>API 限制上次检查:</strong> {formatDate(summaryData.apiLimits?.lastChecked)}</div> */}
          </div>
        )}
        {/* 如果加载完成但没有数据 */}
        {!isLoadingSummary && !summaryError && !summaryData && <p>未能加载概要信息。</p>}
      </div>
      {/* --- 结束概要信息区域 --- */}

      <h2>已同步图片元数据</h2>
      {/* --- 图片列表表格 (保持不变，但使用了 formatDate) --- */}
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
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
                    <td>{formatDate(image.sync_timestamp)}</td> {/* 使用统一 formatDate */}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* --- 加载更多按钮 (保持不变) --- */}
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
