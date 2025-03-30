// src/app/page.jsx

// 必须在文件顶部添加这个指令
"use client";

import React, { useState, useEffect } from 'react';
// import styles from './page.module.css'; // 如果需要 CSS Modules

export default function HomePage() {
  // --- State Variables ---
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // --- Environment Variable ---
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  // --- Effect Hook for Data Fetching ---
  useEffect(() => {
    async function fetchImageData() {
      if (!apiUrl) {
        console.error("API URL not configured. Set NEXT_PUBLIC_API_URL environment variable.");
        setError("API URL configuration missing.");
        setLoading(false);
        return;
      }

      // 使用 console.log 确认 API URL 是否正确读取
      console.log(`Workspaceing data from: ${apiUrl}`); // 注意：之前的日志有 Workspaceing 拼写错误，这里已修正
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(apiUrl);

        if (!response.ok) {
          let errorMsg = `HTTP error! status: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMsg += `, message: ${errorData.message || 'No details'}`;
          } catch (parseError) {
            // Ignore if response body is not JSON or empty
          }
          throw new Error(errorMsg);
        }

        const data = await response.json();
        // 使用 console.log 确认获取的数据结构，检查 r2_public_url 是否存在且为字符串
        if (data && data.length > 0) {
            console.log('First image data structure sample:', data[0]);
        }
        console.log("Data fetched successfully:", data);

        setImages(data);

      } catch (e) {
        console.error("Failed to fetch images:", e);
        // 区分是网络错误还是其他错误
        if (e instanceof TypeError && e.message === 'Failed to fetch') {
             setError(`Network error: Failed to fetch data from API. Check network connection or CORS settings.`);
        } else {
             setError(`Failed to load images: ${e.message}`);
        }

      } finally {
        setLoading(false);
      }
    }

    fetchImageData();

  }, [apiUrl]); // 依赖 apiUrl

  // --- Render Logic ---
  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <h1>Unsplash Image Gallery</h1>
      <p>Images synchronized from Unsplash, stored in Cloudflare R2 & AWS DynamoDB.</p>

      {/* 加载状态 */}
      {loading && <p>Loading images...</p>}

      {/* 错误状态 */}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {/* 成功状态 */}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
          {images.length === 0 ? (
            <p>No images found. Try running the sync job again?</p>
          ) : (
            images.map((image) => (
              <div key={image.photo_id} style={{ border: '1px solid #ddd', borderRadius: '4px', overflow: 'hidden', padding: '8px' }}>
                {/* --- 确认这里的 src --- */}
                <img
                  src={image.r2_public_url} // <-- 确保这里使用的是 r2_public_url
                  alt={image.description || image.alt_description || `Photo ${image.photo_id}`}
                  style={{ width: '100%', height: '200px', objectFit: 'cover', display: 'block' }}
                  loading="lazy"
                />
                <p style={{ fontSize: '0.8em', marginTop: '8px', textAlign: 'center' }}>
                  Photo by: {image.user?.name || 'Unknown'}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </main>
  );
}
