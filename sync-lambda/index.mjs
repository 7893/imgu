// /home/admin/imgu/sync-lambda/index.mjs (Cleaned Syntax)
import config from './config.mjs';
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata } from './dynamodb.mjs';
import process from 'node:process';

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
        return { photos };

      case 'CHECK_PHOTO_EXISTS':
        if (!payload.photo_id) {
            throw new Error('Missing photo_id for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(payload.photo_id);
        return { exists };

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
    throw error;
  }
};

// --- Action Handlers ---

async function handleFetchPage(page, perPage) {
  console.log(`Workspaceing Unsplash page <span class="math-inline">\{page\}, perPage\=</span>{perPage}, orderBy=oldest`); // Corrected typo
  const unsplashApiUrl = `<span class="math-inline">\{config\.unsplashApiUrl\}/photos?page\=</span>{page}&per_page=${perPage}&order_by=oldest`;
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

  const category = photoData.topics?.[0]?.slug || config.defaultCategory;

  const rawUrl = photoData.urls?.raw;
  if (!rawUrl) {
      throw new Error(`Missing raw URL for photo ${photoId}`);
  }
  let extension = '.jpg';
  try {
      const urlObj = new URL(rawUrl);
      const fmMatch = urlObj.searchParams.get('fm');
      if (fmMatch && ['jpg', 'png', 'gif', 'webp'].includes(fmMatch)) {
          extension = `.${fmMatch}`;
      }
  } catch (e) { console.warn("Could not parse raw URL extension, defaulting to .jpg"); }

  const imageFileName = `<span class="math-inline">\{photoId\}</span>{extension}`;
  const r2ObjectKey = `<span class="math-inline">\{category\}/</span>{imageFileName}`;
  const r2PublicUrl = `<span class="math-inline">\{config\.r2PublicUrlPrefix\}/</span>{r2ObjectKey}`;

  console.log(`Downloading RAW image from: ${rawUrl}`);
  const imageResponse = await fetch(rawUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download RAW image <span class="math-inline">\{photoId\} \(</span>{imageResponse.status})`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`;
  console.log(`RAW image downloaded. Size: ${Math.round(imageBuffer.length / 1024)} KB, Type: ${contentType}`);

  await uploadImage(r2ObjectKey, imageBuffer, contentType);

  const metadataItem = {
    ...photoData,
    photo_id: photoId,
    r2_object_key: r2ObjectKey,
    r2_public_url: r2PublicUrl,
    sync_timestamp: new Date().toISOString(),
    image_category: category,
    downloaded_size: 'raw'
  };
  await saveMetadata(metadataItem);

  return { photo_id: photoId, r2_object_key: r2ObjectKey };
}
