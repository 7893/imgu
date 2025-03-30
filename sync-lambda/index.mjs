import config from './config.mjs';
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata } from './dynamodb.mjs';
import process from 'node:process';

function sanitizeFolderName(name) {
  if (!name || typeof name !== 'string') {
    return config.defaultCategory || 'uncategorized';
  }
  return name
    .toLowerCase()
    .replace(/[\s\/\?%*:|"<>\\.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}

function determineCategory(photoData) {
  if (photoData?.topics?.[0]?.slug) {
    const sanitizedSlug = sanitizeFolderName(photoData.topics[0].slug);
    if (sanitizedSlug && sanitizedSlug !== '-') return sanitizedSlug;
  }
  if (photoData?.tags && Array.isArray(photoData.tags)) {
    for (const tag of photoData.tags) {
      if (tag?.title) {
        const sanitizedTitle = sanitizeFolderName(tag.title);
        if (sanitizedTitle && sanitizedTitle !== '-') return sanitizedTitle;
      }
    }
  }
  return config.defaultCategory || 'uncategorized';
}

export const handler = async (event) => {
  console.log('Sync Lambda invoked with event:', JSON.stringify(event, null, 2));
  const action = event.action;
  const payload = event.payload || {};
  try {
    switch (action) {
      case 'FETCH_UNSPLASH_PAGE':
        if (payload.currentPage === undefined || payload.batchSize === undefined) {
            throw new Error('Missing currentPage or batchSize for FETCH_UNSPLASH_PAGE');
        }
        const photos = await handleFetchPage(payload.currentPage, payload.batchSize);
        return { photos: photos };
      case 'CHECK_PHOTO_EXISTS':
        if (!payload.photo_id) {
            throw new Error('Missing photo_id for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(payload.photo_id);
        return { exists: exists };
      case 'DOWNLOAD_AND_STORE':
         if (!payload.photoData || !payload.photoData.id) {
            throw new Error('Missing photoData for DOWNLOAD_AND_STORE');
        }
        const result = await handleDownloadAndStore(payload.photoData);
        return { success: true, ...result };
      default:
        console.error('Unknown action requested:', action);
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error(`Error executing action ${action}:`, error);
    throw new Error(`Action ${action} failed: ${error.message}`);
  }
};

async function handleFetchPage(page, perPage) {
  // --- 修改点：将 orderBy=oldest 改为 orderBy=latest ---
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=latest`); // 更新日志
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=latest`; // <-- 修改这里
  // --- 修改点结束 ---
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
  console.log(`Workspaceed ${photos.length} photos for page ${page}.`);
  return photos;
}

async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  const existingItem = await getDynamoDBItem(photoId);
  const exists = !!existingItem;
  console.log(`Photo ${photoId} exists: ${exists}`);
  return exists;
}

async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id;
  console.log(`Processing download & store for photo ID: ${photoId}`);
  const category = determineCategory(photoData);
  console.log(`Determined category: ${category}`);
  const rawUrl = photoData.urls?.raw;
  if (!rawUrl) {
      throw new Error(`Missing raw URL for photo ${photoId}`);
  }
  let extension = '.jpg';
  try {
      const urlObj = new URL(rawUrl);
      const fmMatch = urlObj.searchParams.get('fm');
      if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch.toLowerCase())) {
          extension = `.${fmMatch.toLowerCase()}`;
      }
  } catch (e) { console.warn(`Could not parse raw URL extension for ${photoId}, defaulting to .jpg. Error: ${e.message}`); }
  const imageFileName = `${photoId}${extension}`;
  const r2ObjectKey = `${category}/${imageFileName}`;
  const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`;
  console.log(`Downloading RAW image from: ${rawUrl}`);
  const imageResponse = await fetch(rawUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`);
  }
  if (!imageResponse.body) {
      throw new Error(`No response body received for image ${photoId}`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`;
  const fileSizeInBytes = imageBuffer.length;
  console.log(`RAW image downloaded. Size: ${Math.round(fileSizeInBytes / 1024)} KB, Type: ${contentType}`);
  await uploadImage(r2ObjectKey, imageBuffer, contentType);
  const metadataItem = {
    ...photoData,
    photo_id: photoId,
    r2_object_key: r2ObjectKey,
    r2_public_url: r2PublicUrl,
    sync_timestamp: new Date().toISOString(),
    image_category: category,
    downloaded_size: 'raw',
    r2_object_size_bytes: fileSizeInBytes
  };
  await saveMetadata(metadataItem);
  return { photo_id: photoId, r2_object_key: r2ObjectKey, size: fileSizeInBytes };
}
