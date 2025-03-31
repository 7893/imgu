// /home/admin/imgu/sync-lambda/config.mjs (Updated for SSM Parameters)
import process from 'node:process';

// --- SSM Parameter Names ---
const ssmParamNames = {
  r2AccessKeyId: "/imgu/r2/access_key_id",
  r2SecretAccessKey: "/imgu/r2/secret_access_key",
  unsplashApiKey: "/imgu/unsplash/api_key",
};
// --- End SSM Parameter Names ---

const config = {
  // 从环境变量读取非敏感配置
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  r2PublicUrlPrefix: process.env.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, ''),
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  dynamoDbSyncControlTableName: process.env.DYNAMODB_SYNC_CONTROL_TABLE_NAME,

  // 其他配置
  defaultCategory: 'uncategorized',
  unsplashApiUrl: 'https://api.unsplash.com',
  photosToFetch: 5,

  // 导出 SSM 参数名供其他模块使用
  ssmParamNames: ssmParamNames,
};

// 检查必需的 *环境变量* 是否存在 (移除了密钥检查)
const requiredEnvVars = [
  // 'UNSPLASH_API_KEY', // Removed
  // 'R2_ACCESS_KEY_ID', // Removed
  // 'R2_SECRET_ACCESS_KEY', // Removed
  'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL',
  'R2_PUBLIC_URL_PREFIX',
  'DYNAMODB_TABLE_NAME',
  'DYNAMODB_SYNC_CONTROL_TABLE_NAME',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  const errorMessage = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  console.error(errorMessage);
  throw new Error(errorMessage);
}

export default config;
