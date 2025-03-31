// /home/admin/imgu/sync-lambda/clear_data.mjs (Updated to clear sync control table)
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
// 导入 DeleteItemCommand
import { DynamoDBClient, ScanCommand, BatchWriteItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import process from 'node:process';
import * as readline from 'node:readline/promises';

// --- 配置 (从环境变量读取) ---
const config = {
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME, // images_metadata table
  // 新增: 读取 sync_control 表名
  dynamoDbSyncControlTableName: process.env.DYNAMODB_SYNC_CONTROL_TABLE_NAME,
  awsRegion: process.env.AWS_REGION || 'us-west-2',
  // 新增: 定义要删除的 syncType key
  syncTypeToDelete: 'UNSPLASH_OLDEST_SYNC',
};

// 更新必需的环境变量列表
const requiredEnvVars = [
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL', 'DYNAMODB_TABLE_NAME', 'DYNAMODB_SYNC_CONTROL_TABLE_NAME' // 添加检查
];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  console.error(`错误：缺少必要的环境变量: ${missingEnvVars.join(', ')}`);
  console.error('请在运行脚本前设置这些环境变量。');
  process.exit(1);
}

// --- 初始化 AWS 客户端 ---
const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2EndpointUrl,
  credentials: { accessKeyId: config.r2AccessKeyId, secretAccessKey: config.r2SecretAccessKey },
});
const ddbClient = new DynamoDBClient({ region: config.awsRegion });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 辅助函数 ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 清理 R2 函数 (保持不变) ---
async function clearR2Bucket() { /* ... (代码保持不变) ... */ }

// --- 带重试的 DynamoDB 批量写入函数 (保持不变) ---
async function sendBatchWriteWithRetry(tableName, deleteRequests, maxRetries = 5, initialDelayMs = 200) { /* ... (代码保持不变) ... */ }

// --- 清理 DynamoDB 元数据表函数 (保持不变, 操作 config.dynamoDbTableName) ---
async function clearDynamoDBMetadataTable() {
    console.log(`准备清空 DynamoDB 元数据表: ${config.dynamoDbTableName}...`);
    let itemCount = 0;
    let lastEvaluatedKey = undefined;
    let allBatchesSucceeded = true;
    do {
        const scanParams = { TableName: config.dynamoDbTableName, ProjectionExpression: 'photo_id', ExclusiveStartKey: lastEvaluatedKey };
        const scanCommand = new ScanCommand(scanParams);
        let scanResponse;
        try { scanResponse = await ddbDocClient.send(scanCommand); }
        catch(error) { console.error(`扫描 DynamoDB 元数据表时出错: ${error.message}`); throw error; }

        if (!scanResponse.Items || scanResponse.Items.length === 0) {
            if(lastEvaluatedKey === undefined) console.log('DynamoDB 元数据表已经是空的。');
            else console.log('没有更多 DynamoDB 元数据项目了。');
            break;
        }
        const itemsToDelete = scanResponse.Items;
        itemCount += itemsToDelete.length;
        console.log(`找到 ${itemsToDelete.length} 个元数据项目准备删除 (总计扫描到 ${itemCount})...`);
        for (let i = 0; i < itemsToDelete.length; i += 25) {
            const batch = itemsToDelete.slice(i, i + 25);
            const deleteRequests = batch.map(item => ({ DeleteRequest: { Key: { photo_id: item.photo_id } } }));
            const batchSuccess = await sendBatchWriteWithRetry(config.dynamoDbTableName, deleteRequests);
            if (!batchSuccess) { allBatchesSucceeded = false; console.error("一个或多个元数据删除批次在重试后仍然失败，可能未完全清空。"); }
        }
        lastEvaluatedKey = scanResponse.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (allBatchesSucceeded) console.log(`DynamoDB 元数据表 ${config.dynamoDbTableName} 清理完成。共扫描到约 ${itemCount} 个项目并尝试删除。`);
    else console.error(`DynamoDB 元数据表 ${config.dynamoDbTableName} 清理过程中遇到错误或未完全处理，请检查日志。`);
    return allBatchesSucceeded;
}


// --- 新增：清理 DynamoDB 同步控制表函数 ---
async function clearSyncControlTable() {
    console.log(`准备清理 DynamoDB 同步控制表: ${config.dynamoDbSyncControlTableName} 中的 '${config.syncTypeToDelete}' 记录...`);
    const deleteParams = {
        TableName: config.dynamoDbSyncControlTableName,
        Key: {
            syncType: config.syncTypeToDelete // 指定要删除的项的主键
        }
        // 可以添加 ConditionExpression 来确保只在特定条件下删除，但对于清理脚本通常不需要
    };
    const deleteCommand = new DeleteItemCommand(deleteParams);
    try {
        await ddbDocClient.send(deleteCommand);
        console.log(`已成功发送删除 '${config.syncTypeToDelete}' 记录的请求 (如果记录存在)。`);
        return true;
    } catch (error) {
        // DeleteItem 在项目不存在时不会报错，但其他错误需要处理
        console.error(`删除 DynamoDB 同步控制记录时出错: ${error.message}`);
        // 根据需要决定是否认为这是一个失败
        return false; // 标记为失败以便在主函数中报告
    }
}
// --- 结束新增 ---


// --- 主执行函数 (更新提示信息并调用新函数) ---
async function main() {
    console.log('--- 数据清理脚本 ---');
    console.log(`将要清空 R2 存储桶: ${config.r2BucketName}`);
    console.log(`将要清空 DynamoDB 元数据表: ${config.dynamoDbTableName}`);
    // 更新提示
    console.log(`将要清理 DynamoDB 同步控制表: ${config.dynamoDbSyncControlTableName} 中的 '${config.syncTypeToDelete}' 记录`);
    console.warn('警告：这是一个破坏性操作，将删除相关数据且无法恢复！');
    let answer = '';
    try { answer = await rl.question('你确定要继续吗？ (输入 "yes" 确认): '); }
    catch (error) { console.error("读取用户输入时出错:", error); rl.close(); process.exit(1); }

    if (answer.toLowerCase() === 'yes') {
        console.log('开始清理...');
        let r2Success = false;
        let metadataDbSuccess = false;
        let syncDbSuccess = false; // 新增状态变量

        try {
            // Step 1: Clear R2
            await clearR2Bucket();
            r2Success = true;

            // Step 2: Clear Metadata Table
            metadataDbSuccess = await clearDynamoDBMetadataTable();

            // Step 3: Clear Sync Control Table Entry
            syncDbSuccess = await clearSyncControlTable(); // 调用新函数

            // 检查所有步骤是否成功
            if (r2Success && metadataDbSuccess && syncDbSuccess) {
                console.log('\n所有数据清理完毕！');
            } else {
                console.error('\n数据清理过程中遇到问题，请检查以上日志！');
                process.exitCode = 1; // 设置退出码为 1 表示有错误
            }
        } catch (error) {
            console.error('\n清理过程中发生严重错误:', error);
            process.exitCode = 1;
        }
    } else {
        console.log('操作已取消。');
    }
    rl.close();
}

main();

// Helper function clearR2Bucket (pasted for completeness, assuming it exists from file upload)
async function clearR2Bucket() {
    console.log(`准备清空 R2 存储桶: ${config.r2BucketName}...`);
    let objectCount = 0;
    let continuationToken = undefined;
    let truncated = true;
    while(truncated) {
        const listParams = { Bucket: config.r2BucketName, ContinuationToken: continuationToken };
        const listCommand = new ListObjectsV2Command(listParams);
        let listResponse;
        try { listResponse = await s3Client.send(listCommand); }
        catch (error) { console.error(`列出 R2 对象时出错: ${error.message}`); throw error; }
        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            if (continuationToken === undefined) console.log('R2 存储桶已经是空的。');
            else console.log('没有更多 R2 对象了。');
            truncated = false; continue;
        }
        const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
        objectCount += objectsToDelete.length;
        console.log(`找到 ${objectsToDelete.length} 个对象准备删除 (总计 ${objectCount})...`);
        // R2 批量删除限制是 1000 个
        for (let i = 0; i < objectsToDelete.length; i += 1000) {
            const batch = objectsToDelete.slice(i, i + 1000);
            const deleteParams = { Bucket: config.r2BucketName, Delete: { Objects: batch } };
            const deleteCommand = new DeleteObjectsCommand(deleteParams);
            try {
                const deleteResult = await s3Client.send(deleteCommand);
                console.log(`已发送删除请求 ${batch.length} 个对象...`);
                if (deleteResult.Errors && deleteResult.Errors.length > 0) console.warn('删除 R2 对象时遇到错误:', deleteResult.Errors);
            } catch (deleteError) { console.error(`发送批量删除 R2 对象请求时出错: ${deleteError.message}`); }
            // 考虑添加短暂 sleep 防止限流？对于清理脚本可能不需要。
        }
        truncated = listResponse.IsTruncated; continuationToken = listResponse.NextContinuationToken;
    }
    console.log(`R2 存储桶 ${config.r2BucketName} 清理完成，共处理约 ${objectCount} 个对象。`);
}

