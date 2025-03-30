// config.mjs
import process from 'node:process';

// 从环境变量读取配置
const config = {
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  // ALLOWED_ORIGIN 控制 CORS 响应头允许哪个来源访问
  // 在 Lambda 环境变量中设置，例如 https://your-vercel-app.vercel.app
  // 或者在测试时设置为 '*' (允许所有来源，不推荐用于生产)
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*', // 默认为 '*'，仅供测试
  // AWS_REGION 由 Lambda 运行时自动提供: process.env.AWS_REGION
};

// 检查必需的环境变量
const requiredEnvVars = ['DYNAMODB_TABLE_NAME', 'ALLOWED_ORIGIN'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  // 注意：允许 ALLOWED_ORIGIN 为空，使用默认值 '*'，所以只在表名缺失时抛错
   if (!config.dynamoDbTableName) {
       const errorMessage = `Missing required environment variable: DYNAMODB_TABLE_NAME`;
       console.error(errorMessage);
       throw new Error(errorMessage);
   } else {
       console.warn(`Warning: ALLOWED_ORIGIN environment variable not set. Defaulting to '*' (allow all origins). This is not recommended for production.`);
   }
}

export default config;