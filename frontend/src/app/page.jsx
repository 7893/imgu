// /home/admin/imgu/frontend/src/app/page.jsx (Updated to display summary info)
"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';

// 状态常量 (保持与后端一致)
const STATUS_IDLE = 'IDLE';
const STATUS_RUNNING = 'RUNNING';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_FAILED = 'FAILED';
const STATUS_TIMED_OUT = 'TIMED_OUT';
const STATUS_ABORTED = 'ABORTED';
const STATUS_STOPPING = 'STOPPING';
const STATUS_UNKNOWN = 'UNKNOWN';

// formatBytes 函数 (保持不变)
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

export default function HomePage() {
  // --- 现有状态 ---
  const [images, setImages] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true); // 图片列表加载状态
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null); // 图片列表加载错误
  const [nextToken, setNextToken] = useState(null);
  const [syncStatusFromServer, setSyncStatusFromServer] = useState(STATUS_IDLE);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true); // 同步状态加载状态
  const [syncStatusMessage, setSyncStatusMessage] = useState('');
  const [syncExecutionArn, setSyncExecutionArn] = useState(null);
  const pollingIntervalRef = useRef(null);

  // --- 新增状态：用于存储和加载概要信息 ---
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
  // 新增 Summary API URL
  const summaryApiUrl = baseApiUrl ? `${baseApiUrl}/summary` : null;
  // --- 结束 API URLs ---

  // fetchImageData (保持不变)
  const fetchImageData = useCallback(async (token = null) => { /* ... */ }, [apiUrl]);

  // fetchSyncStatus (保持不变)
  const fetchSyncStatus = useCallback(async () => { /* ... */ }, [statusSyncUrl]);

  // --- 新增：获取概要信息的函数 ---
  const fetchSummaryData = useCallback(async () => {
    if (!summaryApiUrl) {
      setSummaryError("概要 API URL 未配置。");
      setIsLoadingSummary(false);
      return;
    }
    setIsLoadingSummary(true);
    setSummaryError(null);
    console.log("Fetching summary data...");
    try {
      const response = await fetch(summaryApiUrl);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `获取概要信息失败 (${response.status})`);
      }
      console.log("Summary data received:", data);
      setSummaryData(data);
    } catch (error) {
      console.error('获取概要信息时出错:', error);
      setSummaryError(`加载概要信息出错: ${error.message}`);
      setSummaryData(null); // 出错时清空数据
    } finally {
      setIsLoadingSummary(false);
    }
  }, [summaryApiUrl]);
  // --- 结束新增 ---

  // useEffect: 添加 fetchSummaryData 调用
  useEffect(() => {
    fetchImageData();
    fetchSyncStatus();
    fetchSummaryData(); // <--- 添加调用

    // 清理函数保持不变 (如果之前添加了轮询逻辑，请确保它仍然有效或按需调整)
    // return () => { /* ... 清理逻辑 ... */ };

  // 添加 fetchSummaryData 到依赖数组
  }, [fetchImageData, fetchSyncStatus, fetchSummaryData]);

  // handleLoadMore (保持不变)
  const handleLoadMore = () => { /* ... */ };
  // handleStartSync (在成功后可以考虑调用 fetchSummaryData 刷新统计)
  const handleStartSync = async () => {
      if (!startSyncUrl) { setSyncStatusMessage('错误：API URL 未正确配置。'); return; }
      if (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) { setSyncStatusMessage("任务已在运行或正在停止。"); return; }
      setSyncStatusMessage('正在启动同步任务...');
      setIsLoadingStatus(true);
      try {
          const response = await fetch(startSyncUrl, { method: 'POST' });
          const result = await response.json();
          if (!response.ok || response.status !== 202) { throw new Error(result.message || `启动同步失败 (${response.status})`); }
          setSyncStatusMessage(result.message || `同步任务已成功启动！`);
          await fetchSyncStatus(); // 获取最新状态
          // 可以在状态更新后也刷新一下概要信息
          // await fetchSummaryData();
      } catch (error) { /* ... */ }
       finally { setIsLoadingStatus(false); } // 确保加载状态解除
  };
   // handleStopSync (在成功后可以考虑调用 fetchSummaryData 刷新统计)
  const handleStopSync = async () => {
       if (!stopSyncUrl) { /* ... */ return; }
       if (!syncExecutionArn && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING) {
           setSyncStatusMessage('错误：没有找到当前运行的任务 ARN 来停止。');
           await fetchSyncStatus(); // 尝试获取最新状态
           return;
       }
       // 如果没有 syncExecutionArn 但状态是 RUNNING/STOPPING，尝试从 summaryData 获取？
       // 简单起见，暂时依赖 fetchSyncStatus 更新 syncExecutionArn
       const arnToStop = syncExecutionArn;
       if (!arnToStop) {
           setSyncStatusMessage('无法获取执行 ARN，请稍后重试或刷新页面。');
           return;
       }

       setSyncStatusMessage(`正在发送停止请求...`);
       setIsLoadingStatus(true);
       try {
           const response = await fetch(stopSyncUrl, {
               method: 'POST', headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ executionArn: arnToStop }) // 使用状态中的 ARN
           });
           const result = await response.json();
           if (!response.ok) { throw new Error(result.message || `停止同步失败 (${response.status})`); }
           setSyncStatusMessage(result.message || `同步任务停止请求已发送。`);
           await fetchSyncStatus(); // 获取最新状态
           // 可以在状态更新后也刷新一下概要信息
           // await fetchSummaryData();
       } catch (error) { /* ... */ }
        finally { setIsLoadingStatus(false); } // 确保加载状态解除
  };

  // 按钮禁用逻辑 (保持不变)
  const canStartSync = !isLoadingStatus && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING;
  const canStopSync = !isLoadingStatus && (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING);

  // Helper function to format dates or return 'N/A'
  const formatDate = (isoString) => {
      if (!isoString) return 'N/A';
      try {
          return new Date(isoString).toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false });
      } catch {
          return 'Invalid Date';
      }
  };

  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      {/* --- 同步控制区域 --- */}
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
      {/* --- 结束同步控制区域 --- */}


      {/* --- 新增：概要信息区域 --- */}
      <div className="summary-info" style={{ margin: '20px 0', padding: '15px', border: '1px solid #eee', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
        <h2>系统概要</h2>
        {isLoadingSummary && <p>加载概要信息...</p>}
        {summaryError && <p style={{ color: 'red' }}>{summaryError}</p>}
        {!isLoadingSummary && !summaryError && summaryData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px' }}>
            <div><strong>当前同步状态:</strong> {summaryData.currentSyncStatus ?? 'N/A'}</div>
            {summaryData.currentSyncPage && <div><strong>当前处理页:</strong> {summaryData.currentSyncPage}</div>}
            <div><strong>图片总数 (近似):</strong> {summaryData.overallStats?.approxFileCount ?? 'N/A'}</div>
            <div><strong>总存储大小 (近似):</strong> {summaryData.overallStats?.approxTotalSizeFormatted ?? 'N/A'}</div>
            <div><strong>上次同步结束时间:</strong> {formatDate(summaryData.lastRun?.endTime)}</div>
            <div><strong>上次同步状态:</strong> {summaryData.lastRun?.status ?? 'N/A'}</div>
            {summaryData.lastRun?.errorInfo && <div style={{ color: 'orange' }}><strong>上次错误:</strong> {summaryData.lastRun.errorInfo}</div>}
            <div><strong>API 剩余/限制:</strong> {summaryData.apiLimits?.remaining ?? 'N/A'} / {summaryData.apiLimits?.limit ?? 'N/A'}</div>
            <div><strong>API 限制下次重置 (UTC):</strong> {formatDate(summaryData.apiLimits?.estimatedReset)}</div>
            <div><strong>API 限制上次检查:</strong> {formatDate(summaryData.apiLimits?.lastChecked)}</div>
          </div>
        )}
        {!isLoadingSummary && !summaryError && !summaryData && <p>未能加载概要信息。</p>}
      </div>
      {/* --- 结束概要信息区域 --- */}


      <h2>已同步图片元数据</h2>
      {/* --- 图片列表表格 (保持不变) --- */}
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
                    <td>{formatDate(image.sync_timestamp)}</td> {/* 使用统一的 formatDate */}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* --- 结束图片列表表格 --- */}

      {/* --- 加载更多按钮 (保持不变) --- */}
      {!loadingInitial && !error && nextToken && (
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button onClick={handleLoadMore} disabled={loadingMore}>
                  {loadingMore ? '正在加载...' : '加载更多'}
              </button>
          </div>
      )}
      {/* --- 结束加载更多按钮 --- */}
    </main>
  );
}
