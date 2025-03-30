// dynamodb.mjs (Corrected for API Lambda)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// --- 修改：从 lib-dynamodb 同时导入 Client 和 Command ---
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import config from './config.mjs';
import process from 'node:process';

// 初始化 DynamoDB 客户端 (基础)
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// 使用 Document Client 并进行配置，确保自动 unmarshall
const marshallOptions = {
  // 保留空值或未定义值，如果需要
  // removeUndefinedValues: false,
};
const unmarshallOptions = {
  // 将数字转换为 JS Number 而不是 BigInt，如果需要
  // wrapNumbers: false,
};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);


/**
 * 从 DynamoDB 获取所有图片元数据 (返回普通 JS 对象)
 */
async function getAllImageData() {
  console.log(`Scanning DynamoDB table: ${config.dynamoDbTableName} using DocumentClient`);
  let allItems = [];
  let lastEvaluatedKey = undefined;

  try {
    do {
      // 使用从 lib-dynamodb 导入的 ScanCommand
      const scanParams = {
        TableName: config.dynamoDbTableName,
        ExclusiveStartKey: lastEvaluatedKey,
      };
      const scanCommand = new ScanCommand(scanParams);

      // 通过 ddbDocClient 发送命令，它会自动处理反序列化 (unmarshalling)
      const scanResult = await ddbDocClient.send(scanCommand);

      if (scanResult.Items && scanResult.Items.length > 0) {
        allItems = allItems.concat(scanResult.Items); // Items 应该是普通 JS 对象了
        console.log(`Scanned ${scanResult.Count} items, Total fetched: ${allItems.length}`);
      }
      lastEvaluatedKey = scanResult.LastEvaluatedKey;

    } while (lastEvaluatedKey);

    console.log(`Scan complete. Total items retrieved: ${allItems.length}`);
    // 现在 allItems 数组里应该是普通的 JS 对象，而不是 DynamoDB JSON 格式
    return allItems;

  } catch (error) {
    console.error(`Error scanning DynamoDB table ${config.dynamoDbTableName}:`, error);
    throw new Error(`Failed to retrieve data from DynamoDB: ${error.message}`);
  }
}

export { getAllImageData };
