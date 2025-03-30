// /home/admin/imgu/api-lambda/config.mjs (Updated for Sync State)
import process from 'node:process';

const config = {
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME, // 图片元数据表
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  syncStateMachineArn: process.env.SYNC_STATE_MACHINE_ARN,
  // 新增: 同步控制表名
  dynamoDbSyncControlTableName: process.env.DYNAMODB_SYNC_CONTROL_TABLE_NAME,
};

// 添加新环境变量到检查列表
const requiredEnvVars = [
    'DYNAMODB_TABLE_NAME',
    'ALLOWED_ORIGIN',
    'SYNC_STATE_MACHINE_ARN',
    'DYNAMODB_SYNC_CONTROL_TABLE_NAME' // 新增检查
];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
   const criticalMissing = missingEnvVars.filter(v => v !== 'ALLOWED_ORIGIN' || process.env.ALLOWED_ORIGIN !== '*');
   if(criticalMissing.length > 0) {
       const errorMessage = `Missing required environment variables: ${criticalMissing.join(', ')}`;
       console.error(errorMessage);
       throw new Error(errorMessage);
   } else if (!process.env.ALLOWED_ORIGIN) {
        console.warn(`Warning: ALLOWED_ORIGIN not set, defaulting to '*'. Not recommended for production.`);
   }
}

// 再次单独检查新增的关键环境变量
if (!config.dynamoDbSyncControlTableName) {
    const errorMessage = `Missing required environment variable: DYNAMODB_SYNC_CONTROL_TABLE_NAME`;
    console.error(errorMessage);
    throw new Error(errorMessage);
}
if (!config.syncStateMachineArn) {
    const errorMessage = `Missing required environment variable: SYNC_STATE_MACHINE_ARN`;
    console.error(errorMessage);
    throw new Error(errorMessage);
}


export default config;
