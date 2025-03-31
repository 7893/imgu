// /home/admin/imgu/sync-lambda/r2.mjs (Updated for SSM secrets & lazy client init)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import config from './config.mjs';
// 导入获取密钥的函数
import { getSecrets } from './secrets.mjs';

// 将 S3 客户端初始化推迟到第一次使用时
let s3Client = null;

async function initializeS3Client() {
    if (!s3Client) {
        console.log("Initializing S3 Client for R2...");
        try {
            const secrets = await getSecrets(); // 获取密钥
            if (!secrets || !secrets.r2AccessKeyId || !secrets.r2SecretAccessKey) {
                 throw new Error("R2 credentials not loaded from secrets helper.");
            }
            s3Client = new S3Client({
                region: 'auto', // R2 is region-agnostic
                endpoint: config.r2EndpointUrl,
                credentials: {
                    accessKeyId: secrets.r2AccessKeyId,
                    secretAccessKey: secrets.r2SecretAccessKey,
                },
            });
            console.log("S3 Client initialized successfully.");
        } catch (error) {
             console.error("Failed to initialize S3 client:", error);
             throw error; // Propagate error
        }
    }
    return s3Client;
}


/**
 * 上传图片到 Cloudflare R2
 * @param {string} key - R2 中的对象键 (包含路径, e.g., 'nature/photo123.jpg')
 * @param {Buffer} body - 图片内容的 Buffer
 * @param {string} contentType - 图片的 Mime 类型 (e.g., 'image/jpeg')
 * @returns {Promise<void>}
 */
async function uploadImage(key, body, contentType) {
  // 确保客户端已初始化
  const client = await initializeS3Client();
  if (!client) {
      throw new Error("S3 Client could not be initialized.");
  }

  console.log(`Uploading to R2: Bucket=${config.r2BucketName}, Key=${key}, ContentType=${contentType}`);

  const putObjectParams = {
    Bucket: config.r2BucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  try {
    const command = new PutObjectCommand(putObjectParams);
    await client.send(command); // 使用获取到的 client
    console.log(`Successfully uploaded ${key} to R2.`);
  } catch (error) {
    console.error(`Error uploading ${key} to R2:`, error);
    throw error;
  }
}

export { uploadImage };
