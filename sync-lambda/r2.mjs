// r2.mjs
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import config from './config.mjs';

// 初始化 R2 (S3 兼容) 客户端
// R2 对 region 不敏感，但 SDK 需要一个值，"auto" 通常适用于 R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2EndpointUrl,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

/**
 * 上传图片到 Cloudflare R2
 * @param {string} key - R2 中的对象键 (包含路径, e.g., 'nature/photo123.jpg')
 * @param {Buffer} body - 图片内容的 Buffer
 * @param {string} contentType - 图片的 Mime 类型 (e.g., 'image/jpeg')
 * @returns {Promise<void>}
 */
async function uploadImage(key, body, contentType) {
  console.log(`Uploading to R2: Bucket=${config.r2BucketName}, Key=${key}, ContentType=${contentType}`);

  const putObjectParams = {
    Bucket: config.r2BucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
    // 可以添加 ACL 控制，但对于公开访问的桶，通常不需要
    // ACL: 'public-read' // 如果桶不是默认公开读，可能需要设置
  };

  try {
    const command = new PutObjectCommand(putObjectParams);
    await s3Client.send(command);
    console.log(`Successfully uploaded ${key} to R2.`);
  } catch (error) {
    console.error(`Error uploading ${key} to R2:`, error);
    throw error; // 让错误冒泡
  }
}

export { uploadImage };