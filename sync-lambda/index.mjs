// /home/admin/imgu/sync-lambda/index.mjs (Final Cleaned Version)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
// 确保 dynamodb.mjs 包含了 getDynamoDBItem 和 saveMetadata 并已导出
import { getDynamoDBItem, saveMetadata } from './dynamodb.mjs';
import process from 'node:process'; // 明确导入 process

/**
 * 根据事件中的 action 路由到不同的处理器
 */
export const handler = async (event) => {
  console.log('Sync Lambda invoked with event:', JSON.stringify(event, null, 2));

  // action 指明了 Step Functions 希望执行哪个任务
  const action = event.action;
  const payload = event.payload || {};

  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        if (payload.currentPage === undefined || payload.batchSize === undefined) {
            throw new Error('Missing currentPage or batchSize for FETCH_UNSPLASH_PAGE');
        }
        const photos = await handleFetchPage(payload.currentPage, payload.batchSize);
        // Step Functions 期望 Lambda 的输出是一个 JSON 对象，我们将其包装一下
        return { photos: photos };

      case 'CHECK_PHOTO_EXISTS':
        if (!payload.photo_id) {
            throw new Error('Missing photo_id for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(payload.photo_id);
        return { exists: exists }; // 返回 { exists: true/false }

      case 'DOWNLOAD_AND_STORE':
         if (!payload.photoData || !payload.photoData.id) {
            throw new Error('Missing photoData for DOWNLOAD_AND_STORE');
        }
        const result = await handleDownloadAndStore(payload.photoData);
        return { success: true, ...result }; // 返回 { success: true, photo_id: '...', r2_object_key: '...' }

      default:
        console.error('Unknown action requested:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`Error executing action ${action}:`, error);
    // 将错误信息包装一下，可能有助于 Step Functions 的 Catch
    // 注意：直接 throw error 也能被 Step Functions 捕获
    throw new Error(`Action ${action} failed: ${error.message}`);
  }
};

// --- Action Handlers ---

async function handleFetchPage(page, perPage) {
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=oldest`); // Corrected typo
  // --- Fetch logic is directly here ---
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=oldest`;
  const response = await fetch(unsplashApiUrl, {
      headers: {
          'Authorization': `Client-ID ${config.unsplashAccessKey}`,
          'Accept-Version': 'v1'
      }
  });
  if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Unsplash API Error (${response.status}) fetching page ${page}: ${errorBody}`);
      throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`);
  }
  const photos = await response.json();
  console.log(`Workspaceed ${photos.length} photos for page ${page}.`); // Corrected typo
  // --- Fetch logic ends here ---
  return photos; // 直接返回数组
}

async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  const existingItem = await getDynamoDBItem(photoId); // Assumes getDynamoDBItem returns Item or undefined
  const exists = !!existingItem;
  console.log(`Photo ${photoId} exists: ${exists}`);
  return exists;
}

async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id;
  console.log(`Processing download & store for photo ID: ${photoId}`);

  const category = photoData.topics?.[0]?.slug || config.defaultCategory; // Uses config.defaultCategory

  const rawUrl = photoData.urls?.raw;
  if (!rawUrl) {
      throw new Error(`Missing raw URL for photo ${photoId}`);
  }
  let extension = '.jpg'; // Default extension
  try {
      // Try to get extension from 'fm' query parameter in rawUrl
      const urlObj = new URL(rawUrl);
      const fmMatch = urlObj.searchParams.get('fm');
      if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch.toLowerCase())) {
          extension = `.${fmMatch.toLowerCase()}`;
      }
  } catch (e) {
      console.warn(`Could not parse raw URL extension for ${photoId}, defaulting to .jpg. Error: ${e.message}`);
  }

  const imageFileName = `${photoId}${extension}`;
  const r2ObjectKey = `${category}/${imageFileName}`;
  const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`; // Uses config.r2PublicUrlPrefix

  console.log(`Downloading RAW image from: ${rawUrl}`);
  const imageResponse = await fetch(rawUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`);
  }
  // Ensure response body exists before converting
  if (!imageResponse.body) {
      throw new Error(`No response body received for image ${photoId}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`;
  console.log(`RAW image downloaded. Size: ${Math.round(imageBuffer.length / 1024)} KB, Type: ${contentType}`);

  // Uses uploadImage imported from r2.mjs
  await uploadImage(r2ObjectKey, imageBuffer, contentType);

  const metadataItem = {
    ...photoData, // Spread original Unsplash data
    photo_id: photoId, // Ensure primary key is set
    r2_object_key: r2ObjectKey,
    r2_public_url: r2PublicUrl,
    sync_timestamp: new Date().toISOString(),
    image_category: category,
    downloaded_size: 'raw'
  };

  // Uses saveMetadata imported from dynamodb.mjs
  await saveMetadata(metadataItem);

  return { photo_id: photoId, r2_object_key: r2ObjectKey };
}
