// /home/admin/imgu/api-lambda/config.mjs (Updated)
import process from 'node:process';

const config = {
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  // 新增: 从环境变量读取 Step Functions State Machine 的 ARN
  syncStateMachineArn: process.env.SYNC_STATE_MACHINE_ARN,
};

const requiredEnvVars = ['DYNAMODB_TABLE_NAME', 'ALLOWED_ORIGIN', 'SYNC_STATE_MACHINE_ARN']; // 添加 ARN 检查
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
   // 如果允许 ALLOWED_ORIGIN 为 *，则只在其他缺失时报错
   const criticalMissing = missingEnvVars.filter(v => v !== 'ALLOWED_ORIGIN' || process.env.ALLOWED_ORIGIN !== '*');
   if(criticalMissing.length > 0) {
       const errorMessage = `Missing required environment variables: ${criticalMissing.join(', ')}`;
       console.error(errorMessage);
       throw new Error(errorMessage);
   } else if (!process.env.ALLOWED_ORIGIN) {
        console.warn(`Warning: ALLOWED_ORIGIN not set, defaulting to '*'. Not recommended for production.`);
   }
}
// 单独检查 ARN 是否存在，因为它很关键
if (!config.syncStateMachineArn) {
    const errorMessage = `Missing required environment variable: SYNC_STATE_MACHINE_ARN`;
    console.error(errorMessage);
    throw new Error(errorMessage);
}


export default config;
