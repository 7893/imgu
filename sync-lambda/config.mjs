// /home/admin/imgu/sync-lambda/config.mjs (Updated for Sync State)
import process from 'node:process';

const config = {
  unsplashAccessKey: process.env.UNSPLASH_API_KEY,
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  r2PublicUrlPrefix: process.env.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, ''),
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME, // 图片元数据表
  // 新增: 同步控制表名
  dynamoDbSyncControlTableName: process.env.DYNAMODB_SYNC_CONTROL_TABLE_NAME,
  defaultCategory: 'uncategorized',
  unsplashApiUrl: 'https://api.unsplash.com',
  photosToFetch: 5 // 保持不变，可以从 SFN 输入获取（如果需要）
};

// 添加新环境变量到检查列表
const requiredEnvVars = [
  'UNSPLASH_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL',
  'R2_PUBLIC_URL_PREFIX',
  'DYNAMODB_TABLE_NAME',
  'DYNAMODB_SYNC_CONTROL_TABLE_NAME', // 新增检查
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  const errorMessage = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  console.error(errorMessage);
  throw new Error(errorMessage);
}

// 单独检查新增的关键环境变量
if (!config.dynamoDbSyncControlTableName) {
    const errorMessage = `Missing required environment variable: DYNAMODB_SYNC_CONTROL_TABLE_NAME`;
    console.error(errorMessage);
    throw new Error(errorMessage);
}

export default config;
