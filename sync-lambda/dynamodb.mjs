// /home/admin/imgu/sync-lambda/dynamodb.mjs (Updated)
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
// --- 修改：同时从 lib-dynamodb 导入 Client 和 Command ---
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'; // <--- 添加 GetCommand
import config from './config.mjs';
import process from 'node:process';

// 初始化 DynamoDB 客户端 (基础)
const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION });

// 使用 Document Client 并进行配置
const marshallOptions = { removeUndefinedValues: true }; // 自动移除 undefined 值
const unmarshallOptions = {};
const translateConfig = { marshallOptions, unmarshallOptions };
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient, translateConfig);


/**
 * 保存图片元数据到 DynamoDB
 * @param {Object} itemData - 要保存到 DynamoDB 的普通 JS 对象
 * @returns {Promise<void>}
 */
async function saveMetadata(itemData) {
  const photoId = itemData.photo_id;
  console.log(`Saving metadata to DynamoDB: Table=${config.dynamoDbTableName}, PhotoID=${photoId}`);

  const putParams = {
    TableName: config.dynamoDbTableName,
    Item: itemData, // DocumentClient 会自动处理 marshalling
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

/**
 * 从 DynamoDB 获取单个项目
 * @param {string} photoId - 要获取的项目的主键 photo_id
 * @returns {Promise<Object|undefined>} 返回找到的项目 (普通 JS 对象)，如果未找到则返回 undefined
 */
async function getDynamoDBItem(photoId) {
  console.log(`Getting item from DynamoDB: Table=${config.dynamoDbTableName}, PhotoID=${photoId}`);
  const getParams = {
    TableName: config.dynamoDbTableName,
    Key: {
      photo_id: photoId, // 使用主键名
    },
  };
  try {
    const command = new GetCommand(getParams); // 使用从 lib-dynamodb 导入的 GetCommand
    const result = await ddbDocClient.send(command); // DocumentClient 会自动处理 unmarshalling
    console.log(`GetItem result for ${photoId}:`, result.Item ? 'Found' : 'Not Found');
    return result.Item; // 如果找到返回 Item 对象，否则返回 undefined
  } catch (error) {
    console.error(`Error getting item ${photoId} from DynamoDB:`, error);
    throw error;
  }
}

// 导出两个函数
export { saveMetadata, getDynamoDBItem };
