// config.mjs
import process from 'node:process'; // 显式导入 process

// 从环境变量读取配置
const config = {
  unsplashAccessKey: process.env.UNSPLASH_API_KEY,
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  r2PublicUrlPrefix: process.env.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, ''), // 移除末尾斜杠(如果有)
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  // AWS_REGION 由 Lambda 运行时自动提供: process.env.AWS_REGION
  defaultCategory: 'uncategorized', // 硬编码默认类别
  unsplashApiUrl: 'https://api.unsplash.com', // Unsplash API 基础 URL
  photosToFetch: 5 // 每次同步获取的照片数量
};

// 检查必需的环境变量是否存在
const requiredEnvVars = [
  'UNSPLASH_API_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL',
  'R2_PUBLIC_URL_PREFIX',
  'DYNAMODB_TABLE_NAME',
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  const errorMessage = `Missing required environment variables: ${missingEnvVars.join(', ')}`;
  console.error(errorMessage);
  throw new Error(errorMessage);
}

export default config;
