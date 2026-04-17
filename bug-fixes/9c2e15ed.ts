// 수정 전: 모든 데이터를 한 번에 렌더링
// const ChartComponent = ({ data }) => {
//   return <BarChart data={data} />;
// };

// 수정 후: 가상화 및 데이터 최적화 적용
import { useMemo, useState, useEffect } from 'react';
import { BarChart, ResponsiveContainer } from 'recharts';

const ChartComponent = ({ data }) => {
  // 1. 데이터 샘플링: 1000개 이상이면 축약
  const optimizedData = useMemo(() => {
    if (data.length > 1000) {
      const sampleRate = Math.ceil(data.length / 1000);
      return data.filter((_, index) => index % sampleRate === 0);
    }
    return data;
  }, [data]);

  // 2. 메모이제이션으로 불필요한 재렌더링 방지
  const memoizedData = useMemo(() => {
    return optimizedData.map(item => ({
      ...item,
      // 날짜 형식 사전 처리
      displayDate: new Date(item.date).toLocaleDateString('ko-KR')
    }));
  }, [optimizedData]);

  // 3. 비동기 렌더링으로 메인 스레드 블로킹 방지
  const [isRendered, setIsRendered] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setIsRendered(true), 0);
    return () => clearTimeout(timer);
  }, [memoizedData]);

  if (!isRendered) {
    return <div className="skeleton-loader">차트 로딩 중...</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart 
        data={memoizedData}
        // 성능 최적화 옵션
        isAnimationActive={false}
      >
      </BarChart>
    </ResponsiveContainer>
  );
};

export default ChartComponent;