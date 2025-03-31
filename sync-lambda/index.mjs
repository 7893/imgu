// /home/admin/imgu/sync-lambda/index.mjs (Updated to read headers and pass apiLimits)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata, updateSyncState } from './dynamodb.mjs';
import { getSecrets } from './secrets.mjs';
import process from 'node:process';

function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') return config.defaultCategory || 'uncategorized';
  return name.toLowerCase().replace(/[\s\/\?%*:|"<>\\.]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
}
function determineCategory(photoData) {
  if (photoData?.topics?.[0]?.slug) { const sanitizedSlug = sanitizeFolderName(photoData.topics[0].slug); if (sanitizedSlug && sanitizedSlug !== '-') return sanitizedSlug; }
  if (photoData?.tags && Array.isArray(photoData.tags)) { for (const tag of photoData.tags) { if (tag?.title) { const sanitizedTitle = sanitizeFolderName(tag.title); if (sanitizedTitle && sanitizedTitle !== '-') return sanitizedTitle; } } }
  return config.defaultCategory || 'uncategorized';
}

export const handler = async (event) => {
  console.log('Sync Lambda invoked with event:', JSON.stringify(event, null, 2));

  let secrets;
   try {
       secrets = await getSecrets();
   } catch (error) {
       console.error("CRITICAL: Failed to load secrets.", error);
       throw new Error(`Failed to load secrets: ${error.message}`);
   }

  const action = event.action;
  const payload = event.payload || {};
  // 尝试从 SFN iterator 或 payload 获取页码，主要用于日志
  const currentPage = event.iteratorConfig?.CurrentPage ?? event?.iterator?.currentPage ?? payload?.processedPage;
  // 获取 apiLimits (如果从 SFN 状态传递过来)
  const apiLimitsFromState = event.apiLimits; // Assumes FetchUnsplashPage merges output correctly

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        if (event.iteratorConfig?.CurrentPage === undefined || event.iteratorConfig?.BatchSize === undefined) {
            throw new Error('Missing iteratorConfig.CurrentPage or iteratorConfig.BatchSize for FETCH_UNSPLASH_PAGE');
        }
        // handleFetchPage 现在返回 { photos, apiLimits }
        const { photos, apiLimits: fetchedApiLimits } = await handleFetchPage(
            event.iteratorConfig.CurrentPage,
            event.iteratorConfig.BatchSize,
            secrets.unsplashApiKey
        );
        // 返回包含 photos 和 apiLimits 的对象，供 SFN 下一步使用
        return { photos: photos, apiLimits: fetchedApiLimits };

      case 'CHECK_PHOTO_EXISTS':
        if (!event.id) { throw new Error('Missing photo id (event.id) for CHECK_PHOTO_EXISTS'); }
        const exists = await handleCheckExists(event.id);
        return { exists: exists };

      case 'DOWNLOAD_AND_STORE':
         if (!payload.photoData || !payload.photoData.id) { throw new Error('Missing payload.photoData for DOWNLOAD_AND_STORE'); }
         const result = await handleDownloadAndStore(payload.photoData);
         return { success: true, ...result };

      case 'UPDATE_SYNC_STATE':
        if (!payload.syncType || payload.processedPage === undefined) { throw new Error('Missing syncType or processedPage in payload for UPDATE_SYNC_STATE'); }
        const pageNum = parseInt(payload.processedPage, 10);
        if (isNaN(pageNum)) { throw new Error(`Invalid processedPage in payload: ${payload.processedPage}`); }

        // 准备要更新的属性
        const attributesToUpdate = {
            currentSyncPage: pageNum
        };
        // 添加从 SFN 状态传递过来的 API 限制信息 (payload 中应包含)
        if (payload.apiLimits) {
            attributesToUpdate.apiLimits = {
                unsplashLimit: payload.apiLimits.limit !== undefined ? parseInt(payload.apiLimits.limit, 10) : null,
                unsplashRemaining: payload.apiLimits.remaining !== undefined ? parseInt(payload.apiLimits.remaining, 10) : null,
                lastCheckedTimestamp: new Date().toISOString() // 使用当前时间作为检查时间
            };
        }

        await updateSyncState(payload.syncType, attributesToUpdate);
        return { success: true, message: `Sync state updated for ${payload.syncType} to page ${pageNum}` };

      // --- 新增 FINALIZE_SYNC Action Handler ---
      case 'FINALIZE_SYNC':
         if (!payload.syncType || !payload.status) { throw new Error('Missing syncType or status in payload for FINALIZE_SYNC'); }
         console.log(`Finalizing sync for ${payload.syncType} with status ${payload.status}`);
         const finalAttributes = {
             currentSyncPage: null, // 清除当前页码
             lastRunStats: {
                 // startTime: payload.startTime, // 需要从 SFN 传递 startTime
                 endTime: new Date().toISOString(),
                 status: payload.status, // SUCCEEDED, FAILED, ABORTED
                 errorInfo: payload.errorInfo || null // 错误信息摘要
                 // fileCount: payload.fileCount, // 需要 SFN 聚合或 Lambda 计算
                 // totalSize: payload.totalSize // 需要 SFN 聚合或 Lambda 计算
             }
         };
         await updateSyncState(payload.syncType, finalAttributes);
         return { success: true, message: `Sync finalized for ${payload.syncType} with status ${payload.status}` };
      // --- 结束新增 ---

      default:
        console.error('Unknown action requested:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    const pageInfo = currentPage !== undefined ? ` (Page ${currentPage})` : '';
    console.error(`Error executing action ${action}${pageInfo}:`, error);
    error.message = `Action ${action} failed${pageInfo}: ${error.message}`;
    throw error;
  }
};

// handleFetchPage 修改为返回 apiLimits
async function handleFetchPage(page, perPage, unsplashApiKey) {
  if (!unsplashApiKey) { throw new Error("Unsplash API Key is missing."); }
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=latest`);
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=latest`;
  const response = await fetch(unsplashApiUrl, {
      headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
  });

  // 读取 Rate Limit Headers
  const limitHeader = response.headers.get('x-ratelimit-limit');
  const remainingHeader = response.headers.get('x-ratelimit-remaining');
  const apiLimits = {
      limit: limitHeader ? parseInt(limitHeader, 10) : null,
      remaining: remainingHeader ? parseInt(remainingHeader, 10) : null
  };
  console.log('Unsplash API Limits:', apiLimits);

  if (!response.ok) { const errorBody = await response.text(); console.error(`Unsplash API Error (${response.status}) fetching page ${page}: ${errorBody}`); throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`); }
  const photos = await response.json(); console.log(`Workspaceed ${photos.length} photos for page ${page}.`);

  // 返回 photos 和 apiLimits
  return { photos, apiLimits };
}

// handleCheckExists 保持不变
async function handleCheckExists(photoId) { /* ... */ }
// handleDownloadAndStore 保持不变
async function handleDownloadAndStore(photoData) { /* ... */ }
