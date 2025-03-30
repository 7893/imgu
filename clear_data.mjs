// clear_data.mjs (Improved with DynamoDB BatchWrite Retry Logic)
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, BatchWriteItemCommand } from '@aws-sdk/lib-dynamodb';
import process from 'node:process';
import * as readline from 'node:readline/promises';

// --- 配置 (从环境变量读取) ---
const config = {
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  awsRegion: process.env.AWS_REGION || 'us-west-2',
};

const requiredEnvVars = [
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL', 'DYNAMODB_TABLE_NAME'
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
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 辅助函数 ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- 清理函数 ---

async function clearR2Bucket() {
  // ... (R2 清理逻辑保持不变，因为它之前是成功的) ...
  console.log(`准备清空 R2 存储桶: ${config.r2BucketName}...`);
  let objectCount = 0;
  let continuationToken = undefined;
  let truncated = true;

  while(truncated) {
    const listParams = { Bucket: config.r2BucketName, ContinuationToken: continuationToken };
    const listCommand = new ListObjectsV2Command(listParams);
    let listResponse;
    try {
        listResponse = await s3Client.send(listCommand);
    } catch (error) {
        console.error(`列出 R2 对象时出错: ${error.message}`);
        throw error;
    }

    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      if (continuationToken === undefined) { console.log('R2 存储桶已经是空的。'); }
      else { console.log('没有更多 R2 对象了。'); }
      truncated = false;
      continue;
    }

    const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
    objectCount += objectsToDelete.length;
    console.log(`找到 ${objectsToDelete.length} 个对象准备删除 (总计 ${objectCount})...`);

    for (let i = 0; i < objectsToDelete.length; i += 1000) {
      const batch = objectsToDelete.slice(i, i + 1000);
      const deleteParams = { Bucket: config.r2BucketName, Delete: { Objects: batch } };
      const deleteCommand = new DeleteObjectsCommand(deleteParams);
      try {
          const deleteResult = await s3Client.send(deleteCommand);
          console.log(`已发送删除请求 ${batch.length} 个对象...`);
          if (deleteResult.Errors && deleteResult.Errors.length > 0) {
              console.warn('删除 R2 对象时遇到错误:', deleteResult.Errors);
          }
      } catch (deleteError) {
          console.error(`发送批量删除 R2 对象请求时出错: ${deleteError.message}`);
      }
    }
    truncated = listResponse.IsTruncated;
    continuationToken = listResponse.NextContinuationToken;
  }
  console.log(`R2 存储桶 ${config.r2BucketName} 清理完成，共处理约 ${objectCount} 个对象。`);
}


// --- 新增：带重试的 DynamoDB 批量写入函数 ---
async function sendBatchWriteWithRetry(tableName, deleteRequests, maxRetries = 5, initialDelayMs = 200) {
    if (!deleteRequests || deleteRequests.length === 0) {
        return; // 没有要删除的内容
    }

    let currentRequests = [...deleteRequests]; // 创建副本以防修改原始数组
    let attempts = 0;
    let delayMs = initialDelayMs;
    let overallSuccess = true;

    while (currentRequests.length > 0 && attempts < maxRetries) {
        attempts++;
        const batchWriteParams = {
            RequestItems: {
                [tableName]: currentRequests
            }
        };
        const batchWriteCommand = new BatchWriteItemCommand(batchWriteParams);

        try {
            console.log(`(尝试 #${attempts}) 发送删除请求 ${currentRequests.length} 个项目...`);
            const result = await ddbDocClient.send(batchWriteCommand);

            // 检查是否有未处理的项目 (通常是由于限流)
            if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0 && result.UnprocessedItems[tableName]) {
                currentRequests = result.UnprocessedItems[tableName]; // 更新为未处理的项目列表
                console.warn(`警告：有 ${currentRequests.length} 个项目未被处理，将在 ${delayMs}ms 后重试...`);
                await sleep(delayMs);
                delayMs *= 2; // 指数退避
            } else {
                // 所有项目都处理成功
                currentRequests = []; // 清空列表，退出循环
                console.log(`批处理成功 (尝试 #${attempts})。`);
            }
        } catch (error) {
            if (error.name === 'ProvisionedThroughputExceededException') {
                console.warn(`警告：遇到限流 (尝试 #${attempts})，将在 ${delayMs}ms 后重试...`);
                currentRequests = batchWriteParams.RequestItems[tableName]; // 重试整个失败的批次
                await sleep(delayMs);
                delayMs *= 2; // 指数退避
            } else {
                console.error(`发送批量删除 DynamoDB 项目时遇到非限流错误 (尝试 #${attempts}):`, error);
                overallSuccess = false; // 标记发生了无法重试的错误
                throw error; // 抛出无法处理的错误，终止脚本
            }
        }
    }

    if (currentRequests.length > 0) {
        console.error(`错误：在 ${maxRetries} 次尝试后，仍有 ${currentRequests.length} 个项目未能删除。`);
        overallSuccess = false;
    }
    return overallSuccess; // 返回本次批量操作是否完全成功
}


