// /home/admin/imgu/frontend/src/app/page.jsx (Added console.log for debug)
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
        return new Date(isoString).toLocaleString('zh-CN', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: false
        });
    } catch {
        return 'Invalid Date';
    }
};

export default function HomePage() {
  // --- 状态 ---
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
  const [summaryData, setSummaryData] = useState(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState(null);
  // --- 结束状态 ---

  // --- API URLs ---
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const baseApiUrl = apiUrl ? apiUrl.replace(/\/$/, '') : null;
  const startSyncUrl = baseApiUrl ? `${baseApiUrl}/start-sync` : null;
  const stopSyncUrl = baseApiUrl ? `${baseApiUrl}/stop-sync` : null;
  const statusSyncUrl = baseApiUrl ? `${baseApiUrl}/sync-status` : null;
  const summaryApiUrl = baseApiUrl ? `${baseApiUrl}/summary` : null;
  // --- 结束 API URLs ---

  // fetchImageData (无变化)
  const fetchImageData = useCallback(async (token = null) => {
       if (!apiUrl) { setError("API URL 配置缺失。"); setLoadingInitial(false); return; }
       console.log(`正在从 API 获取数据: ${token ? '下一页' : '初始页'}`);
       if (!token) setLoadingInitial(true); else setLoadingMore(true); setError(null);
       const urlToFetch = token ? `${apiUrl}?nextToken=${encodeURIComponent(token)}` : apiUrl;
       try {
         const response = await fetch(urlToFetch);
         // --- 修正: 检查 404 ---
         if (response.status === 404) throw new Error(`API 路径未找到 (${response.status})。请检查路由。`);
         if (!response.ok) throw new Error(`HTTP 错误！状态码: ${response.status}`);
         const data = await response.json();
         console.log("成功获取数据:", data.items?.length || 0, "条。下一页令牌:", data.nextToken);
         if (data && data.items) { setImages(prevImages => token ? [...prevImages, ...data.items] : data.items); setNextToken(data.nextToken); }
         else { if (!token) setImages([]); setNextToken(null); console.warn("API 返回的数据格式不符合预期或 items 为空。"); }
       } catch (e) {
         console.error("获取图片列表失败:", e);
          if (e instanceof TypeError && e.message.includes('fetch')) { setError(`网络错误：无法从 API 获取图片列表。`); }
          else { setError(`加载图片列表出错: ${e.message}`); } // 使用完整的错误消息
       } finally { if (!token) setLoadingInitial(false); setLoadingMore(false); }
  }, [apiUrl]);

  // fetchSyncStatus (无变化)
  const fetchSyncStatus = useCallback(async () => {
       if (!statusSyncUrl) { setSyncStatusMessage("错误：状态 API URL 未配置。"); setIsLoadingStatus(false); setSyncStatusFromServer(STATUS_UNKNOWN); return; }
       setIsLoadingStatus(true); console.log("Fetching sync status...");
       try {
           const response = await fetch(statusSyncUrl);
           // --- 修正: 检查 404 ---
           if (response.status === 404) throw new Error(`状态 API 路径未找到 (${response.status})。`);
           const data = await response.json();
           if (!response.ok) { throw new Error(data.message || `获取状态失败 (${response.status})`); }
           console.log("Sync status received:", data); setSyncStatusFromServer(data.status || STATUS_UNKNOWN); setSyncExecutionArn(data.executionArn || null);
           switch(data.status) {
               /* ... case statements ... */
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

  // fetchSummaryData (无变化)
  const fetchSummaryData = useCallback(async () => {
    if (!summaryApiUrl) { setSummaryError("概要 API URL 未配置。"); setIsLoadingSummary(false); return; }
    setIsLoadingSummary(true); setSummaryError(null); console.log("Fetching summary data...");
    try {
      const response = await fetch(summaryApiUrl); const data = await response.json();
      if (response.status === 404) throw new Error(`概要 API 路径未找到 (${response.status})。`);
      if (!response.ok) { throw new Error(data.message || `获取概要信息失败 (${response.status})`); }
      console.log("Summary data received:", data); setSummaryData(data);
    } catch (error) { console.error('获取概要信息时出错:', error); setSummaryError(`加载概要信息出错: ${error.message}`); setSummaryData(null); }
     finally { setIsLoadingSummary(false); }
  }, [summaryApiUrl]);

  // useEffect (无变化)
  useEffect(() => {
    fetchImageData();
    fetchSyncStatus();
    fetchSummaryData();
  }, [fetchImageData, fetchSyncStatus, fetchSummaryData]);

  // handleLoadMore (无变化)
  const handleLoadMore = () => { if (nextToken && !loadingMore) fetchImageData(nextToken); };
  // handleStartSync (无变化)
  const handleStartSync = async () => {
       if (!startSyncUrl) { setSyncStatusMessage('错误：API URL 未正确配置。'); return; }
       if (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING) { setSyncStatusMessage("任务已在运行或正在停止。"); return; }
       setSyncStatusMessage('正在启动同步任务...'); setIsLoadingStatus(true);
       try {
           const response = await fetch(startSyncUrl, { method: 'POST' }); const result = await response.json();
           if (!response.ok || response.status !== 202) { throw new Error(result.message || `启动同步失败 (${response.status})`); }
           setSyncStatusMessage(result.message || `同步任务已成功启动！`);
           await fetchSyncStatus(); // 刷新状态
           // await fetchSummaryData(); // 可选：刷新概要
       } catch (error) { console.error('启动同步时出错:', error); setSyncStatusMessage(`启动同步出错: ${error.message}`); }
        finally { setIsLoadingStatus(false); }
  };
   // handleStopSync (无变化)
  const handleStopSync = async () => {
       if (!stopSyncUrl) { setSyncStatusMessage('错误：停止 API URL 未配置。'); return; }
       const arnToStop = syncExecutionArn; // 使用从状态更新的 ARN
       if (!arnToStop && (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING)) {
           setSyncStatusMessage('无法获取执行 ARN，请稍后重试或刷新页面。');
           await fetchSyncStatus(); // 尝试再次获取
           return;
       }
       if(!arnToStop) { // 如果还是没有 ARN
            setSyncStatusMessage('当前没有可停止的运行中任务。');
            return;
       }
       setSyncStatusMessage(`正在发送停止请求...`); setIsLoadingStatus(true);
       try {
           const response = await fetch(stopSyncUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executionArn: arnToStop }) });
           const result = await response.json();
           if (!response.ok) { throw new Error(result.message || `停止同步失败 (${response.status})`); }
           setSyncStatusMessage(result.message || `同步任务停止请求已发送。`);
           await fetchSyncStatus(); // 刷新状态
           // await fetchSummaryData(); // 可选：刷新概要
       } catch (error) { console.error('停止同步时出错:', error); setSyncStatusMessage(`停止同步出错: ${error.message}`); }
        finally { setIsLoadingStatus(false); }
  };

  // 按钮禁用逻辑 (无变化)
  const canStartSync = !isLoadingStatus && syncStatusFromServer !== STATUS_RUNNING && syncStatusFromServer !== STATUS_STOPPING;
  const canStopSync = !isLoadingStatus && (syncStatusFromServer === STATUS_RUNNING || syncStatusFromServer === STATUS_STOPPING);

  // *** 在 return 前添加这行日志 ***
  console.log('Render Check:', { isLoadingStatus, syncStatusFromServer, canStartSync });

  return (
    <main>
      <h1>Unsplash 图片库</h1>
      <p>图片源自 Unsplash, 存储于 Cloudflare R2 & AWS DynamoDB。</p>

      {/* 同步控制区域 (无变化) */}
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

      {/* 概要信息区域 (无变化) */}
      <div className="summary-info" style={{ margin: '20px 0', padding: '15px', border: '1px solid #eee', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
        <h2>系统概要</h2>
        {isLoadingSummary && <p>加载概要信息...</p>}
        {summaryError && <p style={{ color: 'red' }}>{summaryError}</p>}
        {!isLoadingSummary && !summaryError && summaryData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px 20px', fontSize: '0.9em' }}>
            <div><strong>当前同步状态:</strong> {summaryData.currentSyncStatus ?? 'N/A'}</div>
            {summaryData.currentSyncPage && <div><strong>当前处理页:</strong> {summaryData.currentSyncPage}</div>}
            <div><strong>图片总数 (估):</strong> {summaryData.overallStats?.approxFileCount?.toLocaleString('zh-CN') ?? 'N/A'}</div>
            <div><strong>总存储大小 (估):</strong> {summaryData.overallStats?.approxTotalSizeFormatted ?? 'N/A'}</div>
            <div><strong>上次同步结束:</strong> {formatDate(summaryData.lastRun?.endTime)}</div>
            <div><strong>上次同步状态:</strong> {summaryData.lastRun?.status ?? 'N/A'}</div>
            {summaryData.lastRun?.status === STATUS_FAILED && summaryData.lastRun.errorInfo &&
                <div style={{ color: 'orange', gridColumn: '1 / -1' }}>
                    <strong>上次失败原因:</strong> {summaryData.lastRun.errorInfo}
                </div>
            }
            <div><strong>API 剩余/限制:</strong> {summaryData.apiLimits?.remaining ?? 'N/A'} / {summaryData.apiLimits?.limit ?? 'N/A'}</div>
            <div><strong>API 下次重置 (估):</strong> {formatDate(summaryData.apiLimits?.estimatedReset)}</div>
          </div>
        )}
        {!isLoadingSummary && !summaryError && !summaryData && <p>未能加载概要信息。</p>}
      </div>

      <h2>已同步图片元数据</h2>
      {/* 图片列表表格 (无变化) */}
      {loadingInitial && <p>正在加载元数据...</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loadingInitial && !error && (
        <div style={{ overflowX: 'auto' }}>
          {images.length === 0 ? ( <p>未找到图片元数据。请尝试启动同步，或检查同步状态。</p> ) : ( <table>{/* ... 表格内容 ... */}</table> )}
        </div>
      )}
      {/* 加载更多按钮 (无变化) */}
      {!loadingInitial && !error && nextToken && ( <div style={{ marginTop: '20px', textAlign: 'center' }}><button onClick={handleLoadMore} disabled={loadingMore}>{loadingMore ? '正在加载...' : '加载更多'}</button></div> )}
    </main>
  );
}

// 省略部分未修改的 JSX (表格内部) 和函数体细节，以保持简洁，确保主要结构和新增日志存在
