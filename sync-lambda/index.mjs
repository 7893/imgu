// /home/admin/imgu/sync-lambda/index.mjs (Correct version using SSM Secrets)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata, updateSyncState } from './dynamodb.mjs';
import { getSecrets } from './secrets.mjs'; // 导入获取密钥的函数
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
       secrets = await getSecrets(); // 在 handler 开始时加载密钥
   } catch (error) {
       console.error("CRITICAL: Failed to load secrets.", error);
       throw new Error(`Failed to load secrets: ${error.message}`);
   }

  const action = event.action;
  const payload = event.payload || {};
  const currentPage = event.iteratorConfig?.CurrentPage ?? event?.iterator?.currentPage ?? payload?.processedPage;
  const apiLimitsFromState = event.apiLimits;

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        if (event.iteratorConfig?.CurrentPage === undefined || event.iteratorConfig?.BatchSize === undefined) {
            throw new Error('Missing iteratorConfig.CurrentPage or iteratorConfig.BatchSize for FETCH_UNSPLASH_PAGE');
        }
        const { photos, apiLimits: fetchedApiLimits } = await handleFetchPage(
            event.iteratorConfig.CurrentPage,
            event.iteratorConfig.BatchSize,
            secrets.unsplashApiKey // 使用从 SSM 获取的 Key
        );
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

        const attributesToUpdate = { currentSyncPage: pageNum };
        if (payload.apiLimits) {
            attributesToUpdate.apiLimits = {
                unsplashLimit: payload.apiLimits.limit !== undefined ? parseInt(payload.apiLimits.limit, 10) : null,
                unsplashRemaining: payload.apiLimits.remaining !== undefined ? parseInt(payload.apiLimits.remaining, 10) : null,
                lastCheckedTimestamp: new Date().toISOString()
            };
        } else if (apiLimitsFromState) {
             attributesToUpdate.apiLimits = {
                unsplashLimit: apiLimitsFromState.limit !== undefined ? parseInt(apiLimitsFromState.limit, 10) : null,
                unsplashRemaining: apiLimitsFromState.remaining !== undefined ? parseInt(apiLimitsFromState.remaining, 10) : null,
                lastCheckedTimestamp: new Date().toISOString()
            };
        }

        await updateSyncState(payload.syncType, attributesToUpdate);
        return { success: true, message: `Sync state updated for ${payload.syncType} to page ${pageNum}` };

      case 'FINALIZE_SYNC':
         if (!payload.syncType || !payload.status) { throw new Error('Missing syncType or status in payload for FINALIZE_SYNC'); }
         console.log(`Finalizing sync for ${payload.syncType} with status ${payload.status}`);
         const finalAttributes = {
             currentSyncPage: null,
             lastRunStats: {
                 endTime: new Date().toISOString(),
                 status: payload.status,
                 errorInfo: payload.errorInfo || null
             }
         };
         await updateSyncState(payload.syncType, finalAttributes);
         return { success: true, message: `Sync finalized for ${payload.syncType} with status ${payload.status}` };

      default:
        console.error('Unknown action requested:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    const pageInfo = currentPage !== undefined ? ` (Page ${currentPage})` : '';
    console.error(`Error executing action <span class="math-inline">\{action\}</span>{pageInfo}:`, error);
    error.message = `Action <span class="math-inline">\{action\} failed</span>{pageInfo}: ${error.message}`;
    throw error;
  }
};

async function handleFetchPage(page, perPage, unsplashApiKey) {
  if (!unsplashApiKey) { throw new Error("Unsplash API Key is missing."); }
  console.log(`Workspaceing Unsplash page <span class="math-inline">\{page\}, perPage\=</span>{perPage}, orderBy=latest`);
  const unsplashApiUrl = `<span class="math-inline">\{config\.unsplashApiUrl\}/photos?page\=</span>{page}&per_page=${perPage}&order_by=latest`;
  const response = await fetch(unsplashApiUrl, {
      headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' }
  });
  const limitHeader = response.headers.get('x-ratelimit-limit');
  const remainingHeader = response.headers.get('x-ratelimit-remaining');
  const apiLimits = {
      limit: limitHeader ? parseInt(limitHeader, 10) : null,
      remaining: remainingHeader ? parseInt(remainingHeader, 10) : null
  };
  console.log('Unsplash API Limits:', apiLimits);
  if (!response.ok) { const errorBody = await response.text(); console.error(`Unsplash API Error (${response.status}) fetching page ${page}: ${errorBody}`); throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`); }
  const photos = await response.json(); console.log(`Workspaceed ${photos.length} photos for page ${page}.`);
  return { photos, apiLimits };
}
async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  const existingItem = await getDynamoDBItem(photoId); const exists = !!existingItem; console.log(`Photo ${photoId} exists: ${exists}`); return exists;
}
async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id; console.log(`Processing download & store for photo ID: ${photoId}`); const category = determineCategory(photoData); console.log(`Determined category: ${category}`); const rawUrl = photoData.urls?.raw; if (!rawUrl) { throw new Error(`Missing raw URL for photo ${photoId}`); }
  let extension = '.jpg'; try { const urlObj = new URL(rawUrl); const fmMatch = urlObj.searchParams.get('fm'); if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch.toLowerCase())) { extension = `.${fmMatch.toLowerCase()}`; } } catch (e) { console.warn(`Could not parse raw URL extension for ${photoId}, defaulting to .jpg. Error: ${e.message}`); }
  const imageFileName = `<span class="math-inline">\{photoId\}</span>{extension}`; const r2ObjectKey = `<span class="math-inline">\{category\}/</span>{imageFileName}`; const r2PublicUrl = `<span class="math-inline">\{config\.r2PublicUrlPrefix\}/</span>{r2ObjectKey}`; console.log(`Downloading RAW image from: ${rawUrl}`); const imageResponse = await fetch(rawUrl); if (!imageResponse.ok) { throw new Error(`Failed to download RAW image <span class="math-inline">\{photoId\} \(</span>{imageResponse.status})`); } if (!imageResponse.body) { throw new Error(`No response body received for image ${photoId}`); }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer()); const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`; const fileSizeInBytes = imageBuffer.length; console.log(`RAW image downloaded. Size: ${Math.round(fileSizeInBytes / 1024)} KB, Type: ${contentType}`);
  await uploadImage(r2ObjectKey, imageBuffer, contentType);
  const metadataItem = { ...photoData, photo_id: photoId, r2_object_key: r2ObjectKey, r2_public_url: r2PublicUrl, sync_timestamp: new Date().toISOString(), image_category: category, downloaded_size: 'raw', r2_object_size_bytes: fileSizeInBytes }; await saveMetadata(metadataItem); return { photo_id: photoId, r2_object_key: r2ObjectKey, size: fileSizeInBytes };
}
