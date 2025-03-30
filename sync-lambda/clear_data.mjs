// clear_data.mjs (Corrected Imports)
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
// --- 修正后的导入 ---
// 从 @aws-sdk/client-dynamodb 导入核心客户端和命令
import { DynamoDBClient, ScanCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
// 只从 @aws-sdk/lib-dynamodb 导入文档客户端包装器
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
// --- 修正结束 ---
import process from 'node:process';
import * as readline from 'node:readline/promises'; // 用于用户确认

// --- 配置 (从环境变量读取) ---
// !! 这些环境变量需要在运行脚本前在你的 Shell 中设置好 !!
const config = {
  // 使用 process.env 读取环境变量
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  r2BucketName: process.env.R2_BUCKET_NAME,
  r2EndpointUrl: process.env.R2_ENDPOINT_URL,
  dynamoDbTableName: process.env.DYNAMODB_TABLE_NAME,
  awsRegion: process.env.AWS_REGION || 'us-west-2', // 尝试读取 AWS_REGION 或默认
};

// 检查必需的环境变量
const requiredEnvVars = [
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME',
  'R2_ENDPOINT_URL', 'DYNAMODB_TABLE_NAME'
];
// 修正环境变量检查逻辑，直接检查 process.env
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error(`错误：缺少必要的环境变量: ${missingEnvVars.join(', ')}`);
  console.error('请在运行脚本前设置这些环境变量 (例如: export R2_BUCKET_NAME=your-bucket)');
  process.exit(1);
}


// --- 初始化 AWS 客户端 ---
const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.r2EndpointUrl,
  credentials: {
    accessKeyId: config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

const ddbClient = new DynamoDBClient({ region: config.awsRegion });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 清理函数 ---

/**
 * 清空 R2 存储桶中的所有对象
 */
async function clearR2Bucket() {
  console.log(`准备清空 R2 存储桶: ${config.r2BucketName}...`);
  let objectCount = 0;
  let continuationToken = undefined;
  let truncated = true; // 假设开始时有内容或需要检查

  while(truncated) { // 使用 while 循环处理分页
    const listParams = {
      Bucket: config.r2BucketName,
      ContinuationToken: continuationToken,
    };
    const listCommand = new ListObjectsV2Command(listParams);
    let listResponse;
    try {
        listResponse = await s3Client.send(listCommand);
    } catch (error) {
        console.error(`列出 R2 对象时出错: ${error.message}`);
        throw error; // 或者决定是否继续
    }


    if (!listResponse.Contents || listResponse.Contents.length === 0) {
      if (continuationToken === undefined) { // 第一次就为空
          console.log('R2 存储桶已经是空的。');
      } else { // 分页结束
          console.log('没有更多 R2 对象了。');
      }
      truncated = false; // 结束循环
      continue; // 跳过本次循环的删除部分
    }

    const objectsToDelete = listResponse.Contents.map(obj => ({ Key: obj.Key }));
    objectCount += objectsToDelete.length;
    console.log(`找到 ${objectsToDelete.length} 个对象准备删除 (总计 ${objectCount})...`);

    // 分批删除 (DeleteObjects 最多一次删除 1000 个)
    for (let i = 0; i < objectsToDelete.length; i += 1000) {
      const batch = objectsToDelete.slice(i, i + 1000);
      const deleteParams = {
        Bucket: config.r2BucketName,
        Delete: { Objects: batch },
      };
      const deleteCommand = new DeleteObjectsCommand(deleteParams);
      try {
          const deleteResult = await s3Client.send(deleteCommand);
          console.log(`已发送删除请求 ${batch.length} 个对象...`);
          if (deleteResult.Errors && deleteResult.Errors.length > 0) {
              console.warn('删除 R2 对象时遇到错误:', deleteResult.Errors);
          }
      } catch (deleteError) {
          console.error(`发送批量删除 R2 对象请求时出错: ${deleteError.message}`);
          // 可以选择抛出错误停止，或者记录后继续
      }

    }

    // 检查是否还有更多页面
    truncated = listResponse.IsTruncated;
    continuationToken = listResponse.NextContinuationToken;
  } // end while loop

  console.log(`R2 存储桶 ${config.r2BucketName} 清理完成，共处理约 ${objectCount} 个对象。`);
}

/**
 * 清空 DynamoDB 表中的所有项目
 */
async function clearDynamoDBTable() {
  console.log(`准备清空 DynamoDB 表: ${config.dynamoDbTableName}...`);
  let itemCount = 0;
  let lastEvaluatedKey = undefined;

  do {
    const scanParams = {
      TableName: config.dynamoDbTableName,
      // 只需要主键来执行删除操作，减少读取的数据量和消耗
      ProjectionExpression: 'photo_id', // 确保 'photo_id' 是你的主键名
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
      if(lastEvaluatedKey === undefined) {
           console.log('DynamoDB 表已经是空的。');
      } else {
           console.log('没有更多 DynamoDB 项目了。');
      }
      break; // 结束循环
    }

    const itemsToDelete = scanResponse.Items;
    itemCount += itemsToDelete.length;
    console.log(`找到 ${itemsToDelete.length} 个项目准备删除 (总计 ${itemCount})...`);

    // 分批删除 (BatchWriteItem 一次最多处理 25 个请求)
     for (let i = 0; i < itemsToDelete.length; i += 25) {
        const batch = itemsToDelete.slice(i, i + 25);
        const deleteRequests = batch.map(item => ({
            DeleteRequest: {
                // 确保这里的 Key 结构与你的表主键完全匹配
                Key: { photo_id: item.photo_id }
            }
        }));

        const batchWriteParams = {
            RequestItems: {
                [config.dynamoDbTableName]: deleteRequests
            }
        };

        const batchWriteCommand = new BatchWriteItemCommand(batchWriteParams);
        try {
            const batchWriteResult = await ddbDocClient.send(batchWriteCommand);
            console.log(`已发送删除请求 ${deleteRequests.length} 个项目...`);

             // 处理未处理的项目（基本）
            if (batchWriteResult.UnprocessedItems && Object.keys(batchWriteResult.UnprocessedItems).length > 0 && batchWriteResult.UnprocessedItems[config.dynamoDbTableName]) {
                console.warn(`警告：有 ${batchWriteResult.UnprocessedItems[config.dynamoDbTableName].length} 个项目未被处理，此脚本不包含重试逻辑。`);
            }
        } catch (batchWriteError) {
            console.error(`发送批量删除 DynamoDB 项目请求时出错: ${batchWriteError.message}`);
             // 可以选择抛出错误停止，或者记录后继续
        }

    }

    lastEvaluatedKey = scanResponse.LastEvaluatedKey;
  } while (lastEvaluatedKey); // 当 LastEvaluatedKey 不存在时，循环结束

  console.log(`DynamoDB 表 ${config.dynamoDbTableName} 清理完成，共处理约 ${itemCount} 个项目。`);
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
    try {
      await clearR2Bucket();
      await clearDynamoDBTable();
      console.log('所有数据清理完毕！');
    } catch (error) {
      console.error('清理过程中发生错误:', error);
      process.exitCode = 1; // 表示有错误发生
    }
  } else {
    console.log('操作已取消。');
  }
  rl.close(); // 关闭 readline 接口
}

// 执行主函数
main();