// Helper function sendBatchWriteWithRetry (pasted for completeness, assuming it exists from file upload)
async function sendBatchWriteWithRetry(tableName, deleteRequests, maxRetries = 5, initialDelayMs = 200) {
    if (!deleteRequests || deleteRequests.length === 0) return true;
    let currentRequests = [...deleteRequests];
    let attempts = 0;
    let delayMs = initialDelayMs;
    let overallSuccess = true;
    while (currentRequests.length > 0 && attempts < maxRetries) {
        attempts++;
        const batchWriteParams = { RequestItems: { [tableName]: currentRequests } };
        const batchWriteCommand = new BatchWriteItemCommand(batchWriteParams);
        try {
            console.log(`(尝试 #${attempts}) 发送删除请求 ${currentRequests.length} 个项目到 ${tableName}...`);
            const result = await ddbDocClient.send(batchWriteCommand);
            if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0 && result.UnprocessedItems[tableName]) {
                currentRequests = result.UnprocessedItems[tableName];
                console.warn(`警告：表 ${tableName} 有 ${currentRequests.length} 个项目未被处理，将在 ${delayMs}ms 后重试...`);
                await sleep(delayMs);
                delayMs = Math.min(delayMs * 2, 5000); // Exponential backoff with max delay
            } else { currentRequests = []; console.log(`批处理 ${tableName} 成功 (尝试 #${attempts})。`); }
        } catch (error) {
            if (error.name === 'ProvisionedThroughputExceededException' || error.name === 'ThrottlingException') {
                console.warn(`警告：表 ${tableName} 遇到限流 (尝试 #${attempts})，将在 ${delayMs}ms 后重试...`);
                await sleep(delayMs);
                delayMs = Math.min(delayMs * 2, 5000);
            } else {
                console.error(`发送批量删除 DynamoDB 项目 (${tableName}) 时遇到非限流错误 (尝试 #${attempts}):`, error);
                overallSuccess = false; currentRequests = []; // Stop retrying on other errors
            }
        }
    }
    if (currentRequests.length > 0) { console.error(`错误：表 ${tableName} 在 ${maxRetries} 次尝试后，仍有 ${currentRequests.length} 个项目未能删除。`); overallSuccess = false; }
    return overallSuccess;
}
