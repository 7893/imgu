// index.mjs
// testing github actions workflow
import config from './config.mjs';
import { fetchPhotos } from './unsplash.mjs';
import { uploadImage } from './r2.mjs';
import { saveMetadata } from './dynamodb.mjs';

/**
 * AWS Lambda Handler Function
 */
export const handler = async (event) => {
  console.log('Starting Unsplash sync process...');
  const startTime = Date.now();
  let processedCount = 0;
  let errorCount = 0;

  try {
    // 1. 从 Unsplash 获取照片数据
    const photos = await fetchPhotos();

    if (!Array.isArray(photos) || photos.length === 0) {
      console.log('No photos fetched from Unsplash.');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No photos fetched, sync finished.' }),
      };
    }

    // 2. 循环处理每张照片
    for (const photoData of photos) {
      const photoId = photoData.id;
      console.log(`\nProcessing photo ID: ${photoId}`);

      try {
        // 确定类别 (使用第一个 topic 的 slug，或默认值)
        const category = photoData.topics?.[0]?.slug || config.defaultCategory;
        console.log(`Determined category: ${category}`);

        // 构建 R2 对象键和文件名
        const imageFileName = `${photoId}.jpg`; // 假设都保存为 jpg
        const r2ObjectKey = `${category}/${imageFileName}`;
        const r2PublicUrl = `${config.r2PublicUrlPrefix}/${r2ObjectKey}`;

        // 检查图片是否已存在于 DynamoDB (可选，避免重复处理 - 这里简化，先不检查)
        // TODO: Optionally add DynamoDB check here using photoId

        // 3. 下载图片内容 (选择合适的尺寸, e.g., regular)
        const imageUrl = photoData.urls?.regular;
        if (!imageUrl) {
            console.warn(`Skipping photo ${photoId}: Missing regular URL.`);
            errorCount++;
            continue;
        }
        console.log(`Downloading image from: ${imageUrl}`);
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
          console.warn(`Skipping photo ${photoId}: Failed to download image (${imageResponse.status})`);
          errorCount++;
          continue;
        }
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
        console.log(`Image downloaded. Size: ${Math.round(imageBuffer.length / 1024)} KB, Type: ${contentType}`);

        // 4. 上传图片到 R2
        await uploadImage(r2ObjectKey, imageBuffer, contentType);

        // 5. 准备并保存元数据到 DynamoDB
        // 包含所有 Unsplash 数据，并添加我们自己的字段
        const metadataItem = {
          ...photoData, // 展开所有从 Unsplash 获取的原始数据
          photo_id: photoId, // 主键
          r2_object_key: r2ObjectKey, // R2 中的路径
          r2_public_url: r2PublicUrl, // R2 的公开 URL
          sync_timestamp: new Date().toISOString(), // 同步时间戳
          image_category: category // 保存确定的类别
          // 注意: DynamoDB 不支持空字符串，需要处理，但 DocumentClient 会处理一些
          // 如果 Unsplash 数据中有值为 null 或空字符串的字段，可能需要清理
        };

        // 移除不支持的空字符串值 (如果需要更严格的清理)
        // for (const key in metadataItem) {
        //   if (metadataItem[key] === '') {
        //      delete metadataItem[key]; // 或者设置为 null，取决于你的需求
        //   }
        // }

        await saveMetadata(metadataItem);

        processedCount++;

      } catch (photoError) {
        console.error(`Failed to process photo ${photoId}:`, photoError);
        errorCount++;
        // 选择继续处理下一张照片
      }
    }

    const duration = Date.now() - startTime;
    console.log(`\nSync process finished in ${duration}ms.`);
    console.log(`Successfully processed: ${processedCount}, Errors: ${errorCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
          message: `Sync finished. Processed: ${processedCount}, Errors: ${errorCount}`,
          duration_ms: duration
      }),
    };

  } catch (error) {
    console.error('Critical error during sync process:', error);
    const duration = Date.now() - startTime;
    return {
      statusCode: 500,
      body: JSON.stringify({
          message: 'Sync failed due to critical error.',
          error: error.message,
          duration_ms: duration
      }),
    };
  }
};
