// /home/admin/imgu/api-lambda/dynamodb.mjs (Updated for Pagination)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// 使用 lib-dynamodb 的 ScanCommand 配合 DocumentClient
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import config from './config.mjs';
import process from 'node:process';

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const marshallOptions = { removeUndefinedValues: true };
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);

/**
 * 从 DynamoDB 获取分页的图片元数据
 * @param {number} limit - 每页返回的最大项目数
 * @param {Object | undefined} startKey - DynamoDB Scan 操作的 ExclusiveStartKey
 * @returns {Promise<{items: Array<Object>, nextToken: Object | undefined}>}
 */
async function getImageDataPage(limit = 20, startKey = undefined) { // 默认每页 20 条
  console.log(`Scanning DynamoDB table: ${config.dynamoDbTableName} with Limit=${limit}`, startKey ? `StartKey=${JSON.stringify(startKey)}` : '');

  const scanParams = {
    TableName: config.dynamoDbTableName,
    Limit: limit,
    ExclusiveStartKey: startKey,
    // ProjectionExpression: "photo_id, description, r2_public_url, ..." // 可选：只获取需要的字段
  };

  try {
    const scanCommand = new ScanCommand(scanParams);
    const scanResult = await ddbDocClient.send(scanCommand);

    console.log(`Scan returned ${scanResult.Count || 0} items.`);

    return {
        items: scanResult.Items || [], // 返回当前页的项目数组
        nextToken: scanResult.LastEvaluatedKey // 返回 LastEvaluatedKey 作为下一页的令牌
    };

  } catch (error) {
    console.error(`Error scanning DynamoDB table ${config.dynamoDbTableName}:`, error);
    throw new Error(`Failed to retrieve data from DynamoDB: ${error.message}`);
  }
}

// 只导出新的分页函数
export { getImageDataPage };
