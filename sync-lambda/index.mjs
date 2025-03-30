// /home/admin/imgu/sync-lambda/index.mjs (Refactored for Step Functions)
import config from './config.mjs';
import { fetchUnsplashPage } from './unsplash.mjs'; // 假设 unsplash.mjs 已有此函数或需创建
import { uploadImage } from './r2.mjs';
import { getDynamoDBItem, saveMetadata } from './dynamodb.mjs'; // 假设 dynamodb.mjs 添加了 getItem 功能

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
        // 输入: payload = { currentPage, batchSize }
        // 输出: { photos: [...] } 或抛出错误
        if (payload.currentPage === undefined || payload.batchSize === undefined) {
            throw new Error('Missing currentPage or batchSize for FETCH_UNSPLASH_PAGE');
        }
        const photos = await handleFetchPage(payload.currentPage, payload.batchSize);
        return { photos }; // 返回照片列表

      case 'CHECK_PHOTO_EXISTS':
        // 输入: payload = { photo_id }
        // 输出: { exists: true/false } 或抛出错误
        if (!payload.photo_id) {
            throw new Error('Missing photo_id for CHECK_PHOTO_EXISTS');
        }
        const exists = await handleCheckExists(payload.photo_id);
        return { exists };

      case 'DOWNLOAD_AND_STORE':
        // 输入: payload = { photoData } (完整的 Unsplash 照片对象)
        // 输出: { success: true, photo_id: ..., r2_object_key: ... } 或抛出错误
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
    // 让错误冒泡给 Step Functions 处理
    throw error;
  }
};

// --- Action Handlers ---

async function handleFetchPage(page, perPage) {
  console.log(`Workspaceing Unsplash page ${page}, perPage=${perPage}, orderBy=oldest`);
  // 注意: 需要确保 unsplash.mjs 中的 fetchPhotos 支持 page, per_page, order_by 参数
  // 或者在这里直接调用 fetch API
  const unsplashApiUrl = `${config.unsplashApiUrl}/photos?page=${page}&per_page=${perPage}&order_by=oldest`;
  const response = await fetch(unsplashApiUrl, {
      headers: {
          'Authorization': `Client-ID ${config.unsplashAccessKey}`,
          'Accept-Version': 'v1'
      }
  });
  if (!response.ok) {
      throw new Error(`Unsplash API Error (${response.status}) fetching page ${page}`);
  }
  const photos = await response.json();
  console.log(`Workspaceed ${photos.length} photos for page ${page}.`);
  return photos;
}

async function handleCheckExists(photoId) {
  console.log(`Checking if photo ${photoId} exists in DynamoDB...`);
  // 需要在 dynamodb.mjs 中实现 getDynamoDBItem 函数
  const existingItem = await getDynamoDBItem(photoId);
  const exists = !!existingItem; // 如果找到则为 true，否则为 false
  console.log(`Photo ${photoId} exists: ${exists}`);
  return exists;
}

async function handleDownloadAndStore(photoData) {
  const photoId = photoData.id;
  console.log(`Processing download & store for photo ID: ${photoId}`);

  // 确定类别
  const category = photoData.topics?.[0]?.slug || config.defaultCategory;

  // 构建 R2 路径 (原始图，后缀可能不是 .jpg)
  // 尝试从 URL 获取原始后缀，否则默认为 .jpg
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

  const imageFileName = `${photoId}${extension}`;
  const r2ObjectKey = `${category}/${imageFileName}`;
  const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`;

  // 下载 RAW 图片
  console.log(`Downloading RAW image from: ${rawUrl}`);
  const imageResponse = await fetch(rawUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download RAW image ${photoId} (${imageResponse.status})`);
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const contentType = imageResponse.headers.get('content-type') || `image/${extension.substring(1)}`;
  console.log(`RAW image downloaded. Size: ${Math.round(imageBuffer.length / 1024)} KB, Type: ${contentType}`);

  // 上传到 R2
  await uploadImage(r2ObjectKey, imageBuffer, contentType);

  // 准备并保存元数据到 DynamoDB
  const metadataItem = {
    ...photoData, // 保存所有原始 Unsplash 数据
    photo_id: photoId,
    r2_object_key: r2ObjectKey,
    r2_public_url: r2PublicUrl,
    sync_timestamp: new Date().toISOString(),
    image_category: category,
    downloaded_size: 'raw' // 标记下载的是原始尺寸
  };
  await saveMetadata(metadataItem);

  return { photo_id: photoId, r2_object_key: r2ObjectKey };
}


// --- 需要确保 dynamodb.mjs 也更新了 ---
// 需要在 dynamodb.mjs 中添加一个类似 getDynamoDBItem 的函数:
/*
// dynamodb.mjs (添加部分)
import { GetCommand } from "@aws-sdk/lib-dynamodb"; // 或者 @aws-sdk/client-dynamodb

async function getDynamoDBItem(photoId) {
  const getParams = {
    TableName: config.dynamoDbTableName,
    Key: {
      photo_id: photoId,
    },
  };
  try {
    const command = new GetCommand(getParams);
    const result = await ddbDocClient.send(command);
    return result.Item; // 如果找到返回 Item 对象，否则返回 undefined
  } catch (error) {
    console.error(`Error getting item ${photoId} from DynamoDB:`, error);
    throw error;
  }
}

// 别忘了导出
export { saveMetadata, getDynamoDBItem };
*/
