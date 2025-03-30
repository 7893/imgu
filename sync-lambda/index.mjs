// /home/admin/imgu/sync-lambda/index.mjs (Updated for Sync State Write)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
// 导入 updateSyncState
import { getDynamoDBItem, saveMetadata, updateSyncState } from './dynamodb.mjs';
import process from 'node:process';

// sanitizeFolderName 和 determineCategory 函数保持不变...
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
  const action = event.action;

  // 尝试从不同地方获取当前处理的页码信息，用于日志记录
  const currentPage = event.iteratorConfig?.CurrentPage ??  // SFN Map 迭代器配置
                      event.payload?.currentPage ??           // 直接 payload
                      event.payload?.processedPage ??         // UPDATE_SYNC_STATE 的 payload
                      undefined;                             // 无法确定

  // SFN Map State 的输入可能是数组元素，也可能是包含 payload 的对象
  // 我们需要灵活处理 event 结构
  const payload = event.payload || {}; // 用于 UPDATE_SYNC_STATE
  const photoDataForMap = event.photos ? null : event; // 如果 event 包含 photos，则 Map 输入是 photos 数组元素

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        // 输入应包含 iteratorConfig.CurrentPage 和 iteratorConfig.BatchSize
        if (event.iteratorConfig?.CurrentPage === undefined || event.iteratorConfig?.BatchSize === undefined) {
            throw new Error('Missing iteratorConfig.CurrentPage or iteratorConfig.BatchSize for FETCH_UNSPLASH_PAGE');
        }
        const photos = await handleFetchPage(event.iteratorConfig.CurrentPage, event.iteratorConfig.BatchSize);
        // 将 photos 附加到原始事件上返回给 SFN
        return { ...event, photos: photos };

      case 'CHECK_PHOTO_EXISTS':
        // Map state 直接输入 photo 对象 (photoDataForMap)
        if (!photoDataForMap?.id) {
            throw new Error('Missing photo id (event.id) for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(photoDataForMap.id);
        // 将 exists 结果附加到原始事件上返回给 SFN Choice
        return { ...event, exists: exists };

      case 'DOWNLOAD_AND_STORE':
         // Map state 直接输入 photo 对象 (photoDataForMap)
         if (!photoDataForMap?.id) {
            throw new Error('Missing photo data (event.id) for DOWNLOAD_AND_STORE');
         }
         const result = await handleDownloadAndStore(photoDataForMap); // 传入 photo 对象
         // 附加处理结果返回（可选）
         return { ...event, downloadResult: result };

      // --- 新增处理状态更新的 action ---
      case 'UPDATE_SYNC_STATE':
        // 输入应包含 payload.syncType 和 payload.processedPage
        if (!payload.syncType || payload.processedPage === undefined) {
          throw new Error('Missing syncType or processedPage in payload for UPDATE_SYNC_STATE');
        }
        // 确保 processedPage 是数字
        const pageNum = parseInt(payload.processedPage, 10);
        if (isNaN(pageNum)) {
             throw new Error(`Invalid processedPage in payload: ${payload.processedPage}`);
        }
        await updateSyncState(payload.syncType, pageNum);
        return { success: true, message: `Sync state updated for ${payload.syncType} to page ${pageNum}` };
      // --- 结束新增 ---

      default:
        console.error('Unknown action requested:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    // 在错误信息中包含当前页码（如果能获取到）
    const pageInfo = currentPage !== undefined ? ` (Page ${currentPage})` : '';
    console.error(`Error executing action ${action}${pageInfo}:`, error);
    error.message = `Action ${action} failed${pageInfo}: ${error.message}`;
    throw error; // 让 Step Functions 捕获错误
  }
};

// handleFetchPage, handleCheckExists, handleDownloadAndStore 函数保持不变...
// (代码与上一个回复中的相同，这里省略以减少重复)
async function handleFetchPage(page, perPage) {
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=latest`); // Typo fix: Fetching
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=latest`;
  const response = await fetch(unsplashApiUrl, { headers: { 'Authorization': `Client-ID ${config.unsplashAccessKey}`, 'Accept-Version': 'v1' } });
  if (!response.ok) { const errorBody = await response.text(); console.error(`Unsplash API Error (${response.status}) fetching page ${page}: ${errorBody}`); throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`); }
  const photos = await response.json(); console.log(`Workspaceed ${photos.length} photos for page ${page}.`); return photos; // Typo fix: Fetched
}
async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  const existingItem = await getDynamoDBItem(photoId); const exists = !!existingItem; console.log(`Photo ${photoId} exists: ${exists}`); return exists;
}
async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id; console.log(`Processing download & store for photo ID: ${photoId}`); const category = determineCategory(photoData); console.log(`Determined category: ${category}`); const rawUrl = photoData.urls?.raw; if (!rawUrl) { throw new Error(`Missing raw URL for photo ${photoId}`); }
  let extension = '.jpg'; try { const urlObj = new URL(rawUrl); const fmMatch = urlObj.searchParams.get('fm'); if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch.toLowerCase())) { extension = `.${fmMatch.toLowerCase()}`; } } catch (e) { console.warn(`Could not parse raw URL extension for ${photoId}, defaulting to .jpg. Error: ${e.message}`); }
  const imageFileName = `${photoId}${extension}`; const r2ObjectKey = `${category}/${imageFileName}`; const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`; console.log(`Downloading RAW image from: ${rawUrl}`); const imageResponse = await fetch(rawUrl); if (!imageResponse.ok) { throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`); } if (!imageResponse.body) { throw new Error(`No response body received for image ${photoId}`); }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer()); const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`; const fileSizeInBytes = imageBuffer.length; console.log(`RAW image downloaded. Size: ${Math.round(fileSizeInBytes / 1024)} KB, Type: ${contentType}`);
  await uploadImage(r2ObjectKey, imageBuffer, contentType); const metadataItem = { ...photoData, photo_id: photoId, r2_object_key: r2ObjectKey, r2_public_url: r2PublicUrl, sync_timestamp: new Date().toISOString(), image_category: category, downloaded_size: 'raw', r2_object_size_bytes: fileSizeInBytes }; await saveMetadata(metadataItem); return { photo_id: photoId, r2_object_key: r2ObjectKey, size: fileSizeInBytes };
}
