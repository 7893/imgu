// unsplash.mjs
import config from './config.mjs';

/**
 * 从 Unsplash API 获取随机照片数据
 * @returns {Promise<Array<Object>>} 照片数据数组
 */
async function fetchPhotos() {
  const apiUrl = `${config.unsplashApiUrl}/photos/random?count=${config.photosToFetch}`;
  console.log(`Workspaceing photos from Unsplash: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Client-ID ${config.unsplashAccessKey}`,
        'Accept-Version': 'v1' // 推荐指定 API 版本
      }
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Unsplash API error: ${response.status} ${response.statusText}`, errorBody);
      throw new Error(`Unsplash API request failed with status ${response.status}`);
    }

    const photos = await response.json();
    console.log(`Successfully fetched ${photos.length} photos from Unsplash.`);
    return photos;

  } catch (error) {
    console.error('Error fetching photos from Unsplash:', error);
    // 让错误冒泡上去，由主 handler 处理
    throw error;
  }
}

export { fetchPhotos };
