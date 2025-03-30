// dynamodb.mjs
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import config from './config.mjs';
import process from 'node:process';

// 初始化 DynamoDB Document 客户端
// Lambda 运行时会自动设置 AWS_REGION 环境变量
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });
// 使用 Document Client 简化操作
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * 保存图片元数据到 DynamoDB
 * @param {Object} itemData - 要保存到 DynamoDB 的完整项目数据
 * @returns {Promise<void>}
 */
async function saveMetadata(itemData) {
  const photoId = itemData.photo_id; // 假设 itemData 中已有 photo_id
  console.log(`Saving metadata to DynamoDB: Table=${config.dynamoDbTableName}, PhotoID=${photoId}`);

  const putParams = {
    TableName: config.dynamoDbTableName,
    Item: itemData,
  };

  try {
    const command = new PutCommand(putParams);
    await ddbDocClient.send(command);
    console.log(`Successfully saved metadata for ${photoId} to DynamoDB.`);
  } catch (error) {
    console.error(`Error saving metadata for ${photoId} to DynamoDB:`, error);
    throw error; // 让错误冒泡
  }
}

export { saveMetadata };