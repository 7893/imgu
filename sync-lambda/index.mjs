// /home/admin/imgu/sync-lambda/index.mjs (Updated: Simplify UPDATE_SYNC_STATE action)
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
  // SFN 'Parameters' field content goes into event (if Payload is used) or becomes event itself
  // Let's assume payload comes from SFN Parameters.Payload structure
  const payload = event.payload || {};
  // Try to get context info passed directly or via iterator for logging
  const currentPage = event.iteratorConfig?.CurrentPage ?? event?.iterator?.currentPage ?? payload?.processedPage ?? event?.input?.iterator?.currentPage;
  const apiLimitsFromState = event.apiLimits ?? event?.input?.fetchOutput?.Payload?.apiLimits; // More robust path checking

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE': {
        if (event.iteratorConfig?.CurrentPage === undefined || event.iteratorConfig?.BatchSize === undefined) {
            throw new Error('Missing iteratorConfig.CurrentPage or iteratorConfig.BatchSize for FETCH_UNSPLASH_PAGE');
        }
        const { photos, apiLimits: fetchedApiLimits } = await handleFetchPage(
            event.iteratorConfig.CurrentPage,
            event.iteratorConfig.BatchSize,
            secrets.unsplashApiKey
        );
        // ASL ResultPath: $.fetchOutput will wrap this in Payload
        return { photos: photos, apiLimits: fetchedApiLimits };
       }

      case 'CHECK_PHOTO_EXISTS': {
        // ASL passes Map item directly as event if InputPath is used correctly
        if (!event.id) { throw new Error('Missing photo id (event.id) for CHECK_PHOTO_EXISTS'); }
        const exists = await handleCheckExists(event.id);
        // ASL ResultPath: $.existsResult will wrap this in Payload
        return { exists: exists };
       }

      case 'DOWNLOAD_AND_STORE': {
         // ASL passes { action: ..., payload: { photoData: $ } }
         if (!payload.photoData || !payload.photoData.id) { throw new Error('Missing payload.photoData for DOWNLOAD_AND_STORE'); }
         const result = await handleDownloadAndStore(payload.photoData);
         // ASL ResultPath: $.downloadResult will wrap this in Payload
         return { success: true, ...result };
        }

      case 'UPDATE_SYNC_STATE': {
        // ASL passes { action: ..., payload: { syncType: ..., apiLimits: ... } }
        // We REMOVED processedPage from the ASL payload mapping
        if (!payload.syncType) {
             throw new Error('Missing syncType in payload for UPDATE_SYNC_STATE');
        }

        const attributesToUpdate = {};

        // Get apiLimits passed from SFN (should be $.input.fetchOutput.Payload.apiLimits)
        const limitsToUse = payload.apiLimits; // ASL now directly maps the correct path to payload.apiLimits

        if (limitsToUse) {
            attributesToUpdate.apiLimits = {
                unsplashLimit: limitsToUse.limit !== undefined ? parseInt(limitsToUse.limit, 10) : null,
                unsplashRemaining: limitsToUse.remaining !== undefined ? parseInt(limitsToUse.remaining, 10) : null,
                lastCheckedTimestamp: new Date().toISOString()
            };
             // Also update currentSyncPage based on iterator info *available before this state*
             // Note: SFN Input to this task was passed in error log in Response #149
             // We extract currentPage from $.input.iterator.currentPage passed implicitly
             const pageNum = event?.input?.iterator?.currentPage;
             if (typeof pageNum === 'number') {
                 attributesToUpdate.currentSyncPage = pageNum;
                 console.log(`Recording currentSyncPage from SFN input: ${pageNum}`);
             } else {
                 console.warn("Could not reliably determine current page from SFN input to record currentSyncPage.");
             }

        } else {
             console.log("No API limits found in payload to update.");
             // Still record current page if possible? Maybe not, only record page when limits are updated.
             const pageNum = event?.input?.iterator?.currentPage;
             if (typeof pageNum === 'number') {
                 attributesToUpdate.currentSyncPage = pageNum;
                 console.log(`Recording currentSyncPage from SFN input: ${pageNum} (no API limits updated)`);
             } else {
                 console.warn("Could not reliably determine current page from SFN input to record currentSyncPage.");
             }
        }

        // Only call DB update if we have something to update (apiLimits or potentially pageNum)
        if (Object.keys(attributesToUpdate).length > 0) {
            await updateSyncState(payload.syncType, attributesToUpdate);
            return { success: true, message: `Sync state attributes updated for ${payload.syncType}.` };
        } else {
             return { success: true, message: `No attributes to update for ${payload.syncType}.` };
        }
      }

      case 'FINALIZE_SYNC': {
         if (!payload.syncType || !payload.status) { throw new Error('Missing syncType or status in payload for FINALIZE_SYNC'); }
         console.log(`Finalizing sync for ${payload.syncType} with status ${payload.status}`);
         const finalAttributes = {
             currentSyncPage: null, // Clear current page
             lastRunStats: {
                 // startTime: payload.startTime // Optional
                 endTime: new Date().toISOString(),
                 status: payload.status,
                 errorInfo: payload.errorInfo || null
                 // fileCount: payload.fileCount // Optional
                 // totalSize: payload.totalSize // Optional
             }
         };
         // Also clear apiLimits maybe? Or keep last known? Keep last known for now.
         // finalAttributes.apiLimits = null; // Uncomment to clear

         await updateSyncState(payload.syncType, finalAttributes);
         return { success: true, message: `Sync finalized for ${payload.syncType} with status ${payload.status}` };
       }

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

async function handleFetchPage(page, perPage, unsplashApiKey) {
  if (!unsplashApiKey) { throw new Error("Unsplash API Key is missing."); }
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=latest`);
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=latest`;
  const response = await fetch(unsplashApiUrl, { headers: { 'Authorization': `Client-ID ${unsplashApiKey}`, 'Accept-Version': 'v1' } });
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
  const imageFileName = `${photoId}${extension}`; const r2ObjectKey = `${category}/${imageFileName}`; const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`; console.log(`Downloading RAW image from: ${rawUrl}`); const imageResponse = await fetch(rawUrl); if (!imageResponse.ok) { throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`); } if (!imageResponse.body) { throw new Error(`No response body received for image ${photoId}`); }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer()); const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`; const fileSizeInBytes = imageBuffer.length; console.log(`RAW image downloaded. Size: ${Math.round(fileSizeInBytes / 1024)} KB, Type: ${contentType}`);
  await uploadImage(r2ObjectKey, imageBuffer, contentType);
  const metadataItem = { ...photoData, photo_id: photoId, r2_object_key: r2ObjectKey, r2_public_url: r2PublicUrl, sync_timestamp: new Date().toISOString(), image_category: category, downloaded_size: 'raw', r2_object_size_bytes: fileSizeInBytes }; await saveMetadata(metadataItem); return { photo_id: photoId, r2_object_key: r2ObjectKey, size: fileSizeInBytes };
}
