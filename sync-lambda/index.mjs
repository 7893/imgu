// /home/admin/imgu/sync-lambda/index.mjs (Updated for SFN Input Change)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata, updateSyncState } from './dynamodb.mjs';
import process from 'node:process';

function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') return config.defaultCategory || 'uncategorized';
  return name.toLowerCase().replace(/[\s\/\?%*:|"<>\\.]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').substring(0, 50);
}
function determineCategory(photoData) {
  // 检查 photoData 是否存在，以及其属性
  if (photoData?.topics?.[0]?.slug) { const sanitizedSlug = sanitizeFolderName(photoData.topics[0].slug); if (sanitizedSlug && sanitizedSlug !== '-') return sanitizedSlug; }
  if (photoData?.tags && Array.isArray(photoData.tags)) { for (const tag of photoData.tags) { if (tag?.title) { const sanitizedTitle = sanitizeFolderName(tag.title); if (sanitizedTitle && sanitizedTitle !== '-') return sanitizedTitle; } } }
  return config.defaultCategory || 'uncategorized';
}

export const handler = async (event) => {
  // 注意: Step Functions 调用 Lambda 时，Payload 会成为 event
  console.log('Sync Lambda invoked with event:', JSON.stringify(event, null, 2));

  // 直接从 event 读取 action 和 payload
  const action = event.action;
  const payload = event.payload || {}; // payload 现在是 { photoData: {...} } 或 { syncType: ..., processedPage: ... }

  // 尝试获取页码信息用于日志
  const currentPage = event.iteratorConfig?.CurrentPage ?? payload?.processedPage;

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        // 输入现在是 event.iteratorConfig
        if (event.iteratorConfig?.CurrentPage === undefined || event.iteratorConfig?.BatchSize === undefined) {
            throw new Error('Missing iteratorConfig.CurrentPage or iteratorConfig.BatchSize for FETCH_UNSPLASH_PAGE');
        }
        const photos = await handleFetchPage(event.iteratorConfig.CurrentPage, event.iteratorConfig.BatchSize);
        // 返回 photos 供 SFN Map State 使用 (注意：SFN 的 ResultPath 设置很重要)
        // 按照之前的 ASL，SFN 将整个 lambda 输出放入 fetchResult.Payload
        return { photos: photos }; // 只返回 photos 对象即可

      case 'CHECK_PHOTO_EXISTS':
        // Map state 直接输入 photo 对象作为 event
        if (!event.id) {
            throw new Error('Missing photo id (event.id) for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(event.id);
        // 返回 exists 供 SFN Choice state 使用
        return { exists: exists }; // 只返回需要的结果

      case 'DOWNLOAD_AND_STORE':
         // *** 修改点: 从 event.payload.photoData 获取数据 ***
         if (!payload.photoData || !payload.photoData.id) {
            throw new Error('Missing payload.photoData for DOWNLOAD_AND_STORE');
         }
         const result = await handleDownloadAndStore(payload.photoData); // 传入 photoData 对象
         // 返回结果
         return { success: true, ...result };

      case 'UPDATE_SYNC_STATE':
        // 输入是 event.payload = { syncType, processedPage }
        if (!payload.syncType || payload.processedPage === undefined) {
          throw new Error('Missing syncType or processedPage in payload for UPDATE_SYNC_STATE');
        }
        const pageNum = parseInt(payload.processedPage, 10);
        if (isNaN(pageNum)) {
             throw new Error(`Invalid processedPage in payload: ${payload.processedPage}`);
        }
        await updateSyncState(payload.syncType, pageNum);
        return { success: true, message: `Sync state updated for ${payload.syncType} to page ${pageNum}` };

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

// handleFetchPage, handleCheckExists 函数保持不变...
async function handleFetchPage(page, perPage) {
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=latest`);
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=latest`;
  const response = await fetch(unsplashApiUrl, { headers: { 'Authorization': `Client-ID ${config.unsplashAccessKey}`, 'Accept-Version': 'v1' } });
  if (!response.ok) { const errorBody = await response.text(); console.error(`Unsplash API Error (${response.status}) fetching page ${page}: ${errorBody}`); throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`); }
  const photos = await response.json(); console.log(`Workspaceed ${photos.length} photos for page ${page}.`); return photos;
}
async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  const existingItem = await getDynamoDBItem(photoId); const exists = !!existingItem; console.log(`Photo ${photoId} exists: ${exists}`); return exists;
}

// handleDownloadAndStore 函数现在直接接收 photoData 对象，内部逻辑不变
async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id; console.log(`Processing download & store for photo ID: ${photoId}`); const category = determineCategory(photoData); console.log(`Determined category: ${category}`); const rawUrl = photoData.urls?.raw; if (!rawUrl) { throw new Error(`Missing raw URL for photo ${photoId}`); }
  let extension = '.jpg'; try { const urlObj = new URL(rawUrl); const fmMatch = urlObj.searchParams.get('fm'); if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch.toLowerCase())) { extension = `.${fmMatch.toLowerCase()}`; } } catch (e) { console.warn(`Could not parse raw URL extension for ${photoId}, defaulting to .jpg. Error: ${e.message}`); }
  const imageFileName = `${photoId}${extension}`; const r2ObjectKey = `${category}/${imageFileName}`; const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`; console.log(`Downloading RAW image from: ${rawUrl}`); const imageResponse = await fetch(rawUrl); if (!imageResponse.ok) { throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`); } if (!imageResponse.body) { throw new Error(`No response body received for image ${photoId}`); }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer()); const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`; const fileSizeInBytes = imageBuffer.length; console.log(`RAW image downloaded. Size: ${Math.round(fileSizeInBytes / 1024)} KB, Type: ${contentType}`);
  await uploadImage(r2ObjectKey, imageBuffer, contentType); const metadataItem = { ...photoData, photo_id: photoId, r2_object_key: r2ObjectKey, r2_public_url: r2PublicUrl, sync_timestamp: new Date().toISOString(), image_category: category, downloaded_size: 'raw', r2_object_size_bytes: fileSizeInBytes }; await saveMetadata(metadataItem); return { photo_id: photoId, r2_object_key: r2ObjectKey, size: fileSizeInBytes };
}