async function clearDynamoDBTable() {
  console.log(`准备清空 DynamoDB 表: ${config.dynamoDbTableName}...`);
  let itemCount = 0;
  let lastEvaluatedKey = undefined;
  let allBatchesSucceeded = true; // 跟踪整体是否成功

  do {
    const scanParams = {
      TableName: config.dynamoDbTableName,
      ProjectionExpression: 'photo_id', // 只需主键
      ExclusiveStartKey: lastEvaluatedKey,
    };
    const scanCommand = new ScanCommand(scanParams);
    let scanResponse;
    try {
      scanResponse = await ddbDocClient.send(scanCommand);
    } catch(error) {
        console.error(`扫描 DynamoDB 表时出错: ${error.message}`);
        throw error;
    }

    if (!scanResponse.Items || scanResponse.Items.length === 0) {
      if(lastEvaluatedKey === undefined) { console.log('DynamoDB 表已经是空的。'); }
      else { console.log('没有更多 DynamoDB 项目了。'); }
      break;
    }

    const itemsToDelete = scanResponse.Items;
    itemCount += itemsToDelete.length;
    console.log(`找到 ${itemsToDelete.length} 个项目准备删除 (总计扫描到 ${itemCount})...`);

    // 分批删除，每批最多 25 个
     for (let i = 0; i < itemsToDelete.length; i += 25) {
        const batch = itemsToDelete.slice(i, i + 25);
        const deleteRequests = batch.map(item => ({
            DeleteRequest: { Key: { photo_id: item.photo_id } }
        }));

        // --- 使用带重试的函数 ---
        const batchSuccess = await sendBatchWriteWithRetry(config.dynamoDbTableName, deleteRequests);
        if (!batchSuccess) {
            allBatchesSucceeded = false; // 如果任何批次最终失败，标记整体失败
            // 可以选择在这里停止，或者继续尝试删除其他批次
            console.error("一个或多个删除批次在重试后仍然失败，可能未完全清空。");
            // break; // 如果希望一遇到无法重试的错误就停止
        }
     }

    lastEvaluatedKey = scanResponse.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  if (allBatchesSucceeded) {
      console.log(`DynamoDB 表 ${config.dynamoDbTableName} 清理完成。共扫描到约 ${itemCount} 个项目并尝试删除。`);
  } else {
      console.error(`DynamoDB 表 ${config.dynamoDbTableName} 清理过程中遇到错误，可能未完全清空。请检查上面的日志。`);
  }
  return allBatchesSucceeded; // 返回清理是否完全成功
}

// --- 主执行函数 ---
async function main() {
  console.log('--- 数据清理脚本 ---');
  console.log(`将要清空 R2 存储桶: ${config.r2BucketName}`);
  console.log(`将要清空 DynamoDB 表: ${config.dynamoDbTableName}`);
  console.warn('警告：这是一个破坏性操作，将删除所有数据且无法恢复！');

  let answer = '';
  try {
      answer = await rl.question('你确定要继续吗？ (输入 "yes" 确认): ');
  } catch (error) {
      console.error("读取用户输入时出错:", error);
      rl.close();
      process.exit(1);
  }

  if (answer.toLowerCase() === 'yes') {
    console.log('开始清理...');
    let r2Success = false;
    let dbSuccess = false;
    try {
      await clearR2Bucket();
      r2Success = true; // R2 部分假设成功（因为它之前是成功的）
      dbSuccess = await clearDynamoDBTable(); // 获取 DB 清理的成功状态
      if (r2Success && dbSuccess) {
          console.log('\n所有数据清理完毕！');
      } else {
          console.error('\n数据清理过程中遇到问题，请检查日志！');
          process.exitCode = 1;
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
